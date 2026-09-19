import { useState } from "react";
import type { ChatMessage } from "../../domain/entities";

export default function ChatTab() {
  const [mensagens, setMensagens] = useState<ChatMessage[]>([
    { role: "assistant", content: "Oi! Posso ajudar com cursos, matrículas e receitas do Cookings. O que você quer saber?" },
  ]);
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
        body: JSON.stringify({ messages: novasMensagens }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || `Erro HTTP ${resp.status}`);
      }

      setMensagens([...novasMensagens, { role: "assistant", content: data.reply }]);
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
              className={`max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === "user" ? "bg-orange-500 text-white" : "bg-neutral-100 text-neutral-800"
              }`}
            >
              {m.content}
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
