from fastapi import APIRouter, Depends, HTTPException, Query
from neo4j import AsyncDriver

from ..db import get_driver, get_session
from ..schemas import GraphOut, NodeOut, EdgeOut

router = APIRouter()


def _build_graph(records: list[dict], dataset_id: str) -> GraphOut:
    """Construct GraphOut from rows that have src_*/tgt_* fields."""
    nodes_map: dict[str, NodeOut] = {}
    src_set: set[str] = set()
    tgt_set: set[str] = set()
    edges: list[EdgeOut] = []

    for r in records:
        sid = r["src_id"]
        tid = r["tgt_id"]
        src_set.add(sid)
        tgt_set.add(tid)
        if sid not in nodes_map:
            nodes_map[sid] = NodeOut(
                id=sid, name=r["src_name"], dataset_id=dataset_id,
                tipo=r.get("src_tipo"), cuit=r.get("src_cuit") or None,
                actividad_descripcion=r.get("src_actividad") or None,
            )
        if tid not in nodes_map:
            nodes_map[tid] = NodeOut(
                id=tid, name=r["tgt_name"], dataset_id=dataset_id,
                tipo=r.get("tgt_tipo"), cuit=r.get("tgt_cuit") or None,
                actividad_descripcion=r.get("tgt_actividad") or None,
            )
        edge_id = f"{r['e_src']}__{r['rel_type']}__{r['e_tgt']}"
        edges.append(EdgeOut(
            id=edge_id, source=r["e_src"], target=r["e_tgt"],
            type=r["rel_type"], weight=r.get("weight"),
        ))

    for nid, node in nodes_map.items():
        is_src = nid in src_set
        is_tgt = nid in tgt_set
        node.role = "both" if (is_src and is_tgt) else ("source" if is_src else "target")

    return GraphOut(nodes=list(nodes_map.values()), edges=edges)


@router.get("/{dataset_id}/graph", response_model=GraphOut)
async def get_graph(
    dataset_id: str,
    rel_types: list[str] | None = Query(default=None),
    search: str | None = Query(default=None),
    driver: AsyncDriver = Depends(get_driver),
) -> GraphOut:
    async with get_session(driver) as session:
        ds_result = await session.run(
            "MATCH (d:Dataset {id: $id}) RETURN d.system AS system", id=dataset_id
        )
        record = await ds_result.single()
        if not record:
            raise HTTPException(404, "Dataset not found")
        # Sistema datasets are too large to load in full — use /search instead
        if record["system"]:
            return GraphOut(nodes=[], edges=[])

        node_filter = ""
        params: dict = {"dataset_id": dataset_id}
        if search:
            node_filter = (
                "AND (toLower(src.name) CONTAINS toLower($search) "
                "OR toLower(tgt.name) CONTAINS toLower($search)) "
            )
            params["search"] = search

        edge_filter = ""
        if rel_types:
            edge_filter = "AND e.type IN $rel_types "
            params["rel_types"] = rel_types

        result = await session.run(
            f"""
            MATCH (src:GraphNode {{dataset_id: $dataset_id}})-[e:EDGE {{dataset_id: $dataset_id}}]->(tgt:GraphNode {{dataset_id: $dataset_id}})
            WHERE 1=1 {node_filter}{edge_filter}
            RETURN
                COALESCE(src.node_id, src.name) AS src_id,
                src.name AS src_name, src.tipo AS src_tipo,
                COALESCE(src.cuit, '') AS src_cuit, src.actividad_descripcion AS src_actividad,
                COALESCE(tgt.node_id, tgt.name) AS tgt_id,
                tgt.name AS tgt_name, tgt.tipo AS tgt_tipo,
                COALESCE(tgt.cuit, '') AS tgt_cuit, tgt.actividad_descripcion AS tgt_actividad,
                COALESCE(startNode(e).node_id, startNode(e).name) AS e_src,
                COALESCE(endNode(e).node_id,   endNode(e).name)   AS e_tgt,
                e.type AS rel_type, e.weight AS weight
            """,
            **params,
        )
        records = await result.data()

    return _build_graph(records, dataset_id)


@router.get("/{dataset_id}/search", response_model=GraphOut)
async def search_and_expand(
    dataset_id: str,
    q: str = Query(..., min_length=1),
    field: str = Query("name"),  # name | cuit | actividad
    driver: AsyncDriver = Depends(get_driver),
) -> GraphOut:
    async with get_session(driver) as session:
        ds_result = await session.run(
            "MATCH (d:Dataset {id: $id}) RETURN d", id=dataset_id
        )
        if not await ds_result.single():
            raise HTTPException(404, "Dataset not found")

        # ── Paso 1: encontrar nodos semilla ───────────────────────────────────
        if field == "cuit":
            seed_result = await session.run(
                """
                MATCH (n:GraphNode {cuit: $q, dataset_id: $dataset_id})
                RETURN COALESCE(n.node_id, n.name) AS nid,
                       n.name AS name, n.tipo AS tipo,
                       COALESCE(n.cuit, '') AS cuit,
                       n.actividad_descripcion AS actividad
                LIMIT 20
                """,
                q=q, dataset_id=dataset_id,
            )
        else:
            # Fulltext sobre name + cuit + actividad_descripcion
            ft_q = q.strip()
            # Agrega wildcard al último token para búsqueda por prefijo
            words = ft_q.split()
            if words:
                words[-1] = words[-1] + "*"
            ft_q = " ".join(words)
            seed_result = await session.run(
                """
                CALL db.index.fulltext.queryNodes('idx_node_search', $q) YIELD node, score
                WHERE node.dataset_id = $dataset_id
                RETURN COALESCE(node.node_id, node.name) AS nid,
                       node.name AS name, node.tipo AS tipo,
                       COALESCE(node.cuit, '') AS cuit,
                       node.actividad_descripcion AS actividad
                LIMIT 20
                """,
                q=ft_q, dataset_id=dataset_id,
            )

        seed_records = await seed_result.data()
        if not seed_records:
            return GraphOut(nodes=[], edges=[])

        seed_nids = [r["nid"] for r in seed_records]
        seed_nids_set = set(seed_nids)

        # ── Paso 2a: aristas 1-hop ────────────────────────────────────────────
        hop1_result = await session.run(
            """
            MATCH (seed:GraphNode {dataset_id: $dataset_id})
            WHERE seed.node_id IN $seed_nids OR seed.name IN $seed_nids
            WITH seed
            MATCH (seed)-[e:EDGE]-(hop1)
            WHERE hop1.dataset_id = $dataset_id
            WITH DISTINCT e, startNode(e) AS src, endNode(e) AS tgt
            RETURN
                COALESCE(src.node_id, src.name) AS src_id,
                src.name AS src_name,  src.tipo AS src_tipo,
                COALESCE(src.cuit, '') AS src_cuit,
                src.actividad_descripcion AS src_actividad,
                COALESCE(tgt.node_id, tgt.name) AS tgt_id,
                tgt.name AS tgt_name,  tgt.tipo AS tgt_tipo,
                COALESCE(tgt.cuit, '') AS tgt_cuit,
                tgt.actividad_descripcion AS tgt_actividad,
                COALESCE(src.node_id, src.name) AS e_src,
                COALESCE(tgt.node_id, tgt.name) AS e_tgt,
                e.type AS rel_type, e.weight AS weight
            LIMIT 500
            """,
            seed_nids=seed_nids, dataset_id=dataset_id,
        )
        hop1_records = await hop1_result.data()

        # ── Paso 2b: aristas 2-hop (vecinos de los vecinos) ───────────────────
        hop1_nids = list({
            r["tgt_id"] if r["src_id"] in seed_nids_set else r["src_id"]
            for r in hop1_records
        } - seed_nids_set)[:30]

        hop2_records: list[dict] = []
        if hop1_nids:
            hop2_result = await session.run(
                """
                MATCH (hop1:GraphNode {dataset_id: $dataset_id})
                WHERE hop1.node_id IN $hop1_nids OR hop1.name IN $hop1_nids
                WITH hop1
                MATCH (hop1)-[e:EDGE]-(hop2)
                WHERE hop2.dataset_id = $dataset_id
                WITH DISTINCT e, startNode(e) AS src, endNode(e) AS tgt
                RETURN
                    COALESCE(src.node_id, src.name) AS src_id,
                    src.name AS src_name,  src.tipo AS src_tipo,
                    COALESCE(src.cuit, '') AS src_cuit,
                    src.actividad_descripcion AS src_actividad,
                    COALESCE(tgt.node_id, tgt.name) AS tgt_id,
                    tgt.name AS tgt_name,  tgt.tipo AS tgt_tipo,
                    COALESCE(tgt.cuit, '') AS tgt_cuit,
                    tgt.actividad_descripcion AS tgt_actividad,
                    COALESCE(src.node_id, src.name) AS e_src,
                    COALESCE(tgt.node_id, tgt.name) AS e_tgt,
                    e.type AS rel_type, e.weight AS weight
                LIMIT 500
                """,
                hop1_nids=hop1_nids, dataset_id=dataset_id,
            )
            hop2_records = await hop2_result.data()

        expand_records = hop1_records + hop2_records

    # Construir respuesta incluyendo semillas sin aristas
    nodes_map: dict[str, NodeOut] = {}
    for r in seed_records:
        nid = r["nid"]
        nodes_map[nid] = NodeOut(
            id=nid, name=r["name"], dataset_id=dataset_id, role="both",
            tipo=r.get("tipo"), cuit=r.get("cuit") or None,
            actividad_descripcion=r.get("actividad") or None,
        )

    if expand_records:
        graph = _build_graph(expand_records, dataset_id)
        for n in graph.nodes:
            if n.id not in nodes_map:
                nodes_map[n.id] = n
        return GraphOut(nodes=list(nodes_map.values()), edges=graph.edges)

    return GraphOut(nodes=list(nodes_map.values()), edges=[])


@router.get("/{dataset_id}/graph/relation-types")
async def get_relation_types(
    dataset_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> list[str]:
    async with get_session(driver) as session:
        result = await session.run(
            "MATCH ()-[e:EDGE {dataset_id: $id}]->() RETURN DISTINCT e.type AS t ORDER BY t",
            id=dataset_id,
        )
        records = await result.data()
    return [r["t"] for r in records]
