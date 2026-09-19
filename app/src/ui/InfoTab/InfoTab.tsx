import { useEffect, useState } from "react";
import { CursosHttpAdapter, MatriculasHttpAdapter, ReceitasHttpAdapter } from "../../infrastructure/http/ServicesHttpAdapter";
import { listarCursos, listarAlunos, listarReceitas } from "../../application/info/infoQueries";
import type { Aluno, Curso, Receita } from "../../domain/entities";

const cursosPort = new CursosHttpAdapter();
const matriculasPort = new MatriculasHttpAdapter();
const receitasPort = new ReceitasHttpAdapter();

export default function InfoTab() {
  const [cursos, setCursos] = useState<Curso[]>([]);
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [receitas, setReceitas] = useState<Receita[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    async function carregar() {
      setCarregando(true);
      setErro(null);
      try {
        const [c, a, r] = await Promise.all([
          listarCursos(cursosPort),
          listarAlunos(matriculasPort),
          listarReceitas(receitasPort),
        ]);
        setCursos(c);
        setAlunos(a);
        setReceitas(r);
      } catch (e) {
        setErro(
          e instanceof Error
            ? `${e.message} — verifique se os services (portas 3001/3002/3003) estão no ar.`
            : "Erro desconhecido ao carregar dados."
        );
      } finally {
        setCarregando(false);
      }
    }
    carregar();
  }, []);

  if (carregando) return <p className="text-neutral-500">Carregando dados dos services...</p>;
  if (erro) return <p className="rounded-md bg-red-50 p-4 text-red-700">{erro}</p>;

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Secao titulo="Cursos" total={cursos.length}>
        {cursos.map((c) => (
          <div key={c.id} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
            <p className="font-medium">{c.titulo}</p>
            <p className="text-xs text-neutral-500">
              {c.categoria} · {c.nivel} · {c.instrutorNome}
            </p>
            <p className="mt-1 text-sm font-semibold text-orange-600">
              R$ {Number(c.preco).toFixed(2).replace(".", ",")}
            </p>
          </div>
        ))}
      </Secao>

      <Secao titulo="Alunos" total={alunos.length}>
        {alunos.map((a) => (
          <div key={a.id} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
            <p className="font-medium">{a.nome}</p>
            <p className="text-xs text-neutral-500">{a.email}</p>
          </div>
        ))}
      </Secao>

      <Secao titulo="Receitas" total={receitas.length}>
        {receitas.map((r) => (
          <div key={r.id} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
            <p className="font-medium">{r.nome}</p>
            <p className="text-xs text-neutral-500">
              {r.tempoPreparoMinutos} min · {r.porcoes} porções
            </p>
          </div>
        ))}
      </Secao>
    </div>
  );
}

function Secao({ titulo, total, children }: { titulo: string; total: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        {titulo} <span className="text-neutral-400">({total})</span>
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
