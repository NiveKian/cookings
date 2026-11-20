import { describe, expect, test } from "bun:test";
import { LLMJudgeAdapter, PROMPT_JUIZ } from "./LLMJudgeAdapter";
import type { LLMPort } from "../../domain/ports/LLMPort";

/** LLM que nunca responde; registra se o signal foi abortado. */
function llmQueNuncaResponde(): LLMPort & { abortado: boolean } {
  const llm = {
    providerName: "lento",
    abortado: false,
    converse: (params: Parameters<LLMPort["converse"]>[0]) =>
      new Promise<never>((_resolve, reject) => {
        params.signal?.addEventListener("abort", () => {
          llm.abortado = true;
          reject(new Error("abortado"));
        });
      }),
  };
  return llm;
}

describe("LLMJudgeAdapter", () => {
  test("prompt não traz exemplo com notas literais 1", () => {
    expect(PROMPT_JUIZ).not.toContain('"fidelidade":1');
    expect(PROMPT_JUIZ).not.toContain('"fidelidade": 1');
    expect(PROMPT_JUIZ).toContain("<1 a 5>");
  });

  test("prompt orienta não penalizar falta de evidências em receita inventada", () => {
    expect(PROMPT_JUIZ).toContain("Não penalize a falta de evidências");
  });

  test("timeout aborta a chamada e devolve unavailable", async () => {
    const llm = llmQueNuncaResponde();
    const juiz = new LLMJudgeAdapter(llm, 6000, 20);
    const warnOriginal = console.warn;
    console.warn = () => {};
    try {
      const resultado = await juiz.evaluate({ pergunta: "p", resposta: "r", evidencias: [] });
      expect(resultado.status).toBe("unavailable");
      expect(llm.abortado).toBe(true);
    } finally {
      console.warn = warnOriginal;
    }
  });

  test("saída com notas inteiras e feedback vazio é aceita pelo Zod", async () => {
    const llm: LLMPort = {
      providerName: "fake",
      converse: async () => ({
        type: "text",
        text: JSON.stringify({
          veredito: "aprovar",
          notas: { fidelidade: 5, coerencia: 4, seguranca: 5, relevancia: 5, clareza: 4 },
          problemas: [],
          feedbackParaRegeneracao: "",
        }),
      }),
    };
    const resultado = await new LLMJudgeAdapter(llm).evaluate({ pergunta: "p", resposta: "r", evidencias: [] });
    expect(resultado.status).toBe("ok");
    expect(resultado.veredito).toBe("aprovar");
    expect(resultado).not.toHaveProperty("feedbackParaRegeneracao");
  });
});
