import pytest
from fastapi.testclient import TestClient
from main import app

def test_health():
    assert TestClient(app).get('/health/live').json()['external_ai'] is False

def test_no_document_processing():
    assert TestClient(app).post('/extract', json={'document': 'synthetic'}).status_code == 501

def test_external_ai_startup_fails(monkeypatch):
    monkeypatch.setenv('EXTERNAL_AI_ENABLED', 'true')
    import runpy
    with pytest.raises(RuntimeError):
        runpy.run_path('main.py')
