import re

import duckdb
from fastapi import APIRouter, HTTPException, Query

from ..config import settings
from ..schemas import EdgeOut, GraphOut, NodeOut

router = APIRouter()

MAX_NODES = 400


def _open_con() -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(settings.duckdb_path), read_only=True)


def _bfs(con: duckdb.DuckDBPyConnection, seed_correlativos: list[str], depth: int) -> GraphOut:
    # Load seed entity nodes
    placeholders = ",".join("?" * len(seed_correlativos))
    rows = con.execute(
        f"SELECT numero_correlativo, razon_social, descripcion_tipo_societario, cuit "
        f"FROM igj_entidades WHERE numero_correlativo IN ({placeholders})",
        seed_correlativos,
    ).fetchall()

    nodes: dict[str, NodeOut] = {
        f"e_{r[0]}": NodeOut(id=f"e_{r[0]}", name=r[1] or "", dataset_id="igj", tipo=r[2], cuit=r[3])
        for r in rows
    }
    edges: dict[str, EdgeOut] = {}
    visited_entities: set[str] = set()
    visited_persons: set[str] = set()  # "tipo_doc:num_doc"
    frontier_entities: set[str] = set(r[0] for r in rows)

    for _ in range(depth):
        if not frontier_entities or len(nodes) >= MAX_NODES:
            break

        new_ents = frontier_entities - visited_entities
        if not new_ents:
            break
        visited_entities |= new_ents

        # Entity → Persons
        ph = ",".join("?" * len(new_ents))
        auth_rows = con.execute(
            f"SELECT numero_correlativo, tipo_documento, numero_documento, "
            f"apellido_nombre, descripcion_tipo_administrador "
            f"FROM igj_autoridades "
            f"WHERE numero_correlativo IN ({ph}) "
            f"  AND numero_documento IS NOT NULL AND TRIM(numero_documento) != ''",
            list(new_ents),
        ).fetchall()

        new_persons: set[str] = set()
        for nc, tdoc, ndoc, nombre, rel in auth_rows:
            ent_id = f"e_{nc}"
            person_key = f"{tdoc}:{ndoc}"
            person_id = f"p_{tdoc}_{ndoc}"
            rel_type = rel or "DESCONOCIDO"

            if person_id not in nodes:
                nodes[person_id] = NodeOut(id=person_id, name=nombre or "", dataset_id="igj", tipo="PERSONA")
            edge_id = f"{person_id}__{rel_type}__{ent_id}"
            if edge_id not in edges:
                edges[edge_id] = EdgeOut(id=edge_id, source=person_id, target=ent_id, type=rel_type)
            if person_key not in visited_persons:
                new_persons.add(person_key)

        if not new_persons or len(nodes) >= MAX_NODES:
            break

        # Persons → Entities (find all entities these persons participate in)
        visited_persons |= new_persons
        ent_rows = con.execute(
            "SELECT DISTINCT e.numero_correlativo, e.razon_social, "
            "e.descripcion_tipo_societario, e.cuit, "
            "a.tipo_documento, a.numero_documento, a.descripcion_tipo_administrador "
            "FROM igj_autoridades a "
            "JOIN igj_entidades e ON e.numero_correlativo = a.numero_correlativo "
            "WHERE CONCAT(a.tipo_documento, ':', a.numero_documento) = ANY(?)",
            [list(new_persons)],
        ).fetchall()

        frontier_entities = set()
        for nc, rs, tipo, cuit, tdoc, ndoc, rel in ent_rows:
            ent_id = f"e_{nc}"
            person_id = f"p_{tdoc}_{ndoc}"
            rel_type = rel or "DESCONOCIDO"

            if ent_id not in nodes:
                nodes[ent_id] = NodeOut(id=ent_id, name=rs or "", dataset_id="igj", tipo=tipo, cuit=cuit)
            edge_id = f"{person_id}__{rel_type}__{ent_id}"
            if edge_id not in edges:
                edges[edge_id] = EdgeOut(id=edge_id, source=person_id, target=ent_id, type=rel_type)
            if nc not in visited_entities:
                frontier_entities.add(nc)
            if len(nodes) >= MAX_NODES:
                break

    # Compute role for each node based on edge membership
    src_ids = {e.source for e in edges.values()}
    tgt_ids = {e.target for e in edges.values()}
    for nid, node in nodes.items():
        node.role = (
            "both" if nid in src_ids and nid in tgt_ids
            else "source" if nid in src_ids
            else "target"
        )

    return GraphOut(nodes=list(nodes.values()), edges=list(edges.values()))


@router.get("/expand", response_model=GraphOut)
def expand_graph(
    cuit: str | None = Query(default=None, description="CUIT de 11 dígitos"),
    razon_social: str | None = Query(default=None, description="Nombre o fragmento de razón social"),
    dni: str | None = Query(default=None, description="DNI del socio/autoridad (6-8 dígitos)"),
    depth: int = Query(default=2, ge=1, le=4, description="Profundidad del BFS (1-4)"),
) -> GraphOut:
    if not any([cuit, razon_social, dni]):
        raise HTTPException(400, "Debe proveer al menos uno: cuit, razon_social o dni")

    con = _open_con()
    try:
        if cuit:
            if not re.match(r"^\d{11}$", cuit):
                raise HTTPException(422, "CUIT debe tener exactamente 11 dígitos")
            rows = con.execute(
                "SELECT numero_correlativo FROM igj_entidades WHERE cuit = ?", [cuit]
            ).fetchall()
        elif razon_social:
            term = razon_social.strip()
            if len(term) < 3:
                raise HTTPException(422, "razon_social debe tener al menos 3 caracteres")
            rows = con.execute(
                "SELECT numero_correlativo FROM igj_entidades WHERE razon_social ILIKE ? LIMIT 10",
                [f"%{term}%"],
            ).fetchall()
        else:
            if not re.match(r"^\d{6,8}$", str(dni)):
                raise HTTPException(422, "DNI debe tener entre 6 y 8 dígitos")
            rows = con.execute(
                "SELECT DISTINCT numero_correlativo FROM igj_autoridades "
                "WHERE numero_documento = ? AND tipo_documento = '1'",
                [dni],
            ).fetchall()

        seed_correlativos = [r[0] for r in rows]
        if not seed_correlativos:
            return GraphOut(nodes=[], edges=[])

        return _bfs(con, seed_correlativos, depth)
    finally:
        con.close()
