import type { JudgeInput, JudgePort, JudgeVerdict } from "../../domain/ports/JudgePort";
import { vereditoIndisponivel } from "../../domain/ports/JudgePort";

// Juiz determinístico para testes offline. Lê só o texto da resposta
// (marcadores combinados com o MockAdapter). Não chama API nenhuma.

export const FEEDBACK_REVISAO_MOCK =
  "Reescreva a resposta de forma clara, completa e sem marcadores de teste.";

export class MockJudgeAdapter implements JudgePort {
  async evaluate(input: JudgeInput): Promise<JudgeVerdict> {
    const resposta = input.resposta ?? "";

    if (resposta.includes("[[INDISPONIVEL]]")) {
      return vereditoIndisponivel();
    }

    if (!resposta.trim() || resposta.includes("[[REPROVAR]]")) {
      return {
        status: "ok",
        veredito: "reprovar",
        notas: { fidelidade: 1, coerencia: 1, seguranca: 1, relevancia: 1, clareza: 1 },
        problemas: [
          {
            criterio: "fidelidade",
            descricao: "Resposta vazia ou marcada para reprovação nos testes.",
            bloqueante: true,
          },
        ],
      };
    }

    if (resposta.includes("[[REVISAR]]")) {
      return {
        status: "ok",
        veredito: "revisar",
        notas: { fidelidade: 3, coerencia: 3, seguranca: 4, relevancia: 3, clareza: 2 },
        problemas: [
          {
            criterio: "clareza",
            descricao: "Resposta contém marcador de revisão e precisa ser reescrita.",
            bloqueante: false,
          },
        ],
        feedbackParaRegeneracao: FEEDBACK_REVISAO_MOCK,
      };
    }

    return {
      status: "ok",
      veredito: "aprovar",
      notas: { fidelidade: 5, coerencia: 5, seguranca: 5, relevancia: 5, clareza: 5 },
      problemas: [],
    };
  }
}
