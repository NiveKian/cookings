import { useState } from "react";
import InfoTab from "./InfoTab/InfoTab";
import ChatTab from "./ChatTab/ChatTab";

type Aba = "informacoes" | "chatbot";

export default function App() {
  const [aba, setAba] = useState<Aba>("informacoes");

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
        {aba === "informacoes" ? <InfoTab /> : <ChatTab />}
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
