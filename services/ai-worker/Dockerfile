FROM python:3.12.11-slim
# Self-hosted OCR: tesseract with Vietnamese + English traineddata and poppler for PDF rasterising.
# No network access is needed at runtime; the engine runs as a sandboxed subprocess.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-vie tesseract-ocr-eng poppler-utils \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py ocr.py ./
ENV OCR_ENGINE=tesseract OCR_LANGUAGES=vie+eng LOCAL_OCR_ENABLED=false
USER 65532:65532
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4100"]
