import type { EmbeddingPort } from "../../domain/ports/EmbeddingPort";
import { GeminiEmbeddingAdapter } from "./GeminiEmbeddingAdapter";
import { MockEmbeddingAdapter } from "./MockEmbeddingAdapter";
import { OpenAIEmbeddingAdapter } from "./OpenAIEmbeddingAdapter";

/**
 * EMBEDDING_PROVIDER: gemini | openai | mock. Ausente = mock.
 * Sem chave: não lança no boot; embed() falha e o caller trata como MISS.
 */
export function createEmbeddingAdapter(): EmbeddingPort {
  const provider = (process.env.EMBEDDING_PROVIDER || "mock").toLowerCase();
  const model = process.env.EMBEDDING_MODEL?.trim() || undefined;

  switch (provider) {
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn("[embedding] GEMINI_API_KEY ausente; embed falhará (MISS).");
        return new UnavailableEmbeddingAdapter(model || "gemini-embedding-001");
      }
      return new GeminiEmbeddingAdapter(apiKey, model);
    }
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.warn("[embedding] OPENAI_API_KEY ausente; embed falhará (MISS).");
        return new UnavailableEmbeddingAdapter(model || "text-embedding-3-small");
      }
      return new OpenAIEmbeddingAdapter(apiKey, model);
    }
    case "mock":
      return new MockEmbeddingAdapter(model);
    default:
      console.warn(`[embedding] EMBEDDING_PROVIDER desconhecido (${provider}); usando mock.`);
      return new MockEmbeddingAdapter(model);
  }
}

class UnavailableEmbeddingAdapter implements EmbeddingPort {
  readonly modelo: string;

  constructor(modelo: string) {
    this.modelo = modelo;
  }

  async embed(): Promise<number[]> {
    throw new Error("Embedding indisponível: chave de API ausente.");
  }
}
