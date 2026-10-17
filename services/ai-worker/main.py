import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

import ocr

if os.environ.get('EXTERNAL_AI_ENABLED', 'false').lower() != 'false':
    raise RuntimeError('External AI is prohibited in Sprint 0')
app = FastAPI(title='NOXH AI worker shell', version='0.2.0', docs_url=None, redoc_url=None, openapi_url=None)


def _engine_status():
    try:
        engine = ocr.get_engine()
        return {'enabled': ocr.enabled(), 'engine': engine.name, 'engine_version': engine.version}
    except ocr.ConfigError as e:
        return {'enabled': False, 'engine': None, 'engine_version': None, 'config_error': str(e)}


@app.get('/health/live')
def health():
    return {'status': 'alive', 'external_ai': False, 'advisory_only': True, 'ocr': _engine_status()}


@app.post('/extract')
def extract():
    raise HTTPException(status_code=501, detail='Extraction not implemented; no document accepted')


@app.post('/ocr')
async def recognise(request: Request):
    """Self-hosted OCR: raw PNG/JPEG/PDF body in, text blocks with boxes and confidence out.

    Never logs or echoes document bytes or recognised text; failures carry a short class only.
    """
    if not ocr.enabled():
        raise HTTPException(status_code=503, detail='ocr-disabled')
    length = request.headers.get('content-length')
    if length is not None and length.isdigit() and int(length) > ocr.max_bytes():
        raise HTTPException(status_code=413, detail='payload-too-large')
    mime = (request.headers.get('content-type') or '').split(';')[0].strip().lower()
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > ocr.max_bytes():
            raise HTTPException(status_code=413, detail='payload-too-large')
    try:
        result = ocr.run(bytes(body), mime)
    except ocr.InputError as e:
        raise HTTPException(status_code=e.status, detail=e.detail) from None
    except ocr.EngineTimeout:
        raise HTTPException(status_code=504, detail='engine-timeout') from None
    except ocr.EngineError as e:
        raise HTTPException(status_code=502, detail=e.detail) from None
    except ocr.ConfigError as e:
        raise HTTPException(status_code=503, detail='ocr-misconfigured:' + str(e)) from None
    return JSONResponse(result.to_dict(), headers={'Cache-Control': 'no-store'})
