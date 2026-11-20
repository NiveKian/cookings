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

/** Selo de origem e juiz em texto puro (sem markdown). */
function MetadadosAssistente({ mensagem }: { mensagem: ChatMessage }) {
  const selo = mensagem.cache ? seloOrigem(mensagem.cache) : null;
  // Em acerto de cache o juiz não rodou: a caixa some.
  const judge = mensagem.cache?.usado === true ? undefined : mensagem.judge;
  const estado = judge ? estadoJuiz(judge) : null;

  if (!selo && !judge) return null;

  return (
    <div className="mt-2 space-y-1 text-[11px] text-neutral-500">
      {selo ? (
        <p>
          <span
            title={selo.detalhe}
            className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${
              selo.deCache ? "bg-neutral-100 text-neutral-500" : "bg-sky-50 text-sky-700"
            }`}
          >
            {selo.texto}
          </span>
        </p>
      ) : null}
      {judge && estado ? (
        <details>
          <summary className="cursor-pointer">
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${estado.cor}`}>
              {estado.texto}
            </span>
          </summary>
          {judge.status === "unavailable" ? (
            <p className="mt-1">O juiz não rodou; a resposta não foi avaliada.</p>
          ) : (
            <div className="mt-1 space-y-1">
              <ul className="list-disc pl-4">
                {linhasNotas(judge).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p>Notas de 1 a 5. Aprova com todas &gt;= 4 e sem problema bloqueante.</p>
              {judge.problemas && judge.problemas.length > 0 ? (
                <ul className="list-disc pl-4">
                  {judge.problemas.map((p, i) => (
                    <li key={i}>
                      {p.criterio}: {p.descricao}
                      {p.bloqueante ? " (bloqueante)" : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </details>
      ) : null}
    </div>
  );
}

const MOTIVOS_SEM_HIT: Record<string, string> = {
  miss: "gravada no cache",
  "juiz-indisponivel": "não gravada no cache: juiz indisponível",
  reprovado: "não gravada no cache: juiz não aprovou",
  "nao-standalone": "não gravada no cache: só a 1ª pergunta da conversa usa o cache",
  novidade: "não gravada no cache: pedido de algo novo",
  mutavel: "não gravada no cache: ação que altera dados",
  "sem-cache": "cache desligado",
};

/** Origem da resposta (cache semântico ou IA) em texto puro. */
export function seloOrigem(cache: ChatCacheMeta): {
  texto: string;
  detalhe: string;
  deCache: boolean;
} {
  if (cache.usado) {
    const sim =
      typeof cache.similaridade === "number" && Number.isFinite(cache.similaridade)
        ? `similaridade ${cache.similaridade.toFixed(2)} · `
        : "";
    return {
      texto: "Resposta do Cache",
      detalhe: `${sim}sem chamada à IA nem ao juiz`,
      deCache: true,
    };
  }
  const motivo = MOTIVOS_SEM_HIT[cache.motivo] ?? cache.motivo;
  return { texto: "Gerado por AI", detalhe: motivo, deCache: false };
}

/** Texto e cor (classes Tailwind) do resumo do juiz, conforme o estado. */
export function estadoJuiz(judge: ChatJudgeMeta): { texto: string; cor: string } {
  if (judge.status === "unavailable") {
    return { texto: "juiz: indisponível", cor: "bg-neutral-100 text-neutral-500" };
  }
  switch (judge.veredito) {
    case "aprovar":
      return { texto: "juiz: aprovada", cor: "bg-emerald-50 text-emerald-700" };
    case "revisar":
      return { texto: "juiz: revisar", cor: "bg-amber-50 text-amber-700" };
    default:
      return { texto: "juiz: reprovada", cor: "bg-red-50 text-red-700" };
  }
}

/** Uma linha por critério: nota e o que o critério mede. */
export function linhasNotas(judge: ChatJudgeMeta): string[] {
  const n = judge.notas;
  return [
    `fidelidade ${n.fidelidade}/5 — bate com o que as ferramentas devolveram`,
    `coerência ${n.coerencia}/5 — receita ou orientação viável`,
    `segurança ${n.seguranca}/5 — segurança alimentar e alérgenos`,
    `relevância ${n.relevancia}/5 — responde à pergunta`,
    `clareza ${n.clareza}/5 — texto claro, sem enrolação`,
  ];
}
