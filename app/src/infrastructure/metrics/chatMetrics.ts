// Contadores em memória do processo do server.ts. Não persiste (nem sqlite).
// Zera ao reiniciar o processo. GET /api/metrics lê o snapshot daqui.

export interface ChatMetricsSnapshot {
  hits: number;
  misses: number;
  chamadasLlmEvitadas: number;
  vereditos: {
    aprovar: number;
    revisar: number;
    reprovar: number;
  };
  mediaNotas: number;
  latenciaMediaMsComCache: number;
  latenciaMediaMsSemCache: number;
}

export interface ChatAnswerMetricInput {
  hit: boolean;
  veredito: "aprovar" | "revisar" | "reprovar";
  status: "ok" | "unavailable";
  notas: {
    fidelidade: number;
    coerencia: number;
    seguranca: number;
    relevancia: number;
    clareza: number;
  };
  latenciaMs: number;
}

type Interno = {
  hits: number;
  misses: number;
  chamadasLlmEvitadas: number;
  vereditos: { aprovar: number; revisar: number; reprovar: number };
  somaMediasNotas: number;
  notasOk: number;
  somaLatenciaHit: number;
  somaLatenciaMiss: number;
};

function vazio(): Interno {
  return {
    hits: 0,
    misses: 0,
    chamadasLlmEvitadas: 0,
    vereditos: { aprovar: 0, revisar: 0, reprovar: 0 },
    somaMediasNotas: 0,
    notasOk: 0,
    somaLatenciaHit: 0,
    somaLatenciaMiss: 0,
  };
}

let estado: Interno = vazio();

/** Testes: volta os contadores a zero. */
export function resetChatMetrics(): void {
  estado = vazio();
}

/**
 * Uma resposta do orquestrador. Hit evita o LLM principal.
 * Média das 5 notas só entra quando o juiz veio com status ok.
 */
export function recordChatAnswer(input: ChatAnswerMetricInput): void {
  const latencia = Number.isFinite(input.latenciaMs) ? Math.max(0, input.latenciaMs) : 0;

  if (input.hit) {
    estado.hits += 1;
    estado.chamadasLlmEvitadas += 1;
    estado.somaLatenciaHit += latencia;
  } else {
    estado.misses += 1;
    estado.somaLatenciaMiss += latencia;
  }

  estado.vereditos[input.veredito] += 1;

  if (input.status === "ok") {
    const n = input.notas;
    const media =
      (n.fidelidade + n.coerencia + n.seguranca + n.relevancia + n.clareza) / 5;
    if (Number.isFinite(media)) {
      estado.somaMediasNotas += media;
      estado.notasOk += 1;
    }
  }
}

export function snapshotChatMetrics(): ChatMetricsSnapshot {
  return {
    hits: estado.hits,
    misses: estado.misses,
    chamadasLlmEvitadas: estado.chamadasLlmEvitadas,
    vereditos: { ...estado.vereditos },
    mediaNotas: estado.notasOk === 0 ? 0 : estado.somaMediasNotas / estado.notasOk,
    latenciaMediaMsComCache: estado.hits === 0 ? 0 : estado.somaLatenciaHit / estado.hits,
    latenciaMediaMsSemCache: estado.misses === 0 ? 0 : estado.somaLatenciaMiss / estado.misses,
  };
}
