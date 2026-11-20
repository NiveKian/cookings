import { describe, expect, test } from "bun:test";
import type { ConversationTurn, LLMPort } from "../../domain/ports/LLMPort";
import { PROMPT_JUIZ_RELEVANCIA, RelevanceJudgeAdapter } from "./RelevanceJudgeAdapter";

type Chamada = { systemPrompt: string; turns: ConversationTurn[] };

/** LLM falso que devolve os textos na ordem e registra as chamadas. */
function llmComRespostas(...textos: string[]): LLMPort & { chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  let i = 0;
  return {
    providerName: "fake",
    chamadas,
    converse: async (params) => {
      chamadas.push({ systemPrompt: params.systemPrompt, turns: params.turns });
      return { type: "text", text: textos[Math.min(i++, textos.length - 1)] ?? "" };
    },
  };
}

const ENTRADA = {
  pergunta: "quais ingredientes leva a feijoada?",
  resposta: "Feijão preto, carne seca e linguiça.",
  evidencias: [{ tool: "buscar_receita", argumentos: { nome: "feijoada" }, resultado: { segredo: "EVID" } }],
};

describe("RelevanceJudgeAdapter", () => {
  test("atende true vira aprovar com notas cheias e modo relevância", async () => {
    const llm = llmComRespostas(JSON.stringify({ motivo: "lista os ingredientes", atende: true }));
    const r = await new RelevanceJudgeAdapter(llm).evaluate(ENTRADA);
    expect(r).toEqual({
      status: "ok",
      modo: "relevancia",
      motivo: "lista os ingredientes",
      veredito: "aprovar",
      notas: { fidelidade: 5, coerencia: 5, seguranca: 5, relevancia: 5, clareza: 5 },
      problemas: [],
    });
  });

  test("atende false vira revisar com relevância 1, problema e feedback", async () => {
    const llm = llmComRespostas(JSON.stringify({ motivo: "fala de cursos", atende: false }));
    const r = await new RelevanceJudgeAdapter(llm).evaluate(ENTRADA);
    expect(r.status).toBe("ok");
    expect(r.modo).toBe("relevancia");
    expect(r.motivo).toBe("fala de cursos");
    expect(r.veredito).toBe("revisar");
    expect(r.notas).toEqual({ fidelidade: 5, coerencia: 5, seguranca: 5, relevancia: 1, clareza: 5 });
    expect(r.problemas).toEqual([{ criterio: "relevancia", descricao: "fala de cursos", bloqueante: false }]);
    expect(r.feedbackParaRegeneracao).toBe(
      "A resposta fugiu do pedido (fala de cursos). Responda exatamente ao que o usuário perguntou."
    );
  });

  test("envia só pergunta e resposta, sem evidências, com o prompt de relevância", async () => {
    const llm = llmComRespostas(JSON.stringify({ motivo: "ok", atende: true }));
    await new RelevanceJudgeAdapter(llm).evaluate(ENTRADA);
    expect(llm.chamadas).toHaveLength(1);
    expect(llm.chamadas[0].systemPrompt).toBe(PROMPT_JUIZ_RELEVANCIA);
    expect(llm.chamadas[0].turns).toEqual([
      {
        role: "user",
        content:
          "Pergunta do usuário:\nquais ingredientes leva a feijoada?\n\nResposta do assistente:\nFeijão preto, carne seca e linguiça.",
      },
    ]);
    expect(JSON.stringify(llm.chamadas[0].turns)).not.toContain("EVID");
  });

  test("JSON inválido na primeira tenta de novo e aceita a segunda", async () => {
    const llm = llmComRespostas("não sei", JSON.stringify({ motivo: "ok", atende: true }));
    const r = await new RelevanceJudgeAdapter(llm).evaluate(ENTRADA);
    expect(llm.chamadas).toHaveLength(2);
    expect(r.veredito).toBe("aprovar");
  });

  test("JSON inválido duas vezes devolve indisponível", async () => {
    const llm = llmComRespostas("lixo", '{"atende":"talvez"}');
    const warnOriginal = console.warn;
    console.warn = () => {};
    try {
      const r = await new RelevanceJudgeAdapter(llm).evaluate(ENTRADA);
      expect(llm.chamadas).toHaveLength(2);
      expect(r.status).toBe("unavailable");
    } finally {
      console.warn = warnOriginal;
    }
  });

  test("timeout devolve indisponível", async () => {
    const llm: LLMPort = {
      providerName: "lento",
      converse: (params) =>
        new Promise<never>((_resolve, reject) => {
          params.signal?.addEventListener("abort", () => reject(new Error("abortado")));
        }),
    };
    const warnOriginal = console.warn;
    console.warn = () => {};
    try {
      const r = await new RelevanceJudgeAdapter(llm, 20).evaluate(ENTRADA);
      expect(r.status).toBe("unavailable");
    } finally {
      console.warn = warnOriginal;
    }
  });
});
