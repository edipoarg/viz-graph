FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download DuckDB file from GitHub Releases at build time
ARG DUCKDB_URL
RUN if [ -n "$DUCKDB_URL" ]; then \
      mkdir -p /data && curl -fsSL "$DUCKDB_URL" -o /data/poder_economico.duckdb; \
    fi

COPY . .

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
