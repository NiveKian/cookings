import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "../../domain/entities";
import type { Evidencia, JudgeVerdict } from "../../domain/ports/JudgePort";
import {
  dominiosDasEvidencias,
  dominiosMutaveis,
  isPedidoDeNovidade,
  isStandalone,
  normalizarPergunta,
  podeConsultarCache,
  podeGravarCache,
  temToolMutavel,
} from "./cacheRules";

const aprovar: JudgeVerdict = {
  status: "ok",
  veredito: "aprovar",
  notas: { fidelidade: 5, coerencia: 5, seguranca: 5, relevancia: 5, clareza: 5 },
  problemas: [],
};

function ev(tool: string): Evidencia {
  return { tool, argumentos: {}, resultado: {} };
}

describe("cacheRules", () => {
  test("standalone: exatamente 1 user, mesmo com saudação do assistente", () => {
    const um: ChatMessage[] = [
      { role: "assistant", content: "olá" },
      { role: "user", content: "quais cursos?" },
    ];
    const dois: ChatMessage[] = [
      ...um,
      { role: "assistant", content: "tem massas" },
      { role: "user", content: "e o segundo?" },
    ];
    expect(isStandalone(um)).toBe(true);
    expect(isStandalone(dois)).toBe(false);
    expect(isStandalone([])).toBe(false);
  });

  test("novidade: invent/outra/diferente/surpreend", () => {
    expect(isPedidoDeNovidade("invente um bolo")).toBe(true);
    expect(isPedidoDeNovidade("Inventar uma sobremesa")).toBe(true);
    expect(isPedidoDeNovidade("me dê outra receita")).toBe(true);
    expect(isPedidoDeNovidade("algo diferente")).toBe(true);
    expect(isPedidoDeNovidade("surpreenda")).toBe(true);
    expect(isPedidoDeNovidade("quais cursos de massas")).toBe(false);
  });

  test("normalizarPergunta colapsa espaços e tira acento", () => {
    expect(normalizarPergunta("  Quais   Cursos  ")).toBe("quais cursos");
    expect(normalizarPergunta("Feijão")).toBe("feijao");
  });

  test("mutável e domínios", () => {
    const evidencias = [ev("listar_cursos"), ev("criar_receita"), ev("tool_desconhecida")];
    expect(temToolMutavel(evidencias)).toBe(true);
    expect(temToolMutavel([ev("listar_cursos")])).toBe(false);
    expect(dominiosDasEvidencias(evidencias).sort()).toEqual(["cursos", "receitas"]);
    expect(dominiosMutaveis(evidencias)).toEqual(["receitas"]);
  });

  test("lookup só se CACHE_ENABLED, standalone e não novidade", () => {
    const history: ChatMessage[] = [{ role: "user", content: "quais cursos de massas" }];
    expect(podeConsultarCache({ cacheEnabled: true, history, pergunta: history[0].content })).toBe(
      true
    );
    expect(podeConsultarCache({ cacheEnabled: false, history, pergunta: history[0].content })).toBe(
      false
    );
    expect(
      podeConsultarCache({
        cacheEnabled: true,
        history: [...history, { role: "user", content: "e o segundo?" }],
        pergunta: "e o segundo?",
      })
    ).toBe(false);
    expect(
      podeConsultarCache({ cacheEnabled: true, history, pergunta: "invente um bolo" })
    ).toBe(false);
  });

  test("gravar exige juiz ok/aprovar, sem mutável, embedding ok", () => {
    const history: ChatMessage[] = [{ role: "user", content: "quais cursos" }];
    const base = {
      cacheEnabled: true,
      history,
      pergunta: "quais cursos",
      judge: aprovar,
      evidencias: [ev("listar_cursos")],
      embeddingOk: true,
    };
    expect(podeGravarCache(base)).toBe(true);
    expect(podeGravarCache({ ...base, cacheEnabled: false })).toBe(false);
    expect(podeGravarCache({ ...base, pergunta: "invente um bolo" })).toBe(false);
    expect(podeGravarCache({ ...base, evidencias: [ev("criar_receita")] })).toBe(false);
    expect(podeGravarCache({ ...base, embeddingOk: false })).toBe(false);
    expect(
      podeGravarCache({
        ...base,
        judge: { ...aprovar, status: "unavailable", veredito: "reprovar" },
      })
    ).toBe(false);
    expect(podeGravarCache({ ...base, judge: { ...aprovar, veredito: "reprovar" } })).toBe(false);
  });
});
