"""Servidor MCP do domínio "matriculas" do Cookings.

Expõe, via protocolo MCP (transporte streamable-http), ferramentas que
uma IA pode usar para consultar e gerenciar alunos e matrículas. Este
servidor não acessa banco de dados diretamente — ele é um tradutor
MCP -> HTTP que chama o `service_matriculas` (pasta services/).
"""

import os
from typing import Optional

import httpx
from mcp.server.fastmcp import FastMCP

SERVICE_MATRICULAS_URL = os.environ.get("SERVICE_MATRICULAS_URL", "http://localhost:3002")
MCP_PORT = int(os.environ.get("MCP_PORT", "8002"))

mcp = FastMCP("cookings-matriculas", host="0.0.0.0", port=MCP_PORT)


# ---------------------------------------------------------------------------
# Helpers HTTP (chamam o service_matriculas e normalizam erros)
# ---------------------------------------------------------------------------

async def _request(method: str, path: str, **kwargs) -> dict | list:
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.request(method, f"{SERVICE_MATRICULAS_URL}{path}", **kwargs)
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
            return {"erro": True, "status": None, "detalhe": f"Falha ao conectar ao service_matriculas: {exc}"}


# Tamanho de página usado ao varrer listagens (máximo aceito pela API).
TAMANHO_PAGINA = 200


def _e_erro(resultado) -> bool:
    """True se o resultado de `_request` é um erro padronizado."""
    return isinstance(resultado, dict) and resultado.get("erro") is True


async def _paginar(path: str, params: Optional[dict] = None) -> dict | list:
    """Varre uma listagem com limit=200 e offset crescente, até a página vir
    menor que 200. Propaga na hora o erro `{erro: true}` de qualquer página."""
    itens: list = []
    offset = 0
    while True:
        pagina = await _request(
            "GET", path, params={**(params or {}), "limit": TAMANHO_PAGINA, "offset": offset}
        )
        if _e_erro(pagina):
            return pagina
        if not isinstance(pagina, list):
            return {"erro": True, "status": None, "detalhe": f"Resposta inesperada de {path}: esperava uma lista."}
        itens.extend(pagina)
        if len(pagina) < TAMANHO_PAGINA:
            return itens
        offset += TAMANHO_PAGINA


# ---------------------------------------------------------------------------
# Tools — Alunos
# ---------------------------------------------------------------------------

@mcp.tool()
async def listar_alunos(nome: Optional[str] = None) -> dict | list:
    """Lista TODOS os alunos cadastrados no Cookings (percorre todas as páginas).

    Args:
        nome: se informado, filtra alunos cujo nome contém este texto
            (busca feita localmente sobre a lista completa, pois o service
            não oferece filtro por nome).
    """
    resultado = await _paginar("/alunos")
    if isinstance(resultado, list) and nome:
        alvo = nome.strip().lower()
        resultado = [a for a in resultado if alvo in a.get("nome", "").lower()]
    return resultado


@mcp.tool()
async def obter_aluno(aluno_id: str) -> dict:
    """Retorna os detalhes de um aluno específico pelo seu ID (UUID)."""
    return await _request("GET", f"/alunos/{aluno_id}")


@mcp.tool()
async def cadastrar_aluno(nome: str, email: str) -> dict:
    """Cadastra um novo aluno no Cookings.

    Args:
        nome: nome completo do aluno.
        email: email do aluno (deve ser único).
    """
    return await _request("POST", "/alunos", json={"nome": nome, "email": email})


# ---------------------------------------------------------------------------
# Tools — Matrículas
# ---------------------------------------------------------------------------

@mcp.tool()
async def listar_matriculas(aluno_id: Optional[str] = None, curso_id: Optional[str] = None) -> dict | list:
    """Lista TODAS as matrículas (percorre todas as páginas), opcionalmente
    filtrando por aluno e/ou curso.

    Args:
        aluno_id: ID (UUID) do aluno para filtrar suas matrículas.
        curso_id: ID (UUID) do curso para filtrar quem está matriculado nele.
    """
    params = {k: v for k, v in {"alunoId": aluno_id, "cursoId": curso_id}.items() if v}
    return await _paginar("/matriculas", params)


@mcp.tool()
async def resumo_progresso_aluno(aluno_id: str) -> dict:
    """Resume o progresso de um aluno nos cursos em que está matriculado.

    Retorna `{ alunoId, total, ativas, concluidas, canceladas, progressoMedio }`.
    `progressoMedio` é a média de `progressoPercentual` das matrículas do
    aluno (0 se não houver matrículas), com 1 casa decimal.

    Args:
        aluno_id: ID (UUID) do aluno.
    """
    matriculas = await _paginar("/matriculas", {"alunoId": aluno_id})
    if _e_erro(matriculas):
        return matriculas

    total = len(matriculas)
    por_status = lambda status: sum(1 for m in matriculas if m.get("status") == status)
    media = sum(m.get("progressoPercentual") or 0 for m in matriculas) / total if total else 0
    return {
        "alunoId": aluno_id,
        "total": total,
        "ativas": por_status("ativa"),
        "concluidas": por_status("concluida"),
        "canceladas": por_status("cancelada"),
        "progressoMedio": round(media, 1),
    }


@mcp.tool()
async def obter_matricula(matricula_id: str) -> dict:
    """Retorna os detalhes de uma matrícula específica pelo seu ID (UUID)."""
    return await _request("GET", f"/matriculas/{matricula_id}")


@mcp.tool()
async def matricular_aluno(aluno_id: str, curso_id: str) -> dict:
    """Matricula um aluno em um curso.

    Args:
        aluno_id: ID (UUID) do aluno já cadastrado.
        curso_id: ID (UUID) do curso (do service_cursos) em que ele será matriculado.
    """
    return await _request("POST", "/matriculas", json={"alunoId": aluno_id, "cursoId": curso_id})


@mcp.tool()
async def atualizar_progresso_matricula(
    matricula_id: str,
    progresso_percentual: int,
) -> dict:
    """Atualiza o progresso (%) de uma matrícula.

    Ao atingir 100%, o service marca automaticamente a matrícula como
    "concluida" e emite o certificado, a menos que valores explícitos
    sejam enviados para sobrepor esse comportamento.

    Args:
        matricula_id: ID (UUID) da matrícula.
        progresso_percentual: novo progresso, de 0 a 100.
    """
    return await _request(
        "PATCH",
        f"/matriculas/{matricula_id}/progresso",
        json={"progressoPercentual": progresso_percentual},
    )


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
