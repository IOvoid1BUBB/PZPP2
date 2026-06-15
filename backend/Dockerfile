FROM python:3.14-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libc6-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY pyproject.toml ./
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY data ./data
COPY scripts ./scripts
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

EXPOSE 8000

# Kolejność startu: alembic upgrade → seed_vehicles → seed_market_offers → uvicorn.
# W środowisku dev (docker-compose) można nadpisać CMD na uvicorn --reload.
CMD ["./entrypoint.sh"]
