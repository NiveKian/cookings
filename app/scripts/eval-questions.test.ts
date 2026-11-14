import { describe, expect, test } from "bun:test";
import perguntas from "./eval-questions.json";

describe("eval-questions.json", () => {
  test("tem 20 perguntas em português com paráfrase, follow-up, novidade e lactose", () => {
    expect(perguntas).toHaveLength(20);
    const textos = perguntas.map((q) => q.pergunta.toLowerCase());
    expect(perguntas.some((q) => q.followUp === true)).toBe(true);
    expect(textos.some((t) => t.includes("invente"))).toBe(true);
    expect(textos.some((t) => t.includes("lactose"))).toBe(true);
    expect(new Set(perguntas.map((q) => q.id)).size).toBe(20);
  });
});
