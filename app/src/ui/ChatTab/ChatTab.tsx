import { useState } from "react";
import type { ChatCacheMeta, ChatJudgeMeta, ChatMessage } from "../../domain/entities";

interface ChatTabProps {
  // "mensagens" e "setMensagens" vêm do App.tsx (lifted state) — assim o
  // histórico sobrevive quando o usuário troca para a aba "Informações"
  // e volta, já que o App nunca desmonta, só o que está dentro dele.
  mensagens: ChatMessage[];
  setMensagens: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

type ChatApiOk = {
  reply: string;
  toolCallsExecuted?: string[];
  evidencias?: unknown;
  judge?: ChatJudgeMeta;
  cache?: ChatCacheMeta;
};

export default function ChatTab({ mensagens, setMensagens }: ChatTabProps) {
  // Estes 3 continuam locais: são só estado de UI momentâneo (o que está
  // digitado agora, se está carregando agora) — tanto faz se resetam ao
  // trocar de aba, então não precisam subir pro App.
  const [entrada, setEntrada] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    const texto = entrada.trim();
    if (!texto || enviando) return;

    const novasMensagens: ChatMessage[] = [...mensagens, { role: "user", content: texto }];
    setMensagens(novasMensagens);
    setEntrada("");
    setEnviando(true);
    setErro(null);

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Backend só usa role/content; metadados da UI não vão na LLM.
          messages: novasMensagens.map(({ role, content }) => ({ role, content })),
        }),
      });

      const data = (await resp.json()) as ChatApiOk & { error?: string };

      if (!resp.ok) {
        throw new Error(data.error || `Erro HTTP ${resp.status}`);
      }

      const assistente: ChatMessage = {
        role: "assistant",
        content: data.reply,
        cache: data.cache,
        judge: data.judge,
      };
      setMensagens([...novasMensagens, assistente]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro desconhecido ao conversar com o assistente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex h-[60vh] flex-col rounded-lg border border-neutral-200 bg-white">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {mensagens.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                m.role === "user" ? "bg-orange-500 text-white" : "bg-neutral-100 text-neutral-800"
              }`}
            >
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.role === "assistant" ? <MetadadosAssistente mensagem={m} /> : null}
            </div>
          </div>
        ))}
        {enviando && <p className="text-xs text-neutral-400">Pensando...</p>}
        {erro && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{erro}</p>}
      </div>

      <div className="flex gap-2 border-t border-neutral-200 p-3">
        <input
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enviar()}
          placeholder="Pergunte sobre cursos, matrículas ou receitas..."
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
        <button
          onClick={enviar}
          disabled={enviando || !entrada.trim()}
          className="rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}

/** Selo de cache e juiz em texto puro (sem markdown). */
function MetadadosAssistente({ mensagem }: { mensagem: ChatMessage }) {
  const selo = mensagem.cache?.usado ? seloCache(mensagem.cache) : null;
  const judge = mensagem.judge;

  if (!selo && !judge) return null;

  return (
    <div className="mt-2 space-y-1 text-[11px] text-neutral-500">
      {selo ? <p>{selo}</p> : null}
      {judge ? (
        <details>
          <summary className="cursor-pointer">juiz: {judge.veredito}</summary>
          <p className="mt-1">{textoNotas(judge)}</p>
        </details>
      ) : null}
    </div>
  );
}

function seloCache(cache: ChatCacheMeta): string {
  if (typeof cache.similaridade === "number" && Number.isFinite(cache.similaridade)) {
    return `resposta do cache (similaridade ${cache.similaridade.toFixed(2)})`;
  }
  return "resposta do cache";
}

function textoNotas(judge: ChatJudgeMeta): string {
  const n = judge.notas;
  if (!n) return "";
  return (
    `fidelidade ${n.fidelidade}, coerência ${n.coerencia}, ` +
    `segurança ${n.seguranca}, relevância ${n.relevancia}, clareza ${n.clareza}`
  );
}
