"""Servidor MCP do domínio "receitas" do Cookings.

Expõe, via protocolo MCP (transporte streamable-http), ferramentas que
uma IA pode usar para consultar receitas e ingredientes. Este servidor
não acessa banco de dados diretamente — ele é um tradutor MCP -> HTTP
que chama o `service_receitas` (pasta services/).
"""

import os
from typing import Optional

import httpx
from mcp.server.fastmcp import FastMCP

SERVICE_RECEITAS_URL = os.environ.get("SERVICE_RECEITAS_URL", "http://localhost:3003")
MCP_PORT = int(os.environ.get("MCP_PORT", "8003"))

mcp = FastMCP("cookings-receitas", host="0.0.0.0", port=MCP_PORT)


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


# ---------------------------------------------------------------------------
# Tools — Receitas
# ---------------------------------------------------------------------------

@mcp.tool()
async def listar_receitas(curso_id: Optional[str] = None, aula_id: Optional[str] = None) -> dict | list:
    """Lista receitas do Cookings, opcionalmente filtrando por curso e/ou aula.

    Args:
        curso_id: ID (UUID) do curso ao qual as receitas pertencem.
        aula_id: ID (UUID) da aula à qual as receitas pertencem.
    """
    params = {k: v for k, v in {"cursoId": curso_id, "aulaId": aula_id}.items() if v}
    return await _request("GET", "/receitas", params=params)


@mcp.tool()
async def obter_receita(receita_id: str) -> dict:
    """Retorna uma receita com o modo de preparo e a lista completa de
    ingredientes (com quantidade, unidade e eventuais observações de
    substituição ou alergênicos).

    Args:
        receita_id: ID (UUID) da receita.
    """
    return await _request("GET", f"/receitas/{receita_id}")


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


# ---------------------------------------------------------------------------
# Tools — Ingredientes
# ---------------------------------------------------------------------------

@mcp.tool()
async def listar_ingredientes() -> dict | list:
    """Lista o catálogo completo de ingredientes disponíveis no Cookings."""
    return await _request("GET", "/ingredientes")


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
