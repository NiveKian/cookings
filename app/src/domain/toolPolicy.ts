// Fonte única da verdade sobre as tools MCP: quais alteram dados e a qual
// domínio (servidor MCP) cada uma pertence. Os nomes vêm de mcp/*/server.py.
// Ao criar uma tool nova no MCP, registre-a aqui.
// Ainda não é usado pelo chat: a Fase 4 liga isto à confirmação de escrita.

export type ToolDomain = "cursos" | "matriculas" | "receitas";

// Tools que gravam dados (precisam de cuidado/confirmação).
export const MUTABLE_TOOLS: ReadonlySet<string> = new Set([
  "criar_curso",
  "criar_aula",
  "cadastrar_aluno",
  "matricular_aluno",
  "atualizar_progresso_matricula",
  "criar_receita",
  "adicionar_ingrediente_a_receita",
  "salvar_receita_gerada",
]);

// Tools de cada servidor MCP.
const TOOLS_POR_DOMINIO: Record<ToolDomain, readonly string[]> = {
  cursos: [
    "listar_cursos",
    "obter_curso",
    "listar_aulas_do_curso",
    "criar_curso",
    "criar_aula",
    "buscar_cursos_por_texto",
  ],
  matriculas: [
    "listar_alunos",
    "obter_aluno",
    "cadastrar_aluno",
    "listar_matriculas",
    "obter_matricula",
    "matricular_aluno",
    "atualizar_progresso_matricula",
    "resumo_progresso_aluno",
  ],
  receitas: [
    "listar_receitas",
    "obter_receita",
    "criar_receita",
    "listar_ingredientes",
    "adicionar_ingrediente_a_receita",
    "buscar_receitas_por_ingredientes",
    "verificar_alergenos",
    "ajustar_porcoes",
    "gerar_lista_de_compras",
    "salvar_receita_gerada",
    "sugerir_substituicoes",
  ],
};

const DOMINIO_POR_TOOL: ReadonlyMap<string, ToolDomain> = new Map(
  (Object.entries(TOOLS_POR_DOMINIO) as [ToolDomain, readonly string[]][]).flatMap(([dominio, nomes]) =>
    nomes.map((nome) => [nome, dominio] as [string, ToolDomain])
  )
);

// Domínio (servidor MCP) da tool, ou null se o nome for desconhecido.
export function toolDomain(name: string): ToolDomain | null {
  return DOMINIO_POR_TOOL.get(name) ?? null;
}

// true se a tool altera dados.
export function isMutableTool(name: string): boolean {
  return MUTABLE_TOOLS.has(name);
}
