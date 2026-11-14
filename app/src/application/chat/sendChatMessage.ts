import type { LLMPort, ConversationTurn } from "../../domain/ports/LLMPort";
import type { ToolsPort } from "../../domain/ports/ToolsPort";
import type { ChatMessage } from "../../domain/entities";
import { SYSTEM_PROMPT, MAX_TOOL_ITERATIONS } from "./systemPrompt";

export interface SendChatMessageDeps {
  llm: LLMPort;
  tools: ToolsPort;
}

/**
 * Caso de uso: recebe o histórico da conversa (formato simples, só
 * role/content) e devolve a resposta final do assistente, executando
 * quantas chamadas de tool forem necessárias pelo caminho (loop de
 * tool-calling), contra os servidores MCP reais.
 */
export async function sendChatMessage(
  deps: SendChatMessageDeps,
  history: ChatMessage[]
): Promise<{ reply: string; toolCallsExecuted: string[] }> {
  const { llm, tools } = deps;

  const toolDefs = await tools.listTools();

  const turns: ConversationTurn[] = history.map((m) => ({ role: m.role, content: m.content }));

  const toolCallsExecuted: string[] = [];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resultado = await llm.converse({ systemPrompt: SYSTEM_PROMPT, turns, tools: toolDefs });

    if (resultado.type === "text") {
      return { reply: resultado.text, toolCallsExecuted };
    }

    // resultado.type === "tool_calls"
    turns.push({ role: "assistant_tool_calls", toolCalls: resultado.toolCalls });

    const results = await Promise.all(
      resultado.toolCalls.map(async (call) => {
        toolCallsExecuted.push(call.name);
        try {
          const result = await tools.callTool(call.name, call.arguments);
          return { toolCallId: call.id, name: call.name, result };
        } catch (err) {
          return {
            toolCallId: call.id,
            name: call.name,
            result: { erro: true, detalhe: err instanceof Error ? err.message : String(err) },
          };
        }
      })
    );

    turns.push({ role: "tool_results", results });
  }

  return {
    reply: "Não consegui concluir sua solicitação após várias tentativas de usar as ferramentas disponíveis.",
    toolCallsExecuted,
  };
}
