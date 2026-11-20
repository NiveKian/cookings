# Ollama — juiz local

Compose opcional. Sobe o servidor Ollama e baixa `qwen2.5:1.5b` para o juiz do chat (`JUDGE_PROVIDER=ollama`). Não substitui o LLM principal (`LLM_PROVIDER`).

## Subir

A rede externa precisa existir (uma vez):

```bash
docker network create cookings-network
```

```bash
cd ollama
docker compose up -d
```

O serviço `ollama_pull` executa `ollama pull qwen2.5:1.5b` e termina. Na primeira vez o download pode demorar. O modelo fica no volume do serviço `ollama`.

## URL

- App na rede Docker: `http://ollama:11434` (nome do serviço).
- Bun no host: `http://127.0.0.1:11434`.

No `app`, `OLLAMA_BASE_URL` aponta para uma dessas URLs. `JUDGE_MODEL` vazio usa `qwen2.5:1.5b`. Sem chave de API.
