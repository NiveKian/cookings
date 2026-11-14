import { beforeEach, describe, expect, test } from "bun:test";
import { recordChatAnswer, resetChatMetrics, snapshotChatMetrics } from "./chatMetrics";

const notas5 = { fidelidade: 5, coerencia: 5, seguranca: 5, relevancia: 5, clareza: 5 };
const notas3 = { fidelidade: 3, coerencia: 3, seguranca: 3, relevancia: 3, clareza: 3 };

describe("chatMetrics", () => {
  beforeEach(() => {
    resetChatMetrics();
  });

  test("snapshot começa zerado", () => {
    expect(snapshotChatMetrics()).toEqual({
      hits: 0,
      misses: 0,
      chamadasLlmEvitadas: 0,
      vereditos: { aprovar: 0, revisar: 0, reprovar: 0 },
      mediaNotas: 0,
      latenciaMediaMsComCache: 0,
      latenciaMediaMsSemCache: 0,
    });
  });

  test("hit incrementa hits e chamadasLlmEvitadas; miss não", () => {
    recordChatAnswer({
      hit: true,
      veredito: "aprovar",
      status: "ok",
      notas: notas5,
      latenciaMs: 10,
    });
    recordChatAnswer({
      hit: false,
      veredito: "aprovar",
      status: "ok",
      notas: notas5,
      latenciaMs: 30,
    });

    const s = snapshotChatMetrics();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.chamadasLlmEvitadas).toBe(1);
    expect(s.vereditos.aprovar).toBe(2);
    expect(s.latenciaMediaMsComCache).toBe(10);
    expect(s.latenciaMediaMsSemCache).toBe(30);
  });

  test("média das 5 notas só conta status ok", () => {
    recordChatAnswer({
      hit: false,
      veredito: "aprovar",
      status: "ok",
      notas: notas5,
      latenciaMs: 1,
    });
    recordChatAnswer({
      hit: false,
      veredito: "reprovar",
      status: "unavailable",
      notas: notas3,
      latenciaMs: 1,
    });

    const s = snapshotChatMetrics();
    expect(s.mediaNotas).toBe(5);
    expect(s.vereditos.reprovar).toBe(1);
  });
});
