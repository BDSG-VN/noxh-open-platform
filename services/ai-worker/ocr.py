"""Self-hosted OCR engines for the NOXH AI worker.

Two engines share one contract: ``tesseract`` runs the system binary as a sandboxed subprocess
(private temporary directory, no shell, explicit timeout, validated language list, pixel and page
limits) and ``fake`` returns deterministic output derived from the input hash for tests and CI
images without traineddata. No document content is ever logged; errors carry a short class only.

PDF input is rasterised with ``pdftoppm`` (poppler) when present. Without it, PDFs are refused
with ``pdf-rasteriser-unavailable`` and only PNG/JPEG images are processed.
"""
from __future__ import annotations

import hashlib
import io
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from typing import Callable

from PIL import Image, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = None  # limits are enforced explicitly below, before decoding pixels

MAX_BLOCKS = 400
MAX_TEXT_CHARS = 1000
DEFAULT_MAX_BYTES = 5 * 1024 * 1024
DEFAULT_MAX_PIXELS = 25_000_000
DEFAULT_MAX_PAGES = 10
DEFAULT_TIMEOUT_SECONDS = 20
RASTER_DPI = 200
LANGUAGE = re.compile(r'^[a-z_]{3,12}$')
TESSERACT = shutil.which('tesseract')
PDFTOPPM = shutil.which('pdftoppm')


class ConfigError(Exception):
    """Operator configuration is invalid; reported as a class, never with environment values."""


class InputError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


class EngineError(Exception):
    """Engine failed; ``detail`` is a short class and ``private`` is never returned to callers."""

    def __init__(self, detail: str, private: str = ''):
        super().__init__(detail)
        self.detail = detail
        self.private = private


class EngineTimeout(EngineError):
    def __init__(self):
        super().__init__('engine-timeout')


def _int_env(name: str, default: int, low: int, high: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == '':
        return default
    try:
        value = int(raw)
    except ValueError as e:
        raise ConfigError(name) from e
    if value < low or value > high:
        raise ConfigError(name)
    return value


def max_bytes() -> int:
    return _int_env('OCR_MAX_BYTES', DEFAULT_MAX_BYTES, 1, 50 * 1024 * 1024)


def max_pixels() -> int:
    return _int_env('OCR_MAX_PIXELS', DEFAULT_MAX_PIXELS, 1, 200_000_000)


def max_pages() -> int:
    return _int_env('OCR_MAX_PAGES', DEFAULT_MAX_PAGES, 1, 100)


def timeout_seconds() -> int:
    return _int_env('OCR_TIMEOUT_SECONDS', DEFAULT_TIMEOUT_SECONDS, 1, 120)


def configured_languages() -> list[str]:
    raw = os.environ.get('OCR_LANGUAGES', 'vie+eng')
    parts = raw.split('+') if raw else []
    if not parts or any(not LANGUAGE.match(p) for p in parts):
        raise ConfigError('OCR_LANGUAGES')
    return parts


@dataclass
class Page:
    number: int
    image: bytes  # PNG bytes
    width: int
    height: int


@dataclass
class Result:
    blocks: list[dict]
    pages: int
    engine: str
    engine_version: str
    languages: list[str]
    quality: float
    processing_ms: int
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            'engine': self.engine,
            'engine_version': self.engine_version,
            'languages': self.languages,
            'pages': self.pages,
            'quality': round(self.quality, 4),
            'processing_ms': self.processing_ms,
            'blocks': self.blocks,
            'warnings': self.warnings,
        }


# --- input validation ---------------------------------------------------------------------------

PNG_MAGIC = b'\x89PNG\r\n\x1a\n'
ACTIVE_PDF = re.compile(rb'/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction|AA)\b')


def sniff(body: bytes, mime: str) -> str:
    """Returns the validated kind (png/jpeg/pdf) or raises an InputError with a class only."""
    if mime not in ('image/png', 'image/jpeg', 'application/pdf'):
        raise InputError(415, 'unsupported-media-type')
    if not body:
        raise InputError(422, 'empty-body')
    if len(body) > max_bytes():
        raise InputError(413, 'payload-too-large')
    if mime == 'image/png':
        if not body.startswith(PNG_MAGIC):
            raise InputError(415, 'content-mismatch')
        return 'png'
    if mime == 'image/jpeg':
        if not (body[:3] == b'\xff\xd8\xff' and body[-2:] == b'\xff\xd9'):
            raise InputError(415, 'content-mismatch')
        return 'jpeg'
    if not (body.startswith(b'%PDF-') and b'%%EOF' in body[-2048:]):
        raise InputError(415, 'content-mismatch')
    if ACTIVE_PDF.search(body):
        raise InputError(422, 'active-pdf')
    return 'pdf'


def _decode_image(body: bytes, number: int) -> Page:
    try:
        with Image.open(io.BytesIO(body)) as img:
            width, height = img.size
            if width * height > max_pixels() or width < 1 or height < 1:
                raise InputError(422, 'image-too-large')
            img.load()
            out = io.BytesIO()
            img.convert('RGB').save(out, format='PNG')
    except InputError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        raise InputError(422, 'unreadable-image') from None
    return Page(number, out.getvalue(), width, height)


def _run(args: list[str], cwd: str, timeout: int) -> subprocess.CompletedProcess:
    """Runs a fixed argv without a shell, in a private directory, with a minimal environment."""
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TMPDIR': cwd}
    if 'TESSDATA_PREFIX' in os.environ:
        env['TESSDATA_PREFIX'] = os.environ['TESSDATA_PREFIX']
    try:
        return subprocess.run(
            args,
            cwd=cwd,
            env=env,
            capture_output=True,
            timeout=timeout,
            check=False,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        raise EngineTimeout() from None
    except OSError as e:
        raise EngineError('engine-unavailable', str(e)) from None


def _rasterise_pdf(body: bytes, deadline: float) -> list[Page]:
    if not PDFTOPPM:
        raise InputError(422, 'pdf-rasteriser-unavailable')
    limit = max_pages()
    with tempfile.TemporaryDirectory(prefix='noxh-ocr-') as cwd:
        src = os.path.join(cwd, 'in.pdf')
        with open(src, 'wb') as f:
            f.write(body)
        # Render one page beyond the limit so an over-long document is refused, not truncated.
        remaining = max(1, int(deadline - time.monotonic()))
        proc = _run(
            [PDFTOPPM, '-r', str(RASTER_DPI), '-png', '-f', '1', '-l', str(limit + 1), src, 'page'],
            cwd,
            remaining,
        )
        if proc.returncode != 0:
            raise InputError(422, 'unreadable-pdf')
        files = sorted(n for n in os.listdir(cwd) if n.startswith('page') and n.endswith('.png'))
        if not files:
            raise InputError(422, 'unreadable-pdf')
        if len(files) > limit:
            raise InputError(422, 'too-many-pages')
        pages = []
        for i, name in enumerate(files, start=1):
            with open(os.path.join(cwd, name), 'rb') as f:
                pages.append(_decode_image(f.read(), i))
        return pages


def load_pages(body: bytes, mime: str, deadline: float) -> list[Page]:
    kind = sniff(body, mime)
    if kind == 'pdf':
        return _rasterise_pdf(body, deadline)
    return [_decode_image(body, 1)]


# --- engines ------------------------------------------------------------------------------------


def _clip(text: str) -> str:
    text = ' '.join(text.split())
    return text[:MAX_TEXT_CHARS]


def parse_tsv(tsv: str, page: int) -> list[dict]:
    """Groups tesseract TSV words into line blocks with a union bbox and length-weighted confidence."""
    lines: dict[tuple, dict] = {}
    rows = tsv.splitlines()
    if not rows:
        return []
    header = rows[0].split('\t')
    try:
        idx = {k: header.index(k) for k in ('level', 'block_num', 'par_num', 'line_num', 'left', 'top', 'width', 'height', 'conf', 'text')}
    except ValueError:
        raise EngineError('invalid-engine-output') from None
    for row in rows[1:]:
        cols = row.split('\t')
        if len(cols) < len(header) or cols[idx['level']] != '5':
            continue
        text = cols[idx['text']].strip()
        try:
            conf = float(cols[idx['conf']])
            left, top, width, height = (int(cols[idx[k]]) for k in ('left', 'top', 'width', 'height'))
        except ValueError:
            continue
        if not text or conf < 0:
            continue
        key = (cols[idx['block_num']], cols[idx['par_num']], cols[idx['line_num']])
        line = lines.setdefault(key, {'words': [], 'x1': left, 'y1': top, 'x2': left + width, 'y2': top + height})
        line['words'].append((text, max(0.0, min(100.0, conf)) / 100))
        line['x1'] = min(line['x1'], left)
        line['y1'] = min(line['y1'], top)
        line['x2'] = max(line['x2'], left + width)
        line['y2'] = max(line['y2'], top + height)
    blocks = []
    for line in lines.values():
        total = sum(len(w) for w, _ in line['words']) or 1
        conf = sum(len(w) * c for w, c in line['words']) / total
        blocks.append(
            {
                'page': page,
                'text': _clip(' '.join(w for w, _ in line['words'])),
                'confidence': round(conf, 4),
                'bbox': {'x': line['x1'], 'y': line['y1'], 'width': line['x2'] - line['x1'], 'height': line['y2'] - line['y1']},
            }
        )
    return blocks


def quality_score(blocks: list[dict]) -> float:
    """Length-weighted mean confidence in [0, 1]; empty output scores 0."""
    total = sum(len(b['text']) for b in blocks)
    if total == 0:
        return 0.0
    return min(1.0, max(0.0, sum(len(b['text']) * float(b['confidence']) for b in blocks) / total))


class Engine:
    name = 'abstract'
    version = 'abstract'
    languages: list[str] = []

    def recognise(self, pages: list[Page]) -> list[dict]:  # pragma: no cover - interface
        raise NotImplementedError


class FakeEngine(Engine):
    """Deterministic engine for tests and images without traineddata: output depends only on input bytes."""

    name = 'fake'
    version = 'fake-1'

    def __init__(self):
        self.languages = ['fake']

    def recognise(self, pages: list[Page]) -> list[dict]:
        blocks = []
        for page in pages:
            digest = hashlib.sha256(page.image).hexdigest()
            conf = 0.5 + (int(digest[:2], 16) % 50) / 100  # 0.50–0.99, stable per input
            blocks.append(
                {
                    'page': page.number,
                    'text': 'NOXH-FAKE-OCR ' + digest[:16].upper(),
                    'confidence': round(conf, 4),
                    'bbox': {'x': 0, 'y': 0, 'width': page.width, 'height': min(page.height, 20)},
                }
            )
        return blocks


class TesseractEngine(Engine):
    name = 'tesseract'

    def __init__(self):
        if not TESSERACT:
            raise ConfigError('tesseract-missing')
        self.version = self._version()
        available = self._available_languages()
        wanted = configured_languages()
        self.languages = [l for l in wanted if l in available]
        if not self.languages:
            raise ConfigError('OCR_LANGUAGES-unavailable')

    def _version(self) -> str:
        with tempfile.TemporaryDirectory(prefix='noxh-ocr-') as cwd:
            proc = _run([TESSERACT, '--version'], cwd, 10)
        first = (proc.stdout or proc.stderr).decode('utf-8', 'replace').splitlines()
        line = first[0].strip() if first else 'tesseract'
        return line if re.match(r'^tesseract [0-9A-Za-z.\-]{1,40}$', line) else 'tesseract'

    def _available_languages(self) -> set[str]:
        with tempfile.TemporaryDirectory(prefix='noxh-ocr-') as cwd:
            proc = _run([TESSERACT, '--list-langs'], cwd, 10)
        out = (proc.stdout + proc.stderr).decode('utf-8', 'replace').splitlines()
        return {l.strip() for l in out if LANGUAGE.match(l.strip())}

    def recognise(self, pages: list[Page]) -> list[dict]:
        blocks: list[dict] = []
        deadline = time.monotonic() + timeout_seconds()
        with tempfile.TemporaryDirectory(prefix='noxh-ocr-') as cwd:
            for page in pages:
                remaining = int(deadline - time.monotonic())
                if remaining < 1:
                    raise EngineTimeout()
                src = os.path.join(cwd, f'p{page.number}.png')
                with open(src, 'wb') as f:
                    f.write(page.image)
                proc = _run(
                    [TESSERACT, src, 'stdout', '-l', '+'.join(self.languages), '--psm', '3', '--oem', '1', 'tsv'],
                    cwd,
                    remaining,
                )
                os.unlink(src)
                if proc.returncode != 0:
                    raise EngineError('tesseract-failed', proc.stderr.decode('utf-8', 'replace')[:200])
                blocks.extend(parse_tsv(proc.stdout.decode('utf-8', 'replace'), page.number))
                if len(blocks) >= MAX_BLOCKS:
                    blocks = blocks[:MAX_BLOCKS]
                    break
        return blocks


_ENGINE: Engine | None = None
_FACTORIES: dict[str, Callable[[], Engine]] = {'fake': FakeEngine, 'tesseract': TesseractEngine}


def reset_engine_cache() -> None:
    global _ENGINE
    _ENGINE = None


def get_engine() -> Engine:
    global _ENGINE
    if _ENGINE is None:
        name = os.environ.get('OCR_ENGINE', 'tesseract')
        factory = _FACTORIES.get(name)
        if factory is None:
            raise ConfigError('OCR_ENGINE')
        _ENGINE = factory()
    return _ENGINE


def enabled() -> bool:
    return os.environ.get('LOCAL_OCR_ENABLED', 'false').lower() == 'true'


def run(body: bytes, mime: str) -> Result:
    started = time.monotonic()
    deadline = started + timeout_seconds()
    engine = get_engine()
    pages = load_pages(body, mime, deadline)
    blocks = engine.recognise(pages)[:MAX_BLOCKS]
    warnings = []
    if not blocks:
        warnings.append('no-text-detected')
    return Result(
        blocks=blocks,
        pages=len(pages),
        engine=engine.name,
        engine_version=engine.version,
        languages=list(engine.languages),
        quality=quality_score(blocks),
        processing_ms=int((time.monotonic() - started) * 1000),
        warnings=warnings,
    )
