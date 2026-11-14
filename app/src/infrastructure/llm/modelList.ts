// Interpreta a lista de modelos vinda do .env (ex.: CLAUDE_MODEL, OPENAI_MODEL).
// Formato: nomes separados por vírgula, tentados em ordem — o primeiro é o
// preferido, os seguintes são reservas caso o anterior tenha sido
// aposentado/indisponível. Espaços e itens vazios são ignorados. Se a
// variável estiver ausente ou vazia, usa o modelo padrão do adapter.
export function parseModelList(raw: string | undefined, padrao: string): string[] {
  const lista = (raw ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  return lista.length > 0 ? lista : [padrao];
}
