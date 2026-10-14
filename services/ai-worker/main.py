import os
from fastapi import FastAPI, HTTPException

if os.environ.get('EXTERNAL_AI_ENABLED', 'false').lower() != 'false':
    raise RuntimeError('External AI is prohibited in Sprint 0')
app = FastAPI(title='NOXH AI worker shell', version='0.1.0')

@app.get('/health/live')
def health():
    return {'status': 'alive', 'external_ai': False, 'advisory_only': True}

@app.post('/extract')
def extract():
    raise HTTPException(status_code=501, detail='Extraction not implemented; no document accepted')
