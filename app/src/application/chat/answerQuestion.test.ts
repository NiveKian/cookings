import { describe, expect, test } from "bun:test";
import { answerQuestion, AVISO_RESPOSTA_NAO_VERIFICADA } from "./answerQuestion";
import { MockAdapter } from "../../infrastructure/llm/MockAdapter";
import { MockJudgeAdapter } from "../../infrastructure/judge/MockJudgeAdapter";
import { LLMJudgeAdapter } from "../../infrastructure/judge/LLMJudgeAdapter";
import { RelevanceJudgeAdapter } from "../../infrastructure/judge/RelevanceJudgeAdapter";
import { MockEmbeddingAdapter } from "../../infrastructure/embeddings/MockEmbeddingAdapter";
import type { ToolsPort } from "../../domain/ports/ToolsPort";
import type { LLMPort } from "../../domain/ports/LLMPort";
import type {
  CacheHit,
  CacheStoreEntrada,
  SemanticCachePort,
} from "../../domain/ports/SemanticCachePort";
import type { ToolDefinition } from "../../domain/ports/LLMPort";

function toolsSemTools(): ToolsPort {
  return {
    listTools: async () => [],
    callTool: async () => ({}),
  };
}

function deps() {
  return {
    llm: new MockAdapter(),
    tools: toolsSemTools(),
    judge: new MockJudgeAdapter(),
    judgeEnabled: true,
    maxRevisions: 1,
    cacheEnabled: false,
  };
}

class SpyCache implements SemanticCachePort {
  lookups = 0;
  stores = 0;
  invalidacoes: string[][] = [];
  hit: CacheHit | null = null;

  async lookup(): Promise<CacheHit | null> {
    this.lookups += 1;
    return this.hit;
  }
  async store(_entrada: CacheStoreEntrada): Promise<void> {
    this.stores += 1;
  }
  async invalidateByDomains(dominios: string[]): Promise<void> {
    this.invalidacoes.push(dominios);
  }
}

function countingLlm(): LLMPort & { converseCalls: number } {
  const inner = new MockAdapter();
  const wrapped = {
    providerName: inner.providerName,
    converseCalls: 0,
    converse: async (params: Parameters<LLMPort["converse"]>[0]) => {
      wrapped.converseCalls += 1;
      return inner.converse(params);
    },
  };
  return wrapped;
}

describe("answerQuestion", () => {
  test("aviso de reprovação tem o texto novo", () => {
    expect(AVISO_RESPOSTA_NAO_VERIFICADA).toBe("Aviso: o juiz não aprovou esta resposta.");
  });

  test("timeout do juiz entrega a resposta como unavailable, sem aviso e sem gravar cache", async () => {
    const juizLento: LLMPort = {
      providerName: "lento",
      converse: (params) =>
        new Promise<never>((_resolve, reject) => {
          params.signal?.addEventListener("abort", () => reject(new Error("abortado")));
        }),
    };
    const cache = new SpyCache();
    const warnOriginal = console.warn;
    console.warn = () => {};
    try {
      const resultado = await answerQuestion(
        {
          ...deps(),
          judge: new LLMJudgeAdapter(juizLento, 6000, 20),
          cacheEnabled: true,
          cache,
          embedding: new MockEmbeddingAdapter(),
        },
        [{ role: "user", content: "como fazer batata frita rustica?" }]
      );

      expect(resultado.reply).not.toContain(AVISO_RESPOSTA_NAO_VERIFICADA);
      expect(resultado.judge.status).toBe("unavailable");
      expect(resultado.cache.motivo).toBe("juiz-indisponivel");
      expect(cache.stores).toBe(0);
    } finally {
      console.warn = warnOriginal;
    }
  });

  test("resposta normal aprova de primeira, sem aviso, cache sem-cache", async () => {
    const resultado = await answerQuestion(deps(), [{ role: "user", content: "quais cursos tem?" }]);

    expect(resultado.reply).not.toContain(AVISO_RESPOSTA_NAO_VERIFICADA);
    expect(resultado.judge.status).toBe("ok");
    expect(resultado.judge.veredito).toBe("aprovar");
    expect(resultado.cache.usado).toBe(false);
    expect(resultado.cache.motivo).toBe("sem-cache");
  });

  test("[[REVISAR]] regenera e aprova na segunda, reply sem aviso", async () => {
    const resultado = await answerQuestion(deps(), [
      { role: "user", content: "me explique [[REVISAR]]" },
    ]);

    expect(resultado.reply).not.toContain("[[REVISAR]]");
    expect(resultado.reply).not.toContain(AVISO_RESPOSTA_NAO_VERIFICADA);
    expect(resultado.judge.status).toBe("ok");
    expect(resultado.judge.veredito).toBe("aprovar");
    expect(resultado.cache.motivo).toBe("sem-cache");
  });

  test("[[REPROVAR]] até o limite: aviso no final e veredito reprovar", async () => {
    const resultado = await answerQuestion(deps(), [{ role: "user", content: "[[REPROVAR]]" }]);

    expect(resultado.reply.endsWith(AVISO_RESPOSTA_NAO_VERIFICADA)).toBe(true);
    expect(resultado.judge.veredito).toBe("reprovar");
    expect(resultado.judge.status).toBe("ok");
  });

  test("[[INDISPONIVEL]] entrega o texto, juiz unavailable, sem aviso de recusa", async () => {
    const resultado = await answerQuestion(deps(), [
      { role: "user", content: "oi [[INDISPONIVEL]]" },
    ]);

    expect(resultado.reply).toContain("[[INDISPONIVEL]]");
    expect(resultado.reply).not.toContain(AVISO_RESPOSTA_NAO_VERIFICADA);
    expect(resultado.judge.status).toBe("unavailable");
    expect(resultado.cache.motivo).toBe("juiz-indisponivel");
  });

  test("HIT devolve resposta do cache sem chamar o LLM", async () => {
    const llm = countingLlm();
    const cache = new SpyCache();
    cache.hit = {
      pergunta: "quais cursos tem?",
      resposta: "resposta cacheada",
      similaridade: 0.97,
      dominios: ["cursos"],
      modeloEmbedding: "mock-bow-256",
    };

    const resultado = await answerQuestion(
      {
        ...deps(),
        llm,
        cache,
        embedding: new MockEmbeddingAdapter(),
        cacheEnabled: true,
      },
      [{ role: "user", content: "quais cursos tem?" }]
    );

    expect(resultado.reply).toBe("resposta cacheada");
    expect(resultado.cache.usado).toBe(true);
    expect(resultado.cache.motivo).toBe("hit");
    expect(resultado.cache.similaridade).toBe(0.97);
    expect(resultado.judge.veredito).toBe("aprovar");
    expect(llm.converseCalls).toBe(0);
  });

  test("histórico com 2 users não consulta o cache", async () => {
    const cache = new SpyCache();
    await answerQuestion(
      {
        ...deps(),
        cache,
        embedding: new MockEmbeddingAdapter(),
        cacheEnabled: true,
      },
      [
        { role: "user", content: "quais cursos" },
        { role: "assistant", content: "tem massas" },
        { role: "user", content: "e o segundo?" },
      ]
    );
    expect(cache.lookups).toBe(0);
    expect(cache.stores).toBe(0);
  });

  test("novidade invente um bolo não consulta nem grava", async () => {
    const cache = new SpyCache();
    await answerQuestion(
      {
        ...deps(),
        cache,
        embedding: new MockEmbeddingAdapter(),
        cacheEnabled: true,
      },
      [{ role: "user", content: "invente um bolo" }]
    );
    expect(cache.lookups).toBe(0);
    expect(cache.stores).toBe(0);
  });

  test("MISS depois de aprovar grava no cache", async () => {
    const cache = new SpyCache();
    const resultado = await answerQuestion(
      {
        ...deps(),
        cache,
        embedding: new MockEmbeddingAdapter(),
        cacheEnabled: true,
      },
      [{ role: "user", content: "quais cursos tem?" }]
    );
    expect(resultado.cache.usado).toBe(false);
    expect(resultado.cache.motivo).toBe("miss");
    expect(cache.lookups).toBe(1);
    expect(cache.stores).toBe(1);
  });

  test("evidência de criar_receita invalida domínio receitas e não grava", async () => {
    const cache = new SpyCache();
    const tools: ToolsPort = {
      listTools: async (): Promise<ToolDefinition[]> => [
        { name: "criar_receita", description: "Cria receita", inputSchema: {} },
      ],
      callTool: async () => ({ ok: true }),
    };

    const resultado = await answerQuestion(
      {
        ...deps(),
        tools,
        cache,
        embedding: new MockEmbeddingAdapter(),
        cacheEnabled: true,
      },
      [{ role: "user", content: "TOOL:criar_receita:{}" }]
    );

    expect(cache.invalidacoes).toEqual([["receitas"]]);
    expect(cache.stores).toBe(0);
    expect(resultado.cache.motivo).toBe("mutavel");
  });

  test("juiz leve fora do tema regenera uma vez e termina reprovar com modo e motivo", async () => {
    const llmJuiz: LLMPort = {
      providerName: "fake",
      converse: async () => ({ type: "text", text: JSON.stringify({ motivo: "fala de cursos", atende: false }) }),
    };
    const llm = countingLlm();
    const resultado = await answerQuestion(
      { ...deps(), llm, judge: new RelevanceJudgeAdapter(llmJuiz) },
      [{ role: "user", content: "quais ingredientes leva a feijoada?" }]
    );

    expect(llm.converseCalls).toBe(2);
    expect(resultado.reply.endsWith(AVISO_RESPOSTA_NAO_VERIFICADA)).toBe(true);
    expect(resultado.judge.veredito).toBe("reprovar");
    expect(resultado.judge.modo).toBe("relevancia");
    expect(resultado.judge.motivo).toBe("fala de cursos");
  });
});
