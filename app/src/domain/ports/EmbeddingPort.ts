// Porta de embeddings. Independente de LLM_PROVIDER: trocar Gemini/OpenAI/mock
// é só EMBEDDING_PROVIDER + factory. A aplicação não conhece o provedor.

export interface EmbeddingPort {
  /** Nome do modelo usado no vetor (entradas de outro modelo são ignoradas no cache). */
  readonly modelo: string;
  /** Devolve vetor já L2-normalizado; cosseno = produto escalar. */
  embed(texto: string): Promise<number[]>;
}
