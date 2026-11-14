import { describe, expect, test } from "bun:test";
import { answerQuestion, AVISO_RESPOSTA_NAO_VERIFICADA } from "./answerQuestion";
import { MockAdapter } from "../../infrastructure/llm/MockAdapter";
import { MockJudgeAdapter } from "../../infrastructure/judge/MockJudgeAdapter";
import type { ToolsPort } from "../../domain/ports/ToolsPort";

function toolsSemTools(): ToolsPort {
  return {
    listTools: async () => [],
    callTool: async () => ({}),
  };
}

function deps() {
  return {
    llm: new MockAdapter(),
    tools: toolsSemTools(),
    judge: new MockJudgeAdapter(),
    judgeEnabled: true,
    maxRevisions: 1,
  };
}

describe("answerQuestion", () => {
  test("resposta normal aprova de primeira, sem aviso, cache sem-cache", async () => {
    const resultado = await answerQuestion(deps(), [{ role: "user", content: "quais cursos tem?" }]);

    expect(resultado.reply).not.toContain(AVISO_RESPOSTA_NAO_VERIFICADA);
    expect(resultado.judge.status).toBe("ok");
    expect(resultado.judge.veredito).toBe("aprovar");
    expect(resultado.cache.usado).toBe(false);
    expect(resultado.cache.motivo).toBe("sem-cache");
  });

  test("[[REVISAR]] regenera e aprova na segunda, reply sem aviso", async () => {
    const resultado = await answerQuestion(deps(), [
      { role: "user", content: "me explique [[REVISAR]]" },
    ]);

    expect(resultado.reply).not.toContain("[[REVISAR]]");
    expect(resultado.reply).not.toContain(AVISO_RESPOSTA_NAO_VERIFICADA);
    expect(resultado.judge.status).toBe("ok");
    expect(resultado.judge.veredito).toBe("aprovar");
    expect(resultado.cache.motivo).toBe("sem-cache");
  });

  test("[[REPROVAR]] até o limite: aviso no final e veredito reprovar", async () => {
    const resultado = await answerQuestion(deps(), [{ role: "user", content: "[[REPROVAR]]" }]);

    expect(resultado.reply.endsWith(AVISO_RESPOSTA_NAO_VERIFICADA)).toBe(true);
    expect(resultado.judge.veredito).toBe("reprovar");
    expect(resultado.judge.status).toBe("ok");
  });

  test("[[INDISPONIVEL]] entrega o texto, juiz unavailable, sem aviso de recusa", async () => {
    const resultado = await answerQuestion(deps(), [
      { role: "user", content: "oi [[INDISPONIVEL]]" },
    ]);

    expect(resultado.reply).toContain("[[INDISPONIVEL]]");
    expect(resultado.reply).not.toContain(AVISO_RESPOSTA_NAO_VERIFICADA);
    expect(resultado.judge.status).toBe("unavailable");
    expect(resultado.cache.motivo).toBe("juiz-indisponivel");
  });
});
