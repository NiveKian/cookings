import { describe, expect, test } from "bun:test";
import { parseChatHistory } from "./ChatHistoryStorage";

describe("parseChatHistory", () => {
  test("formato antigo só com role e content continua válido", () => {
    const parsed = parseChatHistory([
      { role: "assistant", content: "Oi" },
      { role: "user", content: "quais cursos" },
    ]);
    expect(parsed).toEqual([
      { role: "assistant", content: "Oi" },
      { role: "user", content: "quais cursos" },
    ]);
  });

  test("metadados de cache e juiz sobrevivem na leitura", () => {
    const parsed = parseChatHistory([
      {
        role: "assistant",
        content: "Temos massas.",
        cache: { usado: true, motivo: "hit", similaridade: 0.97 },
        judge: {
          status: "ok",
          veredito: "aprovar",
          notas: { fidelidade: 5, coerencia: 5, seguranca: 5, relevancia: 5, clareza: 5 },
        },
      },
    ]);
    expect(parsed?.[0].cache?.usado).toBe(true);
    expect(parsed?.[0].cache?.similaridade).toBe(0.97);
    expect(parsed?.[0].judge?.veredito).toBe("aprovar");
  });

  test("item lixo é ignorado; array inválido vira null", () => {
    expect(parseChatHistory("nao e array")).toBeNull();
    expect(parseChatHistory([{ role: "system", content: "x" }])).toBeNull();
    const mixed = parseChatHistory([
      { role: "user", content: "ok" },
      { foo: 1 },
    ]);
    expect(mixed).toEqual([{ role: "user", content: "ok" }]);
  });

  test("modo e motivo do juiz leve sobrevivem; valores inválidos são descartados", () => {
    const notas = { fidelidade: 5, coerencia: 5, seguranca: 5, relevancia: 1, clareza: 5 };
    const parsed = parseChatHistory([
      {
        role: "assistant",
        content: "Temos cursos.",
        judge: { status: "ok", veredito: "reprovar", notas, modo: "relevancia", motivo: "fala de cursos" },
      },
      {
        role: "assistant",
        content: "Outro.",
        judge: { status: "ok", veredito: "aprovar", notas, modo: "xyz", motivo: 3 },
      },
    ]);
    expect(parsed?.[0].judge?.modo).toBe("relevancia");
    expect(parsed?.[0].judge?.motivo).toBe("fala de cursos");
    expect(parsed?.[1].judge).not.toHaveProperty("modo");
    expect(parsed?.[1].judge).not.toHaveProperty("motivo");
  });
});
