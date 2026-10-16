"""Self-hosted OCR endpoint: engine abstraction, strict input validation, no content logging."""
import base64
import io
import json
import logging
import os
import shutil
import struct
import zlib

import pytest
from fastapi.testclient import TestClient

import ocr
from main import app


def png_bytes(width=64, height=32, color=(255, 255, 255)):
    """Minimal valid PNG without Pillow so fixtures stay deterministic."""
    raw = b''.join(b'\x00' + bytes(color) * width for _ in range(height))

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw))
        + chunk(b'IEND', b'')
    )


def jpeg_bytes():
    from PIL import Image

    out = io.BytesIO()
    Image.new('RGB', (40, 20), (255, 255, 255)).save(out, format='JPEG')
    return out.getvalue()


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setenv('OCR_ENGINE', 'fake')
    monkeypatch.setenv('LOCAL_OCR_ENABLED', 'true')
    ocr.reset_engine_cache()
    return TestClient(app)


def post(client, body, mime):
    return client.post('/ocr', content=body, headers={'Content-Type': mime})


def test_health_reports_engine_without_content(fake):
    body = fake.get('/health/live').json()
    assert body['external_ai'] is False
    assert body['ocr'] == {'enabled': True, 'engine': 'fake', 'engine_version': 'fake-1'}


def test_fake_engine_is_deterministic_and_shaped(fake):
    a = post(fake, png_bytes(), 'image/png')
    b = post(fake, png_bytes(), 'image/png')
    assert a.status_code == 200
    assert a.json()['blocks'] == b.json()['blocks']
    body = a.json()
    assert body['engine'] == 'fake'
    assert body['engine_version'] == 'fake-1'
    assert body['pages'] == 1
    assert 0 <= body['quality'] <= 1
    assert isinstance(body['processing_ms'], int) and body['processing_ms'] >= 0
    block = body['blocks'][0]
    assert set(block) == {'page', 'text', 'confidence', 'bbox'}
    assert set(block['bbox']) == {'x', 'y', 'width', 'height'}
    assert block['page'] == 1 and 0 <= block['confidence'] <= 1
    assert body['warnings'] == []
    # Different content must not produce identical text: the fake output is bound to the bytes.
    c = post(fake, png_bytes(color=(0, 0, 0)), 'image/png')
    assert c.json()['blocks'][0]['text'] != block['text']


def test_jpeg_accepted(fake):
    r = post(fake, jpeg_bytes(), 'image/jpeg')
    assert r.status_code == 200
    assert r.json()['pages'] == 1


def test_rejects_disabled_flag(monkeypatch):
    monkeypatch.setenv('OCR_ENGINE', 'fake')
    monkeypatch.setenv('LOCAL_OCR_ENABLED', 'false')
    ocr.reset_engine_cache()
    r = post(TestClient(app), png_bytes(), 'image/png')
    assert r.status_code == 503
    assert r.json()['detail'] == 'ocr-disabled'


@pytest.mark.parametrize(
    'body,mime,status,detail',
    [
        (b'', 'image/png', 422, 'empty-body'),
        (b'not an image at all', 'image/png', 415, 'content-mismatch'),
        (png_bytes(), 'image/gif', 415, 'unsupported-media-type'),
        (png_bytes(), 'application/pdf', 415, 'content-mismatch'),
        (b'%PDF-1.4 /JavaScript (x) %%EOF', 'application/pdf', 422, 'active-pdf'),
        (b'%PDF-1.4 no trailer', 'application/pdf', 415, 'content-mismatch'),
    ],
)
def test_strict_input_validation(fake, body, mime, status, detail):
    r = post(fake, body, mime)
    assert r.status_code == status
    assert r.json()['detail'] == detail


def test_body_size_limit(fake, monkeypatch):
    monkeypatch.setenv('OCR_MAX_BYTES', '100')
    r = post(fake, png_bytes(), 'image/png')
    assert r.status_code == 413
    assert r.json()['detail'] == 'payload-too-large'


def test_pixel_limit(fake, monkeypatch):
    monkeypatch.setenv('OCR_MAX_PIXELS', '1000')
    r = post(fake, png_bytes(64, 32), 'image/png')
    assert r.status_code == 422
    assert r.json()['detail'] == 'image-too-large'


def test_corrupt_png_is_rejected_not_crashed(fake):
    r = post(fake, png_bytes()[:40], 'image/png')
    assert r.status_code == 422
    assert r.json()['detail'] == 'unreadable-image'


def test_engine_failure_maps_to_502_without_details(fake, monkeypatch):
    def boom(_pages):
        raise ocr.EngineError('tesseract-crashed', 'stderr with /tmp/secret/path and text')

    monkeypatch.setattr(ocr.get_engine(), 'recognise', boom)
    r = post(fake, png_bytes(), 'image/png')
    assert r.status_code == 502
    assert r.json()['detail'] == 'tesseract-crashed'
    assert 'secret' not in r.text


def test_timeout_maps_to_504(fake, monkeypatch):
    def slow(_pages):
        raise ocr.EngineTimeout()

    monkeypatch.setattr(ocr.get_engine(), 'recognise', slow)
    r = post(fake, png_bytes(), 'image/png')
    assert r.status_code == 504
    assert r.json()['detail'] == 'engine-timeout'


def test_no_document_content_logged(fake, caplog):
    caplog.set_level(logging.DEBUG)
    body = post(fake, png_bytes(), 'image/png').json()
    text = body['blocks'][0]['text']
    joined = ' '.join(r.getMessage() for r in caplog.records)
    assert text not in joined
    assert base64.b64encode(png_bytes())[:20].decode() not in joined


def test_tesseract_tsv_parser_groups_lines_and_scores_quality():
    tsv = (
        'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
        '1\t1\t0\t0\t0\t0\t0\t0\t200\t100\t-1\t\n'
        '5\t1\t1\t1\t1\t1\t10\t10\t30\t12\t90.5\tHello\n'
        '5\t1\t1\t1\t1\t2\t45\t10\t40\t12\t70.0\tWorld\n'
        '5\t1\t1\t1\t2\t1\t10\t30\t30\t12\t-1\t\n'
        '5\t1\t1\t1\t2\t2\t10\t30\t30\t12\t50\tLow\n'
    )
    blocks = ocr.parse_tsv(tsv, page=2)
    assert blocks == [
        {
            'page': 2,
            'text': 'Hello World',
            'confidence': 0.8025,
            'bbox': {'x': 10, 'y': 10, 'width': 75, 'height': 12},
        },
        {'page': 2, 'text': 'Low', 'confidence': 0.5, 'bbox': {'x': 10, 'y': 30, 'width': 30, 'height': 12}},
    ]
    assert ocr.quality_score(blocks) == pytest.approx((0.8025 * 11 + 0.5 * 3) / 14)
    assert ocr.quality_score([]) == 0.0


def test_language_list_validation(monkeypatch):
    monkeypatch.setenv('OCR_LANGUAGES', 'vie+eng')
    assert ocr.configured_languages() == ['vie', 'eng']
    monkeypatch.setenv('OCR_LANGUAGES', 'vie;rm -rf /')
    with pytest.raises(ocr.ConfigError):
        ocr.configured_languages()
    monkeypatch.setenv('OCR_LANGUAGES', '')
    with pytest.raises(ocr.ConfigError):
        ocr.configured_languages()


@pytest.mark.skipif(shutil.which('tesseract') is None, reason='tesseract binary not installed')
def test_tesseract_engine_runs_sandboxed_with_available_language(monkeypatch):
    from PIL import Image, ImageDraw

    monkeypatch.setenv('OCR_ENGINE', 'tesseract')
    monkeypatch.setenv('OCR_LANGUAGES', 'vie+eng')
    ocr.reset_engine_cache()
    engine = ocr.get_engine()
    assert isinstance(engine, ocr.TesseractEngine)
    # Only languages present in tessdata are passed to the binary; `vie` is absent in this CI image.
    assert 'eng' in engine.languages
    assert engine.version.startswith('tesseract')
    img = Image.new('RGB', (420, 120), 'white')
    ImageDraw.Draw(img).text((20, 40), 'NOXH 2026', fill='black')
    out = io.BytesIO()
    img.save(out, format='PNG')
    monkeypatch.setenv('LOCAL_OCR_ENABLED', 'true')
    r = post(TestClient(app), out.getvalue(), 'image/png')
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['engine'] == 'tesseract'
    assert body['languages'] == engine.languages
    assert body['pages'] == 1


@pytest.mark.skipif(shutil.which('pdftoppm') is None, reason='pdftoppm not installed')
def test_pdf_is_rasterised_per_page_with_page_limit(fake, monkeypatch):
    from PIL import Image

    pages = [Image.new('RGB', (200, 100), 'white') for _ in range(3)]
    out = io.BytesIO()
    pages[0].save(out, format='PDF', save_all=True, append_images=pages[1:])
    pdf = out.getvalue()
    r = post(fake, pdf, 'application/pdf')
    assert r.status_code == 200, r.text
    assert r.json()['pages'] == 3
    assert sorted({b['page'] for b in r.json()['blocks']}) == [1, 2, 3]
    monkeypatch.setenv('OCR_MAX_PAGES', '2')
    r = post(fake, pdf, 'application/pdf')
    assert r.status_code == 422
    assert r.json()['detail'] == 'too-many-pages'


def test_pdf_without_rasteriser_is_a_documented_limit(fake, monkeypatch):
    monkeypatch.setattr(ocr, 'PDFTOPPM', None)
    r = post(fake, b'%PDF-1.4 synthetic %%EOF', 'application/pdf')
    assert r.status_code == 422
    assert r.json()['detail'] == 'pdf-rasteriser-unavailable'


def test_result_json_is_serialisable_and_bounded(fake):
    body = post(fake, png_bytes(), 'image/png').json()
    json.dumps(body)
    assert len(body['blocks']) <= ocr.MAX_BLOCKS
