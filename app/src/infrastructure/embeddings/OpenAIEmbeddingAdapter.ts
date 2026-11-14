import type { EmbeddingPort } from "../../domain/ports/EmbeddingPort";
import { l2Normalizar } from "./vector";

// conferir na doc oficial
const MODELO_PADRAO = "text-embedding-3-small";
const RETRYABLE_STATUS = [429, 503];
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Embeddings OpenAI via fetch direto.
 * POST https://api.openai.com/v1/embeddings Bearer; body { model, input };
 * vetor em data[0].embedding. conferir na doc oficial.
 */
export class OpenAIEmbeddingAdapter implements EmbeddingPort {
  readonly modelo: string;

  constructor(
    private readonly apiKey: string,
    modelo?: string
  ) {
    this.modelo = modelo?.trim() || MODELO_PADRAO;
  }

  async embed(texto: string): Promise<number[]> {
    const body = JSON.stringify({ model: this.modelo, input: texto });

    let resp: Response | null = null;

    for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
      resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body,
      });

      if (resp.ok) break;

      const podeTentarDeNovo = RETRYABLE_STATUS.includes(resp.status) && tentativa < MAX_RETRIES;
      if (!podeTentarDeNovo) break;

      const esperaMs = 500 * 2 ** tentativa + Math.random() * 250;
      console.warn(
        `[embedding:openai] ${resp.status} (tentativa ${tentativa + 1}/${MAX_RETRIES + 1}), aguardando ${Math.round(esperaMs)}ms...`
      );
      await sleep(esperaMs);
    }

    if (!resp) {
      throw new Error("OpenAI embeddings: nenhuma resposta obtida após as tentativas.");
    }

    if (!resp.ok) {
      const detalhe = await resp.text();
      throw new Error(`OpenAI embeddings respondeu ${resp.status}: ${detalhe}`);
    }

    const data = (await resp.json()) as { data?: Array<{ embedding?: unknown }> };
    const values = data?.data?.[0]?.embedding;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("OpenAI embeddings: vetor ausente em data[0].embedding");
    }

    return l2Normalizar(values.map((x) => Number(x)));
  }
}
