FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen

COPY server.py ./

EXPOSE 8002

CMD ["uv", "run", "server.py"]
