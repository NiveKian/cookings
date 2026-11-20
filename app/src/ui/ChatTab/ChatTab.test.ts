import { describe, expect, test } from "bun:test";
import type { ChatJudgeMeta } from "../../domain/entities";
import { estadoJuiz, linhasNotas, seloOrigem } from "./ChatTab";

describe("seloOrigem", () => {
  test("acerto de cache mostra 'Resposta do Cache' e a similaridade no detalhe", () => {
    expect(seloOrigem({ usado: true, motivo: "hit", similaridade: 0.9712 })).toEqual({
      texto: "Resposta do Cache",
      detalhe: "similaridade 0.97 · sem chamada à IA nem ao juiz",
      deCache: true,
    });
  });

  test("acerto de cache sem similaridade omite o trecho", () => {
    expect(seloOrigem({ usado: true, motivo: "hit" })).toEqual({
      texto: "Resposta do Cache",
      detalhe: "sem chamada à IA nem ao juiz",
      deCache: true,
    });
  });

  test("miss indica 'Gerado por AI' gravada no cache", () => {
    expect(seloOrigem({ usado: false, motivo: "miss" })).toEqual({
      texto: "Gerado por AI",
      detalhe: "gravada no cache",
      deCache: false,
    });
  });

  test("motivos de não gravação têm texto explicativo", () => {
    const casos: Record<string, string> = {
      "juiz-indisponivel": "não gravada no cache: juiz indisponível",
      reprovado: "não gravada no cache: juiz não aprovou",
      "nao-standalone": "não gravada no cache: só a 1ª pergunta da conversa usa o cache",
      novidade: "não gravada no cache: pedido de algo novo",
      mutavel: "não gravada no cache: ação que altera dados",
      "sem-cache": "cache desligado",
    };
    for (const [motivo, detalhe] of Object.entries(casos)) {
      expect(seloOrigem({ usado: false, motivo })).toEqual({
        texto: "Gerado por AI",
        detalhe,
        deCache: false,
      });
    }
  });

  test("motivo desconhecido aparece cru", () => {
    expect(seloOrigem({ usado: false, motivo: "xyz" }).detalhe).toBe("xyz");
  });
});

const notas = { fidelidade: 5, coerencia: 4, seguranca: 4, relevancia: 5, clareza: 4 };
const juiz = (p: Partial<ChatJudgeMeta>): ChatJudgeMeta => ({
  status: "ok",
  veredito: "aprovar",
  notas,
  ...p,
});

describe("estadoJuiz", () => {
  test("aprovar fica verde", () => {
    expect(estadoJuiz(juiz({}))).toEqual({
      texto: "juiz: aprovada",
      cor: "bg-emerald-50 text-emerald-700",
    });
  });

  test("revisar fica âmbar", () => {
    expect(estadoJuiz(juiz({ veredito: "revisar" }))).toEqual({
      texto: "juiz: revisar",
      cor: "bg-amber-50 text-amber-700",
    });
  });

  test("reprovar fica vermelho", () => {
    expect(estadoJuiz(juiz({ veredito: "reprovar" }))).toEqual({
      texto: "juiz: reprovada",
      cor: "bg-red-50 text-red-700",
    });
  });

  test("indisponível fica cinza, qualquer que seja o veredito", () => {
    expect(estadoJuiz(juiz({ status: "unavailable", veredito: "aprovar" }))).toEqual({
      texto: "juiz: indisponível",
      cor: "bg-neutral-100 text-neutral-500",
    });
  });
});

describe("linhasNotas", () => {
  test("lista os cinco critérios com nota e descrição", () => {
    const l = linhasNotas(juiz({}));
    expect(l).toHaveLength(5);
    expect(l[0]).toBe("fidelidade 5/5 — bate com o que as ferramentas devolveram");
    expect(l[4]).toBe("clareza 4/5 — texto claro, sem enrolação");
  });
});
