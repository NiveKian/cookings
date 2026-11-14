import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPedidoDeNovidade,
  isStandalone,
  normalizarPergunta,
  podeConsultarCache,
  podeGravarCache,
} from "../../application/chat/cacheRules";
import type { JudgeVerdict } from "../../domain/ports/JudgePort";
import { produtoEscalar } from "../embeddings/vector";
import { MockEmbeddingAdapter } from "../embeddings/MockEmbeddingAdapter";
import { SqliteSemanticCache } from "./SqliteSemanticCache";

const aprovar: JudgeVerdict = {
  status: "ok",
  veredito: "aprovar",
  notas: { fidelidade: 5, coerencia: 5, seguranca: 5, relevancia: 5, clareza: 5 },
  problemas: [],
};

describe("cache.integration", () => {
  const dirs: string[] = [];
  const caches: SqliteSemanticCache[] = [];

  function novoCache(): { cache: SqliteSemanticCache; embedder: MockEmbeddingAdapter } {
    const dir = mkdtempSync(join(tmpdir(), "cookings-cache-"));
    dirs.push(dir);
    const cache = new SqliteSemanticCache(join(dir, "cache.sqlite"));
    caches.push(cache);
    return { cache, embedder: new MockEmbeddingAdapter() };
  }

  afterEach(async () => {
    for (const c of caches) c.close();
    caches.length = 0;
    for (const dir of dirs) await apagarDirComRetry(dir);
    dirs.length = 0;
  });

  test("pergunta repetida literal → HIT", async () => {
    const { cache, embedder } = novoCache();
    const q = normalizarPergunta("quais cursos de massas");
    const v = await embedder.embed(q);
    await cache.store({
      pergunta: q,
      embedding: v,
      resposta: "Temos curso de massas.",
      dominios: ["cursos"],
      modeloEmbedding: embedder.modelo,
      ttlMinutes: 60,
    });

    const hit = await cache.lookup(q, v, embedder.modelo, 0.9);
    expect(hit).not.toBeNull();
    expect(hit!.resposta).toBe("Temos curso de massas.");
    expect(hit!.similaridade).toBeCloseTo(1, 5);
  });

  test("paráfrase com as mesmas palavras em outra ordem → HIT (limiar 0.9)", async () => {
    const { cache, embedder } = novoCache();
    const q1 = normalizarPergunta("cursos de massas quais");
    const q2 = normalizarPergunta("quais cursos de massas");
    const v1 = await embedder.embed(q1);
    const v2 = await embedder.embed(q2);
    // cosseno medido (MockEmbeddingAdapter, execução real): 1
    const cos = produtoEscalar(v1, v2);
    expect(cos).toBeCloseTo(1, 10);
    expect(cos).toBeGreaterThanOrEqual(0.9);

    await cache.store({
      pergunta: q1,
      embedding: v1,
      resposta: "Lista de cursos de massas.",
      dominios: ["cursos"],
      modeloEmbedding: embedder.modelo,
      ttlMinutes: 60,
    });

    const hit = await cache.lookup(q2, v2, embedder.modelo, 0.9);
    expect(hit).not.toBeNull();
    expect(hit!.resposta).toBe("Lista de cursos de massas.");
    expect(hit!.similaridade).toBeCloseTo(cos, 10);
  });

  test("pergunta diferente → MISS", async () => {
    const { cache, embedder } = novoCache();
    const q1 = normalizarPergunta("receita de feijoada");
    const q2 = normalizarPergunta("curso de massas");
    const v1 = await embedder.embed(q1);
    const v2 = await embedder.embed(q2);
    const cos = produtoEscalar(v1, v2);
    expect(cos).toBeLessThan(0.9);

    await cache.store({
      pergunta: q1,
      embedding: v1,
      resposta: "Feijoada...",
      dominios: ["receitas"],
      modeloEmbedding: embedder.modelo,
      ttlMinutes: 60,
    });

    const hit = await cache.lookup(q2, v2, embedder.modelo, 0.9);
    expect(hit).toBeNull();
  });

  test("histórico com 2 users → lookup nem é chamado (standalone)", () => {
    const history = [
      { role: "user" as const, content: "quais cursos" },
      { role: "assistant" as const, content: "tem massas" },
      { role: "user" as const, content: "e o segundo?" },
    ];
    expect(isStandalone(history)).toBe(false);
    expect(
      podeConsultarCache({ cacheEnabled: true, history, pergunta: "e o segundo?" })
    ).toBe(false);
  });

  test("novidade 'invente um bolo' → não grava e não consulta", () => {
    const history = [{ role: "user" as const, content: "invente um bolo" }];
    expect(isPedidoDeNovidade("invente um bolo")).toBe(true);
    expect(
      podeConsultarCache({ cacheEnabled: true, history, pergunta: "invente um bolo" })
    ).toBe(false);
    expect(
      podeGravarCache({
        cacheEnabled: true,
        history,
        pergunta: "invente um bolo",
        judge: aprovar,
        evidencias: [],
        embeddingOk: true,
      })
    ).toBe(false);
  });

  test("tool mutável criar_receita apaga domínio receitas; cursos permanece", async () => {
    const { cache, embedder } = novoCache();
    const qReceita = normalizarPergunta("receita de bolo");
    const qCurso = normalizarPergunta("quais cursos");
    const vReceita = await embedder.embed(qReceita);
    const vCurso = await embedder.embed(qCurso);

    await cache.store({
      pergunta: qReceita,
      embedding: vReceita,
      resposta: "Bolo.",
      dominios: ["receitas"],
      modeloEmbedding: embedder.modelo,
      ttlMinutes: 60,
    });
    await cache.store({
      pergunta: qCurso,
      embedding: vCurso,
      resposta: "Cursos.",
      dominios: ["cursos"],
      modeloEmbedding: embedder.modelo,
      ttlMinutes: 60,
    });

    await cache.invalidateByDomains(["receitas"]);

    expect(await cache.lookup(qReceita, vReceita, embedder.modelo, 0.9)).toBeNull();
    const hitCurso = await cache.lookup(qCurso, vCurso, embedder.modelo, 0.9);
    expect(hitCurso).not.toBeNull();
    expect(hitCurso!.resposta).toBe("Cursos.");
  });

  test("entrada com expiraEm no passado → MISS", async () => {
    const { cache, embedder } = novoCache();
    const q = normalizarPergunta("quais cursos");
    const v = await embedder.embed(q);
    // ttlMinutes negativo: expiraEm = criadoEm - 1 min (passado)
    await cache.store({
      pergunta: q,
      embedding: v,
      resposta: "Cursos.",
      dominios: ["cursos"],
      modeloEmbedding: embedder.modelo,
      ttlMinutes: -1,
    });

    expect(await cache.lookup(q, v, embedder.modelo, 0.9)).toBeNull();
  });

  test("store com modeloEmbedding a não é devolvida se lookup pede b", async () => {
    const { cache, embedder } = novoCache();
    const q = normalizarPergunta("quais cursos");
    const v = await embedder.embed(q);
    await cache.store({
      pergunta: q,
      embedding: v,
      resposta: "Cursos.",
      dominios: ["cursos"],
      modeloEmbedding: "a",
      ttlMinutes: 60,
    });

    expect(await cache.lookup(q, v, "b", 0.9)).toBeNull();
    const hit = await cache.lookup(q, v, "a", 0.9);
    expect(hit).not.toBeNull();
    expect(hit!.modeloEmbedding).toBe("a");
  });
});

async function apagarDirComRetry(dir: string): Promise<void> {
  for (let i = 0; i < 8; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(40 * (i + 1));
    }
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn("[cache test] temp sqlite ainda travado no Windows, segue:", dir, err);
  }
}
