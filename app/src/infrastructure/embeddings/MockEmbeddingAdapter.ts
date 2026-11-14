import type { EmbeddingPort } from "../../domain/ports/EmbeddingPort";
import { semAcento } from "../../domain/texto";
import { DIMENSOES_MOCK, l2Normalizar } from "./vector";

const MODELO_PADRAO = "mock-bow-256";

/**
 * Bag-of-words determinístico para testes sem chave.
 * Tokeniza [a-z0-9] depois de tirar acento; cada token vira um índice
 * em 256 dimensões (hash estável, não criptográfico); soma e L2-normaliza.
 * Texto sem tokens → vetor de zeros.
 */
export class MockEmbeddingAdapter implements EmbeddingPort {
  readonly modelo: string;

  constructor(modelo?: string) {
    this.modelo = modelo?.trim() || MODELO_PADRAO;
  }

  async embed(texto: string): Promise<number[]> {
    const tokens = tokenizar(texto);
    const vetor = new Array<number>(DIMENSOES_MOCK).fill(0);
    for (const token of tokens) {
      vetor[indiceDoToken(token)] += 1;
    }
    return l2Normalizar(vetor);
  }
}

function tokenizar(texto: string): string[] {
  return semAcento(texto).match(/[a-z0-9]+/g) ?? [];
}

// djb2: estável entre processos; não é crypto.
function indiceDoToken(token: string): number {
  let h = 5381;
  for (let i = 0; i < token.length; i++) {
    h = (Math.imul(h, 33) + token.charCodeAt(i)) | 0;
  }
  return (h >>> 0) % DIMENSOES_MOCK;
}
