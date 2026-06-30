FROM python:3.12-slim

WORKDIR /app

# Install deps first for better layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Persist runtime state + alert history outside the image (mount /data as a volume).
ENV STATE_FILE=/data/state.json \
    DB_FILE=/data/alerts.db
RUN mkdir -p /data

CMD ["python", "monitor.py"]
