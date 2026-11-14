// Porta do cache semântico. A aplicação só conhece lookup/store/invalidate;
// SQLite (ou no-op) fica na infraestrutura.

export interface CacheHit {
  pergunta: string;
  resposta: string;
  similaridade: number;
  dominios: string[];
  modeloEmbedding: string;
}

export interface CacheStoreEntrada {
  pergunta: string;
  embedding: number[];
  resposta: string;
  dominios: string[];
  modeloEmbedding: string;
  ttlMinutes: number;
}

export interface SemanticCachePort {
  lookup(
    perguntaNormalizada: string,
    embedding: number[],
    modelo: string,
    limiar: number
  ): Promise<CacheHit | null>;
  store(entrada: CacheStoreEntrada): Promise<void>;
  invalidateByDomains(dominios: string[]): Promise<void>;
}
