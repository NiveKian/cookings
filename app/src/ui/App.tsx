import { useEffect, useState } from "react";
import InfoTab from "./InfoTab/InfoTab";
import ChatTab from "./ChatTab/ChatTab";
import type { ChatMessage } from "../domain/entities";
import { initChatPersistence, loadChatHistory, saveChatHistory } from "../infrastructure/storage/ChatHistoryStorage";
type Aba = "informacoes" | "chatbot";

// Mensagem inicial do chat — extraída pra constante pra não recriar um
// novo array/objeto toda renderização (e pra ficar num único lugar).
const MENSAGEM_INICIAL: ChatMessage = {
  role: "assistant",
  content: "Oi! Posso ajudar com cursos, matrículas e receitas do Cookings. O que você quer saber?",
};

export default function App() {
  const [aba, setAba] = useState<Aba>("informacoes");

  // Vive aqui (no App, que nunca desmonta) em vez de dentro do ChatTab,
  // para sobreviver à troca de abas — ver comentário em ChatTab.tsx.
  // O localStorage (abaixo) só influencia o valor INICIAL e é sincronizado
  // depois; a troca de aba nunca depende dele, então mesmo se a
  // persistência estiver desativada o histórico não quebra ao trocar de aba.
  const [mensagens, setMensagens] = useState<ChatMessage[]>([MENSAGEM_INICIAL]);
  const [persistenciaHabilitada, setPersistenciaHabilitada] = useState(false);

  // Roda só uma vez, ao montar o App (nunca de novo, já que o App nunca
  // desmonta): pergunta permissão (ou reaproveita a resposta salva) e,
  // se permitido, carrega o histórico salvo por cima da mensagem inicial.
  useEffect(() => {
    const habilitado = initChatPersistence();
    setPersistenciaHabilitada(habilitado);

    if (habilitado) {
      const salvas = loadChatHistory();
      if (salvas && salvas.length > 0) {
        setMensagens(salvas);
      }
    }
  }, []);

  // Sincroniza para o localStorage sempre que "mensagens" mudar — com um
  // pequeno debounce (300ms) pra não gravar em rajada se vários updates de
  // estado acontecerem em sequência rápida. Só roda de fato se a
  // persistência foi habilitada.
  useEffect(() => {
    if (!persistenciaHabilitada) return;

    const timeout = setTimeout(() => {
      saveChatHistory(mensagens);
    }, 300);

    return () => clearTimeout(timeout);
  }, [mensagens, persistenciaHabilitada]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <h1 className="text-xl font-semibold">🍳 Cookings</h1>
          <p className="text-sm text-neutral-500">Cursos de culinária online</p>
        </div>
      </header>

      <nav className="mx-auto max-w-5xl px-4 pt-4">
        <div className="flex gap-2 border-b border-neutral-200">
          <TabButton label="Informações" active={aba === "informacoes"} onClick={() => setAba("informacoes")} />
          <TabButton label="Chatbot" active={aba === "chatbot"} onClick={() => setAba("chatbot")} />
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {aba === "informacoes" ? (
          <InfoTab />
        ) : (
          <ChatTab mensagens={mensagens} setMensagens={setMensagens} />
        )}
      </main>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-orange-500 text-orange-600"
          : "border-transparent text-neutral-500 hover:text-neutral-800"
      }`}
    >
      {label}
    </button>
  );
}