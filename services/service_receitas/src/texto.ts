// Funções puras de texto usadas nos filtros do service_receitas.
// Sem acesso a banco: ficam isoladas para serem testadas com `bun test`.

// Mapa de acentos. O mesmo mapa existe em mcp/mcp_receitas/server.py,
// mcp/mcp_cursos/server.py e é usado no SQL via translate(). Não edite um sem o outro.
export const ACENTOS_DE = "áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ";
export const ACENTOS_PARA = "aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN";

const MAPA = new Map<string, string>(
  Array.from(ACENTOS_DE).map((letra, i) => [letra, ACENTOS_PARA[i]] as [string, string])
);

// Remove acentos (á→a, ç→c, ñ→n...) e converte para minúsculo.
export function semAcento(texto: string): string {
  let saida = "";
  for (const letra of texto) saida += MAPA.get(letra) ?? letra;
  return saida.toLowerCase();
}

// Monta a lista de nomes do filtro `ingrediente`. Aceita um texto, vários
// textos (parâmetro repetido) e vírgulas dentro de cada texto. Cada nome é
// aparado, normalizado (sem acento/caixa) e duplicados/vazios são descartados.
export function montarListaDeNomes(valor: string | string[] | undefined): string[] {
  if (valor === undefined) return [];
  const bruto = Array.isArray(valor) ? valor : [valor];
  const nomes = new Set<string>();
  for (const item of bruto) {
    for (const parte of item.split(",")) {
      const nome = semAcento(parte.trim());
      if (nome) nomes.add(nome);
    }
  }
  return Array.from(nomes);
}
