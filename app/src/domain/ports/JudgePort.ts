// Porta do juiz (LLM as a judge). A aplicação só conhece esta interface;
// o provedor concreto (mock, Gemini, Claude, GPT) fica na infraestrutura.

export interface Evidencia {
  tool: string;
  argumentos: Record<string, unknown>;
  resultado: unknown;
}

export interface JudgeInput {
  pergunta: string;
  resposta: string;
  evidencias: Evidencia[];
}

export interface JudgeNotas {
  fidelidade: number;
  coerencia: number;
  seguranca: number;
  relevancia: number;
  clareza: number;
}

export interface JudgeProblema {
  criterio: string;
  descricao: string;
  bloqueante: boolean;
}

export interface JudgeVerdict {
  status: "ok" | "unavailable";
  veredito: "aprovar" | "revisar" | "reprovar";
  notas: JudgeNotas;
  problemas: JudgeProblema[];
  feedbackParaRegeneracao?: string;
}

export interface JudgePort {
  evaluate(input: JudgeInput): Promise<JudgeVerdict>;
}

export const NOTAS_MINIMAS: JudgeNotas = {
  fidelidade: 1,
  coerencia: 1,
  seguranca: 1,
  relevancia: 1,
  clareza: 1,
};

/** Fail-open na entrega, fail-closed no cache: não julgado. */
export function vereditoIndisponivel(): JudgeVerdict {
  return {
    status: "unavailable",
    veredito: "reprovar",
    notas: { ...NOTAS_MINIMAS },
    problemas: [],
  };
}
