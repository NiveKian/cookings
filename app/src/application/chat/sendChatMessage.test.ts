import { describe, expect, test } from "bun:test";
import { sendChatMessage } from "./sendChatMessage";
import { MockAdapter } from "../../infrastructure/llm/MockAdapter";
import type { ToolsPort } from "../../domain/ports/ToolsPort";
import type { ToolDefinition } from "../../domain/ports/LLMPort";

const TOOLS_FAKE: ToolDefinition[] = [
  { name: "listar_ingredientes", description: "Lista ingredientes", inputSchema: {} },
  { name: "verificar_alergenos", description: "Verifica alérgenos", inputSchema: {} },
  { name: "listar_cursos", description: "Lista cursos", inputSchema: {} },
];

function toolsPortFalso(): { tools: ToolsPort; chamadas: string[] } {
  const chamadas: string[] = [];
  const tools: ToolsPort = {
    listTools: async () => TOOLS_FAKE,
    callTool: async (name) => {
      chamadas.push(name);
      return { ok: true, tool: name };
    },
  };
  return { tools, chamadas };
}

describe("sendChatMessage", () => {
  test("CHAIN de duas tools executa as duas e devolve o formato de receita", async () => {
    const llm = new MockAdapter();
    const { tools, chamadas } = toolsPortFalso();
    const cadeia = [
      { name: "listar_ingredientes", arguments: {} },
      { name: "verificar_alergenos", arguments: { receita_id: "r1", alergenos: ["lactose"] } },
    ];

    const resultado = await sendChatMessage({ llm, tools }, [
      { role: "user", content: "invente uma sobremesa sem lactose com chocolate" },
      { role: "user", content: `CHAIN:${JSON.stringify(cadeia)}` },
    ]);

    expect(chamadas).toEqual(["listar_ingredientes", "verificar_alergenos"]);
    expect(resultado.toolCallsExecuted).toEqual(["listar_ingredientes", "verificar_alergenos"]);
    expect(resultado.reply).toContain("Nome:");
    expect(resultado.reply).toContain("Alérgenos:");
    expect(resultado.reply).toContain("Fora do catálogo:");
  });

  test("TOOL:listar_cursos:{} pede a tool e no turno seguinte devolve texto", async () => {
    const llm = new MockAdapter();
    const { tools, chamadas } = toolsPortFalso();

    const resultado = await sendChatMessage({ llm, tools }, [
      { role: "user", content: "TOOL:listar_cursos:{}" },
    ]);

    expect(chamadas).toEqual(["listar_cursos"]);
    expect(resultado.toolCallsExecuted).toEqual(["listar_cursos"]);
    expect(resultado.reply).toContain("[mock]");
    expect(resultado.reply).toContain('Resultado de "listar_cursos"');
    expect(resultado.reply).not.toContain("Nome:");
  });
});
