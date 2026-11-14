"""Servidor MCP do domínio "receitas" do Cookings.

Expõe, via protocolo MCP (transporte streamable-http), ferramentas que
uma IA pode usar para consultar receitas e ingredientes. Este servidor
não acessa banco de dados diretamente — ele é um tradutor MCP -> HTTP
que chama o `service_receitas` (pasta services/).
"""

import os
from typing import NotRequired, Optional, TypedDict

import httpx
from mcp.server.fastmcp import FastMCP

SERVICE_RECEITAS_URL = os.environ.get("SERVICE_RECEITAS_URL", "http://localhost:3003")
MCP_PORT = int(os.environ.get("MCP_PORT", "8003"))

mcp = FastMCP("cookings-receitas", host="0.0.0.0", port=MCP_PORT)

# Tamanho de página usado ao varrer listagens (máximo aceito pelas APIs).
TAMANHO_PAGINA = 200

# Vocabulário fixo e minúsculo de alérgenos (igual ao do service_receitas).
ALERGENOS_VALIDOS = ("gluten", "lactose", "ovo", "soja", "amendoim", "castanhas", "peixe", "crustaceos")

MODOS_VALIDOS = ("todos", "qualquer")

# Mapa de acentos: o mesmo de services/service_receitas/src/texto.ts.
_ACENTOS_DE = "áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ"
_ACENTOS_PARA = "aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN"
_TABELA_ACENTOS = str.maketrans(_ACENTOS_DE, _ACENTOS_PARA)


class IngredienteGerado(TypedDict):
    """Ingrediente de uma receita gerada, identificado pelo NOME (não pelo ID)."""

    nome: str
    quantidade: float
    unidade: str
    observacao: NotRequired[str]


# ---------------------------------------------------------------------------
# Helpers HTTP (chamam o service_receitas e normalizam erros)
# ---------------------------------------------------------------------------

async def _request(method: str, path: str, **kwargs) -> dict | list:
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.request(method, f"{SERVICE_RECEITAS_URL}{path}", **kwargs)
            resp.raise_for_status()
            if resp.status_code == 204:
                return {"ok": True}
            return resp.json()
        except httpx.HTTPStatusError as exc:
            try:
                detalhe = exc.response.json()
            except Exception:
                detalhe = exc.response.text
            return {"erro": True, "status": exc.response.status_code, "detalhe": detalhe}
        except httpx.HTTPError as exc:
            return {"erro": True, "status": None, "detalhe": f"Falha ao conectar ao service_receitas: {exc}"}


def _erro(status: int | None, detalhe) -> dict:
    """Monta o erro padrão das tools: { erro, status, detalhe }."""
    return {"erro": True, "status": status, "detalhe": detalhe}


def _e_erro(resultado) -> bool:
    """True se o resultado de `_request` (ou de um helper) é um erro padronizado."""
    return isinstance(resultado, dict) and resultado.get("erro") is True


def sem_acento(texto: str) -> str:
    """Remove acentos e converte para minúsculo (mesmo mapa do service_receitas)."""
    return texto.translate(_TABELA_ACENTOS).lower()


async def _paginar(path: str, params: dict | list | None = None) -> dict | list:
    """Varre uma listagem com limit=200 e offset crescente, até a página vir
    menor que 200. Propaga na hora o erro `{erro: true}` de qualquer página.

    `params` pode ser dict ou lista de tuplas (necessário para parâmetro repetido).
    """
    if isinstance(params, dict):
        base = list(params.items())
    else:
        base = list(params or [])

    itens: list = []
    offset = 0
    while True:
        pagina = await _request(
            "GET", path, params=base + [("limit", TAMANHO_PAGINA), ("offset", offset)]
        )
        if _e_erro(pagina):
            return pagina
        if not isinstance(pagina, list):
            return _erro(None, f"Resposta inesperada de {path}: esperava uma lista.")
        itens.extend(pagina)
        if len(pagina) < TAMANHO_PAGINA:
            return itens
        offset += TAMANHO_PAGINA


def _escalar_ingredientes(receita: dict, porcoes: int) -> list[dict]:
    """Escala as quantidades da receita de `receita.porcoes` para `porcoes`.

    `quantidade` chega como string (NUMERIC); converte para float e arredonda a 2 casas.
    """
    fator = porcoes / receita["porcoes"]
    escalados = []
    for ing in receita.get("ingredientes", []):
        item = {
            "ingredienteId": ing["ingredienteId"],
            "nome": ing["nome"],
            "quantidade": round(float(ing["quantidade"]) * fator, 2),
            "unidade": ing["unidade"],
        }
        if ing.get("observacao"):
            item["observacao"] = ing["observacao"]
        escalados.append(item)
    return escalados


def _validar_porcoes(receita: dict, porcoes: int) -> dict | None:
    """Devolve erro 400 se as porções pedidas ou as originais forem menores que 1."""
    if not isinstance(porcoes, int) or porcoes < 1:
        return _erro(400, "porcoes deve ser um inteiro maior ou igual a 1.")
    original = receita.get("porcoes")
    if not isinstance(original, int) or original < 1:
        return _erro(400, f"A receita tem porções originais inválidas ({original!r}); não é possível escalar.")
    return None


# ---------------------------------------------------------------------------
# Tools — Receitas
# ---------------------------------------------------------------------------

@mcp.tool()
async def listar_receitas(curso_id: Optional[str] = None, aula_id: Optional[str] = None) -> dict | list:
    """Lista TODAS as receitas do Cookings (percorre todas as páginas),
    opcionalmente filtrando por curso e/ou aula. Cada receita traz `origem`
    ("curso" ou "ia").

    Args:
        curso_id: ID (UUID) do curso ao qual as receitas pertencem.
        aula_id: ID (UUID) da aula à qual as receitas pertencem.
    """
    params = {k: v for k, v in {"cursoId": curso_id, "aulaId": aula_id}.items() if v}
    return await _paginar("/receitas", params)


@mcp.tool()
async def obter_receita(receita_id: str) -> dict:
    """Retorna uma receita com o modo de preparo e a lista completa de
    ingredientes (com quantidade, unidade, alérgenos e eventuais observações
    de substituição).

    Args:
        receita_id: ID (UUID) da receita.
    """
    return await _request("GET", f"/receitas/{receita_id}")


@mcp.tool()
async def buscar_receitas_por_ingredientes(ingredientes: list[str], modo: str = "qualquer") -> dict | list:
    """Busca receitas pelos NOMES dos ingredientes (sem diferenciar acento ou
    maiúsculas). Use quando o usuário disser o que tem em casa.

    Args:
        ingredientes: nomes dos ingredientes, ex: ["ovos", "farinha de trigo"].
        modo: "qualquer" (padrão) devolve receitas com ao menos um dos
            ingredientes; "todos" devolve só receitas que usam todos eles.
    """
    modo_normalizado = (modo or "qualquer").strip().lower()
    if modo_normalizado not in MODOS_VALIDOS:
        return _erro(400, f"modo inválido: {modo!r}. Use 'todos' ou 'qualquer'.")
    nomes = [n.strip() for n in ingredientes if isinstance(n, str) and n.strip()]
    if not nomes:
        return _erro(400, "Informe ao menos um nome de ingrediente.")

    params = [("ingrediente", n) for n in nomes] + [("modo", modo_normalizado)]
    return await _paginar("/receitas", params)


@mcp.tool()
async def verificar_alergenos(receita_id: str, alergenos: list[str]) -> dict:
    """Verifica se uma receita é compatível com uma lista de alérgenos a evitar.
    Cruza os alérgenos informados com os de cada ingrediente da receita.

    Alérgenos válidos: gluten, lactose, ovo, soja, amendoim, castanhas, peixe, crustaceos.

    Retorna `{ receitaId, compativel, conflitos }`. `compativel` é true quando
    nenhum ingrediente contém os alérgenos pedidos. Cada item de `conflitos`
    traz `ingredienteId`, `nome` e `alergenos` (só os que conflitam com o pedido).

    Args:
        receita_id: ID (UUID) da receita.
        alergenos: alérgenos que a pessoa precisa evitar, ex: ["lactose", "gluten"].
    """
    pedidos = {a.strip().lower() for a in alergenos if isinstance(a, str) and a.strip()}
    invalidos = sorted(pedidos - set(ALERGENOS_VALIDOS))
    if invalidos:
        return _erro(
            400,
            f"Alérgenos fora do vocabulário: {invalidos}. Válidos: {list(ALERGENOS_VALIDOS)}.",
        )

    receita = await _request("GET", f"/receitas/{receita_id}")
    if _e_erro(receita):
        return receita

    conflitos = []
    for ing in receita.get("ingredientes", []):
        em_comum = sorted(pedidos & set(ing.get("alergenos") or []))
        if em_comum:
            conflitos.append(
                {"ingredienteId": ing["ingredienteId"], "nome": ing["nome"], "alergenos": em_comum}
            )
    return {"receitaId": receita_id, "compativel": not conflitos, "conflitos": conflitos}


@mcp.tool()
async def ajustar_porcoes(receita_id: str, porcoes: int) -> dict:
    """Calcula as quantidades de uma receita para outro número de porções.
    NÃO grava nada: é só um cálculo proporcional sobre os dados atuais.

    Retorna o nome da receita, as porções pedidas, as porções originais e os
    ingredientes com a quantidade (número) já escalada.

    Args:
        receita_id: ID (UUID) da receita.
        porcoes: número de porções desejado (inteiro, mínimo 1).
    """
    receita = await _request("GET", f"/receitas/{receita_id}")
    if _e_erro(receita):
        return receita
    erro = _validar_porcoes(receita, porcoes)
    if erro:
        return erro

    return {
        "receitaId": receita_id,
        "nome": receita["nome"],
        "porcoesPedidas": porcoes,
        "porcoesOriginais": receita["porcoes"],
        "ingredientes": _escalar_ingredientes(receita, porcoes),
    }


@mcp.tool()
async def gerar_lista_de_compras(receita_ids: list[str], porcoes: Optional[int] = None) -> dict:
    """Gera uma lista de compras somando os ingredientes de várias receitas.
    Ingredientes iguais (mesmo ID) na mesma unidade têm as quantidades somadas.

    Retorna `{ itens: [{ ingredienteId, nome, unidade, quantidade }] }`.

    Args:
        receita_ids: IDs (UUID) das receitas que serão preparadas.
        porcoes: se informado, cada receita é escalada para este número de
            porções (a partir das porções originais dela). Se omitido, usa as
            quantidades originais.
    """
    if not receita_ids:
        return _erro(400, "Informe ao menos um ID de receita.")

    agregado: dict[tuple[str, str], dict] = {}
    for receita_id in receita_ids:
        receita = await _request("GET", f"/receitas/{receita_id}")
        if _e_erro(receita):
            return receita

        if porcoes is not None:
            erro = _validar_porcoes(receita, porcoes)
            if erro:
                return erro
            ingredientes = _escalar_ingredientes(receita, porcoes)
        else:
            ingredientes = [
                {
                    "ingredienteId": ing["ingredienteId"],
                    "nome": ing["nome"],
                    "quantidade": float(ing["quantidade"]),
                    "unidade": ing["unidade"],
                }
                for ing in receita.get("ingredientes", [])
            ]

        for ing in ingredientes:
            chave = (ing["ingredienteId"], ing["unidade"])
            if chave not in agregado:
                agregado[chave] = {
                    "ingredienteId": ing["ingredienteId"],
                    "nome": ing["nome"],
                    "unidade": ing["unidade"],
                    "quantidade": 0.0,
                }
            agregado[chave]["quantidade"] += ing["quantidade"]

    itens = sorted(agregado.values(), key=lambda i: (sem_acento(i["nome"]), i["unidade"]))
    for item in itens:
        item["quantidade"] = round(item["quantidade"], 2)
    return {"itens": itens}


@mcp.tool()
async def criar_receita(
    curso_id: str,
    nome: str,
    modo_preparo: str,
    tempo_preparo_minutos: int,
    porcoes: int = 1,
    aula_id: Optional[str] = None,
) -> dict:
    """Cria uma nova receita vinculada a um curso (e, opcionalmente, a uma aula).

    Args:
        curso_id: ID (UUID) do curso ao qual a receita pertence.
        nome: nome da receita.
        modo_preparo: descrição do passo a passo de preparo.
        tempo_preparo_minutos: tempo total de preparo, em minutos.
        porcoes: número de porções que a receita rende.
        aula_id: ID (UUID) da aula específica, se aplicável.
    """
    payload = {
        "cursoId": curso_id,
        "nome": nome,
        "modoPreparo": modo_preparo,
        "tempoPreparoMinutos": tempo_preparo_minutos,
        "porcoes": porcoes,
    }
    if aula_id:
        payload["aulaId"] = aula_id
    return await _request("POST", "/receitas", json=payload)


@mcp.tool()
async def salvar_receita_gerada(
    nome: str,
    modo_preparo: str,
    tempo_preparo_minutos: int,
    porcoes: int,
    ingredientes: list[IngredienteGerado],
    curso_id: Optional[str] = None,
    criar_ingredientes_ausentes: bool = False,
) -> dict:
    """Salva no Cookings uma receita criada pela IA (origem "ia"). ALTERA DADOS:
    só chame depois de o usuário aceitar salvar.

    Os ingredientes são identificados pelo NOME (sem diferenciar acento ou
    maiúsculas) contra o catálogo. Nomes que não existem no catálogo NÃO são
    vinculados e voltam em `ingredientesNaoEncontrados`, a menos que
    `criar_ingredientes_ausentes` seja true (aí são criados no catálogo, sem
    alérgenos cadastrados — avise o usuário disso).

    Retorna `{ receita, ingredientesVinculados, ingredientesNaoEncontrados }`.
    Se qualquer etapa falhar, retorna `{ erro: true, status, detalhe }`.

    Args:
        nome: nome da receita.
        modo_preparo: passo a passo de preparo.
        tempo_preparo_minutos: tempo total de preparo, em minutos (inteiro >= 1).
        porcoes: número de porções que a receita rende (inteiro >= 1).
        ingredientes: lista de objetos {nome, quantidade, unidade, observacao?}.
            Ex: [{"nome": "Ovos", "quantidade": 2, "unidade": "unidade"}].
        curso_id: ID (UUID) de um curso relacionado, se houver (opcional).
        criar_ingredientes_ausentes: se true, cria no catálogo os ingredientes
            que não forem encontrados pelo nome.
    """
    # Validação local antes de qualquer escrita, para não deixar a receita pela metade.
    if not ingredientes:
        return _erro(400, "Informe ao menos um ingrediente.")
    for i, ing in enumerate(ingredientes):
        nome_ing = str(ing.get("nome", "")).strip()
        unidade_ing = str(ing.get("unidade", "")).strip()
        try:
            qtd = float(ing.get("quantidade"))
        except (TypeError, ValueError):
            qtd = 0.0
        if not nome_ing or not unidade_ing or qtd <= 0:
            return _erro(
                400,
                f"Ingrediente #{i + 1} inválido: nome, unidade e quantidade (> 0) são obrigatórios.",
            )

    # 1. Catálogo completo, indexado pelo nome normalizado.
    catalogo = await _paginar("/ingredientes")
    if _e_erro(catalogo):
        return catalogo
    por_nome = {sem_acento(c["nome"].strip()): c for c in catalogo}

    # 2. Resolve cada ingrediente (e cria os ausentes, se pedido).
    resolvidos: list[tuple[IngredienteGerado, dict, bool]] = []
    nao_encontrados: list[str] = []
    for ing in ingredientes:
        nome_ing = str(ing["nome"]).strip()
        chave = sem_acento(nome_ing)
        criado = False
        encontrado = por_nome.get(chave)
        if encontrado is None:
            if not criar_ingredientes_ausentes:
                if nome_ing not in nao_encontrados:
                    nao_encontrados.append(nome_ing)
                continue
            novo = await _request(
                "POST",
                "/ingredientes",
                json={"nome": nome_ing, "unidadePadrao": str(ing["unidade"]).strip(), "alergenos": []},
            )
            if _e_erro(novo):
                return novo
            por_nome[chave] = encontrado = novo
            criado = True
        resolvidos.append((ing, encontrado, criado))

    if not resolvidos:
        return _erro(
            400,
            {
                "mensagem": "Nenhum ingrediente foi encontrado no catálogo. A receita não foi salva.",
                "ingredientesNaoEncontrados": nao_encontrados,
            },
        )

    # 3. Cria a receita (origem "ia"; cursoId só se veio).
    payload = {
        "nome": nome,
        "modoPreparo": modo_preparo,
        "tempoPreparoMinutos": tempo_preparo_minutos,
        "porcoes": porcoes,
        "origem": "ia",
    }
    if curso_id:
        payload["cursoId"] = curso_id
    receita = await _request("POST", "/receitas", json=payload)
    if _e_erro(receita):
        return receita

    # 4. Vincula só os ingredientes resolvidos.
    vinculados = []
    for ing, catalogado, criado in resolvidos:
        vinculo_payload = {
            "ingredienteId": catalogado["id"],
            "quantidade": float(ing["quantidade"]),
            "unidade": str(ing["unidade"]).strip(),
        }
        if ing.get("observacao"):
            vinculo_payload["observacao"] = ing["observacao"]
        vinculo = await _request("POST", f"/receitas/{receita['id']}/ingredientes", json=vinculo_payload)
        if _e_erro(vinculo):
            # A receita já existe; informa o estado parcial em vez de fingir sucesso.
            vinculo["receitaCriadaId"] = receita["id"]
            vinculo["ingredientesVinculadosAteAqui"] = [v["nome"] for v in vinculados]
            return vinculo
        vinculados.append(
            {
                "ingredienteId": catalogado["id"],
                "nome": catalogado["nome"],
                "quantidade": vinculo.get("quantidade"),
                "unidade": vinculo.get("unidade"),
                "observacao": vinculo.get("observacao"),
                "criadoNoCatalogo": criado,
            }
        )

    return {
        "receita": receita,
        "ingredientesVinculados": vinculados,
        "ingredientesNaoEncontrados": nao_encontrados,
    }


# ---------------------------------------------------------------------------
# Tools — Ingredientes
# ---------------------------------------------------------------------------

@mcp.tool()
async def listar_ingredientes() -> dict | list:
    """Lista o catálogo completo de ingredientes do Cookings (percorre todas as
    páginas). Cada ingrediente traz `alergenos` (gluten, lactose, ovo, soja,
    amendoim, castanhas, peixe, crustaceos)."""
    return await _paginar("/ingredientes")


@mcp.tool()
async def sugerir_substituicoes(ingrediente_id: str) -> dict | list:
    """Lista substituições conhecidas para um ingrediente do catálogo
    (ex: manteiga -> margarina sem lactose). Retorna lista vazia se não houver.

    Args:
        ingrediente_id: ID (UUID) do ingrediente (veja `listar_ingredientes`).
    """
    return await _request("GET", f"/ingredientes/{ingrediente_id}/substituicoes")


@mcp.tool()
async def adicionar_ingrediente_a_receita(
    receita_id: str,
    ingrediente_id: str,
    quantidade: float,
    unidade: str,
    observacao: Optional[str] = None,
) -> dict:
    """Vincula um ingrediente do catálogo a uma receita, com quantidade e unidade.

    Args:
        receita_id: ID (UUID) da receita.
        ingrediente_id: ID (UUID) do ingrediente já existente no catálogo
            (use `listar_ingredientes` para descobrir os IDs disponíveis).
        quantidade: quantidade do ingrediente na receita.
        unidade: unidade de medida (ex: "g", "ml", "unidade").
        observacao: nota opcional, ex: sugestão de substituição ou alerta de alergênico.
    """
    payload = {"ingredienteId": ingrediente_id, "quantidade": quantidade, "unidade": unidade}
    if observacao:
        payload["observacao"] = observacao
    return await _request("POST", f"/receitas/{receita_id}/ingredientes", json=payload)


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
