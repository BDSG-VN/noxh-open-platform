FROM python:3.12.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
USER 65532:65532
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4100"]
