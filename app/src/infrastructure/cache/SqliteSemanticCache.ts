import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  CacheHit,
  CacheStoreEntrada,
  SemanticCachePort,
} from "../../domain/ports/SemanticCachePort";
import { produtoEscalar } from "../embeddings/vector";

const TABELA = `CREATE TABLE IF NOT EXISTS semantic_cache (
  pergunta TEXT NOT NULL,
  embedding TEXT NOT NULL,
  resposta TEXT NOT NULL,
  dominios TEXT NOT NULL,
  modeloEmbedding TEXT NOT NULL,
  criadoEm INTEGER NOT NULL,
  expiraEm INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
)`;

type LinhaCache = {
  id: number;
  pergunta: string;
  embedding: string;
  resposta: string;
  dominios: string;
  modeloEmbedding: string;
  hits: number;
};

/**
 * Cache semântico em bun:sqlite. Se o disco falhar no construtor, vira no-op
 * (lookup = MISS, store/invalidate vazios) e não derruba o processo.
 */
export class SqliteSemanticCache implements SemanticCachePort {
  private db: Database | null = null;

  constructor(caminho: string) {
    try {
      if (caminho !== ":memory:") {
        mkdirSync(dirname(caminho), { recursive: true });
      }
      this.db = new Database(caminho);
      // DELETE evita -wal/-shm que no Windows ficam travados depois do close.
      this.db.run("PRAGMA journal_mode = DELETE");
      this.db.run(TABELA);
    } catch (err) {
      console.warn("[cache] falha ao abrir sqlite; cache no-op:", err);
      try {
        this.db?.close();
      } catch {
        // ignore
      }
      this.db = null;
    }
  }

  async lookup(
    _perguntaNormalizada: string,
    embedding: number[],
    modelo: string,
    limiar: number
  ): Promise<CacheHit | null> {
    if (!this.db) return null;

    const agora = Date.now();
    const linhas = this.db
      .query(
        `SELECT rowid AS id, pergunta, embedding, resposta, dominios, modeloEmbedding, hits
         FROM semantic_cache
         WHERE modeloEmbedding = ? AND expiraEm > ?`
      )
      .all(modelo, agora) as LinhaCache[];

    let melhor: { linha: LinhaCache; similaridade: number; dominios: string[] } | null = null;

    for (const linha of linhas) {
      const vetor = parseVetor(linha.embedding);
      if (!vetor) continue;
      const similaridade = produtoEscalar(embedding, vetor);
      if (similaridade < limiar) continue;
      if (!melhor || similaridade > melhor.similaridade) {
        const dominios = parseDominios(linha.dominios);
        melhor = { linha, similaridade, dominios };
      }
    }

    if (!melhor) return null;

    this.db.run("UPDATE semantic_cache SET hits = hits + 1 WHERE rowid = ?", [melhor.linha.id]);

    return {
      pergunta: melhor.linha.pergunta,
      resposta: melhor.linha.resposta,
      similaridade: melhor.similaridade,
      dominios: melhor.dominios,
      modeloEmbedding: melhor.linha.modeloEmbedding,
    };
  }

  async store(entrada: CacheStoreEntrada): Promise<void> {
    if (!this.db) return;

    const criadoEm = Date.now();
    const expiraEm = criadoEm + entrada.ttlMinutes * 60 * 1000;

    this.db.run(
      `INSERT INTO semantic_cache
        (pergunta, embedding, resposta, dominios, modeloEmbedding, criadoEm, expiraEm, hits)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        entrada.pergunta,
        JSON.stringify(entrada.embedding),
        entrada.resposta,
        JSON.stringify(entrada.dominios),
        entrada.modeloEmbedding,
        criadoEm,
        expiraEm,
      ]
    );
  }

  async invalidateByDomains(dominios: string[]): Promise<void> {
    if (!this.db || dominios.length === 0) return;

    const alvo = new Set(dominios);
    const linhas = this.db
      .query("SELECT rowid AS id, dominios FROM semantic_cache")
      .all() as Array<{ id: number; dominios: string }>;

    const apagar: number[] = [];
    for (const linha of linhas) {
      const guardados = parseDominios(linha.dominios);
      if (guardados.some((d) => alvo.has(d))) apagar.push(linha.id);
    }

    if (apagar.length === 0) return;

    const stmt = this.db.prepare("DELETE FROM semantic_cache WHERE rowid = ?");
    for (const id of apagar) stmt.run(id);
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      // ignore
    }
    this.db = null;
  }
}

function parseVetor(json: string): number[] | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const vetor = parsed.map((x) => Number(x));
    if (vetor.some((x) => !Number.isFinite(x))) return null;
    return vetor;
  } catch {
    return null;
  }
}

function parseDominios(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is string => typeof d === "string");
  } catch {
    return [];
  }
}
