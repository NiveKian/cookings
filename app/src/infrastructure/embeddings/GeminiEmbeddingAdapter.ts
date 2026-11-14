import type { EmbeddingPort } from "../../domain/ports/EmbeddingPort";
import { l2Normalizar } from "./vector";

// conferir na doc oficial
const MODELO_PADRAO = "gemini-embedding-001";
const RETRYABLE_STATUS = [429, 503];
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Embeddings Gemini via fetch direto.
 * POST https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent
 * Header x-goog-api-key; body { content: { parts: [{ text }] } };
 * vetor em embedding.values. conferir na doc oficial.
 */
export class GeminiEmbeddingAdapter implements EmbeddingPort {
  readonly modelo: string;

  constructor(
    private readonly apiKey: string,
    modelo?: string
  ) {
    this.modelo = modelo?.trim() || MODELO_PADRAO;
  }

  async embed(texto: string): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelo}:embedContent`;
    const body = JSON.stringify({ content: { parts: [{ text: texto }] } });

    let resp: Response | null = null;

    for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body,
      });

      if (resp.ok) break;

      const podeTentarDeNovo = RETRYABLE_STATUS.includes(resp.status) && tentativa < MAX_RETRIES;
      if (!podeTentarDeNovo) break;

      const esperaMs = 500 * 2 ** tentativa + Math.random() * 250;
      console.warn(
        `[embedding:gemini] ${resp.status} (tentativa ${tentativa + 1}/${MAX_RETRIES + 1}), aguardando ${Math.round(esperaMs)}ms...`
      );
      await sleep(esperaMs);
    }

    if (!resp) {
      throw new Error("Gemini embedContent: nenhuma resposta obtida após as tentativas.");
    }

    if (!resp.ok) {
      const detalhe = await resp.text();
      throw new Error(`Gemini embedContent respondeu ${resp.status}: ${detalhe}`);
    }

    const data = (await resp.json()) as { embedding?: { values?: unknown } };
    const values = data?.embedding?.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("Gemini embedContent: vetor ausente em embedding.values");
    }

    return l2Normalizar(values.map((x) => Number(x)));
  }
}
