"""Servidor MCP do domínio "cursos" do Cookings.

Expõe, via protocolo MCP (transporte streamable-http), ferramentas que
uma IA pode usar para consultar e gerenciar cursos e aulas. Este servidor
não acessa banco de dados diretamente — ele é um tradutor MCP -> HTTP que
chama o `service_cursos` (pasta services/).
"""

import os
from typing import Optional

import httpx
from mcp.server.fastmcp import FastMCP

SERVICE_CURSOS_URL = os.environ.get("SERVICE_CURSOS_URL", "http://localhost:3001")
MCP_PORT = int(os.environ.get("MCP_PORT", "8001"))

mcp = FastMCP("cookings-cursos", host="0.0.0.0", port=MCP_PORT)


# ---------------------------------------------------------------------------
# Helpers HTTP (chamam o service_cursos e normalizam erros)
# ---------------------------------------------------------------------------

async def _request(method: str, path: str, **kwargs) -> dict | list:
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.request(method, f"{SERVICE_CURSOS_URL}{path}", **kwargs)
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
            return {"erro": True, "status": None, "detalhe": f"Falha ao conectar ao service_cursos: {exc}"}


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@mcp.tool()
async def listar_cursos(categoria: Optional[str] = None, nivel: Optional[str] = None) -> dict | list:
    """Lista os cursos de culinária do Cookings.

    Args:
        categoria: filtra por categoria (ex: "Massas", "Confeitaria", "Carnes").
        nivel: filtra por nível: "iniciante", "intermediario" ou "avancado".
    """
    params = {k: v for k, v in {"categoria": categoria, "nivel": nivel}.items() if v}
    return await _request("GET", "/cursos", params=params)


@mcp.tool()
async def obter_curso(curso_id: str) -> dict:
    """Retorna os detalhes de um curso específico pelo seu ID (UUID)."""
    return await _request("GET", f"/cursos/{curso_id}")


@mcp.tool()
async def listar_aulas_do_curso(curso_id: str) -> dict | list:
    """Lista as aulas de um curso, em ordem, pelo ID (UUID) do curso."""
    return await _request("GET", f"/cursos/{curso_id}/aulas")


@mcp.tool()
async def criar_curso(
    titulo: str,
    categoria: str,
    nivel: str,
    instrutor_nome: str,
    carga_horaria_horas: int,
    preco: float,
    descricao: Optional[str] = None,
) -> dict:
    """Cria um novo curso de culinária no Cookings.

    Args:
        titulo: título do curso.
        categoria: categoria do curso (ex: "Massas", "Confeitaria").
        nivel: "iniciante", "intermediario" ou "avancado".
        instrutor_nome: nome do instrutor responsável.
        carga_horaria_horas: carga horária total, em horas.
        preco: preço do curso.
        descricao: descrição opcional do curso.
    """
    payload = {
        "titulo": titulo,
        "categoria": categoria,
        "nivel": nivel,
        "instrutorNome": instrutor_nome,
        "cargaHorariaHoras": carga_horaria_horas,
        "preco": preco,
    }
    if descricao:
        payload["descricao"] = descricao
    return await _request("POST", "/cursos", json=payload)


@mcp.tool()
async def criar_aula(curso_id: str, titulo: str, ordem: int, duracao_minutos: int) -> dict:
    """Cria uma nova aula dentro de um curso existente.

    Args:
        curso_id: ID (UUID) do curso ao qual a aula pertence.
        titulo: título da aula.
        ordem: posição da aula dentro do curso (1, 2, 3...).
        duracao_minutos: duração da aula em minutos.
    """
    payload = {"titulo": titulo, "ordem": ordem, "duracaoMinutos": duracao_minutos}
    return await _request("POST", f"/cursos/{curso_id}/aulas", json=payload)


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
