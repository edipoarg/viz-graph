import re

import duckdb
from fastapi import APIRouter, HTTPException, Query

from ..config import settings
from ..schemas import EdgeOut, GraphOut, NodeOut

router = APIRouter()

MAX_NODES = 200


def _open_con() -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(settings.duckdb_path), read_only=True)


def _autoridades_table(con: duckdb.DuckDBPyConnection) -> tuple[str, str]:
    has_dedup = con.execute(
        """
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_name = 'igj_autoridades_dedup'
        """
    ).fetchone()[0] > 0
    if has_dedup:
        return "igj_autoridades_dedup", "COALESCE(apellido_nombre_homogeneizado, apellido_nombre)"
    return "igj_autoridades", "apellido_nombre"


def _compute_roles(nodes: dict[str, NodeOut], edges: dict[str, EdgeOut]) -> None:
    src_ids = {e.source for e in edges.values()}
    tgt_ids = {e.target for e in edges.values()}
    for nid, node in nodes.items():
        node.role = (
            "both" if nid in src_ids and nid in tgt_ids
            else "source" if nid in src_ids
            else "target"
        )


def _attach_seed_person_docs(
    con: duckdb.DuckDBPyConnection,
    graph: GraphOut,
    docs: list[str],
    aut_table: str,
    aut_name_expr: str,
) -> GraphOut:
    if not docs:
        return graph

    rows = con.execute(
        f"""
        SELECT
          e.numero_correlativo,
          e.razon_social,
          e.descripcion_tipo_societario,
          e.cuit,
          REGEXP_REPLACE(TRIM(a.numero_documento), '[^0-9]', '', 'g') AS ndoc_norm,
          TRIM({aut_name_expr}) AS apellido_nombre,
          a.descripcion_tipo_administrador
        FROM {aut_table} a
        JOIN igj_entidades e ON e.numero_correlativo = a.numero_correlativo
        WHERE REGEXP_REPLACE(TRIM(a.numero_documento), '[^0-9]', '', 'g') = ANY(?)
        """,
        [docs],
    ).fetchall()

    nodes = {n.id: n for n in graph.nodes}
    edges = {e.id: e for e in graph.edges}

    for nc, rs, tipo_soc, cuit, ndoc_norm, nombre, rel in rows:
        if not ndoc_norm:
            continue

        ent_id = f"e_{nc}"
        person_id = f"p_1_{ndoc_norm}"
        rel_type = rel or "DESCONOCIDO"

        if ent_id not in nodes:
            nodes[ent_id] = NodeOut(id=ent_id, name=rs or "", dataset_id="igj", tipo=tipo_soc, cuit=cuit)
        if person_id not in nodes:
            nodes[person_id] = NodeOut(id=person_id, name=nombre or "", dataset_id="igj", tipo="PERSONA")

        edge_id = f"{person_id}__{rel_type}__{ent_id}"
        if edge_id not in edges:
            edges[edge_id] = EdgeOut(id=edge_id, source=person_id, target=ent_id, type=rel_type)

    _compute_roles(nodes, edges)
    return GraphOut(nodes=list(nodes.values()), edges=list(edges.values()))


def _bfs(con: duckdb.DuckDBPyConnection, seed_correlativos: list[str], depth: int) -> GraphOut:
    aut_table, aut_name_expr = _autoridades_table(con)

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
    visited_persons: set[str] = set()  # "num_doc_normalizado"
    frontier_entities: set[str] = set(r[0] for r in rows)

    for step in range(depth):
        if not frontier_entities or len(nodes) >= MAX_NODES:
            break

        # Entity → Persons (the new layer for this depth step)
        auth_rows = con.execute(
            f"SELECT numero_correlativo, tipo_documento, numero_documento, "
            f"{aut_name_expr} AS apellido_nombre, descripcion_tipo_administrador "
            f"FROM {aut_table} "
            f"WHERE numero_correlativo IN ({','.join('?' for _ in frontier_entities)}) "
            f"  AND numero_documento IS NOT NULL AND TRIM(numero_documento) != ''",
            list(frontier_entities),
        ).fetchall()

        new_persons: set[str] = set()
        for nc, tdoc, ndoc, nombre, rel in auth_rows:
            ndoc_norm = re.sub(r"\D", "", ndoc or "")
            if not ndoc_norm:
                continue
            person_key = ndoc_norm
            if person_key in visited_persons:
                continue
            visited_persons.add(person_key)

            ent_id = f"e_{nc}"
            person_id = f"p_1_{ndoc_norm}"
            rel_type = rel or "DESCONOCIDO"

            if person_id not in nodes:
                nodes[person_id] = NodeOut(id=person_id, name=nombre or "", dataset_id="igj", tipo="PERSONA")
            edge_id = f"{person_id}__{rel_type}__{ent_id}"
            if edge_id not in edges:
                edges[edge_id] = EdgeOut(id=edge_id, source=person_id, target=ent_id, type=rel_type)
            new_persons.add(person_key)

        if step == depth - 1 or not new_persons or len(nodes) >= MAX_NODES:
            break

        # Persons → Entities: this creates the next frontier only for deeper explorations.
        ent_rows = con.execute(
            "SELECT DISTINCT e.numero_correlativo, e.razon_social, "
            "e.descripcion_tipo_societario, e.cuit, "
            "a.tipo_documento, a.numero_documento, a.descripcion_tipo_administrador "
            f"FROM {aut_table} a "
            "JOIN igj_entidades e ON e.numero_correlativo = a.numero_correlativo "
            "WHERE REGEXP_REPLACE(TRIM(a.numero_documento), '[^0-9]', '', 'g') = ANY(?)",
            [list(new_persons)],
        ).fetchall()

        next_frontier_entities: set[str] = set()
        for nc, rs, tipo, cuit, tdoc, ndoc, rel in ent_rows:
            ndoc_norm = re.sub(r"\D", "", ndoc or "")
            if not ndoc_norm:
                continue
            ent_id = f"e_{nc}"
            person_id = f"p_1_{ndoc_norm}"
            rel_type = rel or "DESCONOCIDO"

            if ent_id not in nodes:
                nodes[ent_id] = NodeOut(id=ent_id, name=rs or "", dataset_id="igj", tipo=tipo, cuit=cuit)
            edge_id = f"{person_id}__{rel_type}__{ent_id}"
            if edge_id not in edges:
                edges[edge_id] = EdgeOut(id=edge_id, source=person_id, target=ent_id, type=rel_type)
            if nc not in visited_entities:
                next_frontier_entities.add(nc)
            if len(nodes) >= MAX_NODES:
                break

        visited_entities |= next_frontier_entities
        frontier_entities = next_frontier_entities

    _compute_roles(nodes, edges)

    return GraphOut(nodes=list(nodes.values()), edges=list(edges.values()))


@router.get("/search")
def search_entities(q: str = Query(min_length=2), tipo: str = Query(default="entidad")) -> list[dict]:
    con = _open_con()
    try:
        aut_table, aut_name_expr = _autoridades_table(con)
        if tipo == "persona":
            rows = con.execute(
                f"""
                WITH base AS (
                  SELECT
                    TRIM(tipo_documento) AS tipo_documento,
                    REGEXP_REPLACE(TRIM(numero_documento), '[^0-9]', '', 'g') AS numero_documento,
                    TRIM({aut_name_expr}) AS apellido_nombre,
                    numero_correlativo
                  FROM {aut_table}
                  WHERE {aut_name_expr} ILIKE ?
                    AND numero_documento IS NOT NULL
                    AND TRIM(numero_documento) <> ''
                                ), per_name AS (
                  SELECT
                    numero_documento,
                    apellido_nombre,
                    COUNT(*) AS freq,
                    COUNT(DISTINCT numero_correlativo) AS n
                  FROM base
                  WHERE numero_documento <> ''
                                    GROUP BY 1,2
                                ), ranked_name AS (
                  SELECT
                    numero_documento,
                    apellido_nombre,
                    n,
                    ROW_NUMBER() OVER (
                                            PARTITION BY numero_documento
                      ORDER BY freq DESC, LENGTH(apellido_nombre) DESC, apellido_nombre
                    ) AS rn
                  FROM per_name
                                ), ranked_tipo AS (
                                    SELECT
                                        numero_documento,
                                        tipo_documento,
                                        COUNT(*) AS tfreq,
                                        ROW_NUMBER() OVER (
                                            PARTITION BY numero_documento
                                            ORDER BY
                                                CASE WHEN tipo_documento = '1' THEN 0 ELSE 1 END,
                                                COUNT(*) DESC,
                                                tipo_documento
                                        ) AS rn
                                    FROM base
                                    WHERE numero_documento <> ''
                                    GROUP BY 1,2
                )
                                SELECT
                                    COALESCE(t.tipo_documento, '1') AS tipo_documento,
                                    n.numero_documento,
                                    n.apellido_nombre,
                                    n.n
                                FROM ranked_name n
                                LEFT JOIN ranked_tipo t
                                    ON t.numero_documento = n.numero_documento
                                 AND t.rn = 1
                                WHERE n.rn = 1
                ORDER BY CASE WHEN UPPER(TRIM(apellido_nombre)) LIKE UPPER(?) THEN 0 ELSE 1 END,
                         n DESC
                LIMIT 20
                """,
                [f"%{q.strip()}%", f"{q.strip()}%"],
            ).fetchall()
            return [
                {
                    "tipo_documento": r[0],
                    "numero_documento": r[1],
                    "name": r[2],
                    "n_entidades": r[3],
                }
                for r in rows
            ]

        rows = con.execute(
            "SELECT numero_correlativo, razon_social, cuit, descripcion_tipo_societario "
            "FROM igj_entidades "
            "WHERE razon_social ILIKE ? "
            "ORDER BY CASE WHEN UPPER(TRIM(razon_social)) LIKE UPPER(?) THEN 0 ELSE 1 END, "
            "LENGTH(razon_social) "
            "LIMIT 20",
            [f"%{q.strip()}%", f"{q.strip()}%"],
        ).fetchall()
        return [{"correlativo": r[0], "name": r[1] or "", "cuit": r[2], "tipo": r[3] or ""} for r in rows]
    finally:
        con.close()


@router.get("/expand", response_model=GraphOut)
def expand_graph(
    correlativo: list[str] = Query(default=[]),
    persona: list[str] = Query(default=[]),  # "tipo_doc:num_doc" pairs
    cuit: str | None = Query(default=None),
    razon_social: str | None = Query(default=None),
    dni: str | None = Query(default=None),
    depth: int = Query(default=2, ge=1, le=4),
) -> GraphOut:
    if not any([correlativo, persona, cuit, razon_social, dni]):
        raise HTTPException(400, "Debe proveer al menos uno: correlativo, persona, cuit, razon_social o dni")

    con = _open_con()
    try:
        aut_table, aut_name_expr = _autoridades_table(con)

        seed_correlativos_set: set[str] = set(correlativo)
        persona_docs: list[str] = []

        if persona:
            docs = []
            for value in persona:
                part = value.split(":", 1)
                ndoc = part[1] if len(part) == 2 else part[0]
                ndoc_norm = re.sub(r"\D", "", ndoc)
                if ndoc_norm:
                    docs.append(ndoc_norm)
            persona_docs = sorted(set(docs))

            if persona_docs:
                rows = con.execute(
                    f"SELECT DISTINCT numero_correlativo FROM {aut_table} "
                    "WHERE REGEXP_REPLACE(TRIM(numero_documento), '[^0-9]', '', 'g') = ANY(?)",
                    [persona_docs],
                ).fetchall()
                seed_correlativos_set.update(r[0] for r in rows)

        if cuit:
            if not re.match(r"^\d{11}$", cuit):
                raise HTTPException(422, "CUIT debe tener exactamente 11 dígitos")
            rows = con.execute(
                "SELECT numero_correlativo FROM igj_entidades WHERE cuit = ?", [cuit]
            ).fetchall()
            seed_correlativos_set.update(r[0] for r in rows)

        if razon_social:
            term = razon_social.strip()
            if len(term) < 3:
                raise HTTPException(422, "razon_social debe tener al menos 3 caracteres")
            rows = con.execute(
                "SELECT numero_correlativo FROM igj_entidades "
                "WHERE razon_social ILIKE ? "
                "ORDER BY CASE WHEN UPPER(TRIM(razon_social)) LIKE UPPER(?) THEN 0 ELSE 1 END, "
                "LENGTH(razon_social) "
                "LIMIT 20",
                [f"%{term}%", f"{term}%"],
            ).fetchall()
            seed_correlativos_set.update(r[0] for r in rows)

        if dni:
            dni_norm = re.sub(r"\D", "", str(dni or ""))
            if not re.match(r"^\d{6,8}$", dni_norm):
                raise HTTPException(422, "DNI debe tener entre 6 y 8 dígitos")
            rows = con.execute(
                f"SELECT DISTINCT numero_correlativo FROM {aut_table} "
                "WHERE REGEXP_REPLACE(TRIM(numero_documento), '[^0-9]', '', 'g') = ?",
                [dni_norm],
            ).fetchall()
            seed_correlativos_set.update(r[0] for r in rows)

        seed_correlativos = sorted(seed_correlativos_set)

        if not seed_correlativos:
            return GraphOut(nodes=[], edges=[])

        if persona_docs:
            # Desde persona, profundidad 1 = modo ego (solo persona + entidades propias).
            # Recién en profundidad 2 aparecen otras personas conectadas.
            if depth == 1:
                base = _bfs(con, seed_correlativos, 0)
                return _attach_seed_person_docs(con, base, persona_docs, aut_table, aut_name_expr)

            expanded = _bfs(con, seed_correlativos, depth - 1)
            return _attach_seed_person_docs(con, expanded, persona_docs, aut_table, aut_name_expr)

        return _bfs(con, seed_correlativos, depth)
    finally:
        con.close()
