from fastapi import APIRouter, Depends, HTTPException, Query
from neo4j import AsyncDriver

from ..db import get_driver, get_session
from ..schemas import GraphOut, NodeOut, EdgeOut

router = APIRouter()


@router.get("/{dataset_id}/graph", response_model=GraphOut)
async def get_graph(
    dataset_id: str,
    rel_types: list[str] | None = Query(default=None),
    search: str | None = Query(default=None),
    driver: AsyncDriver = Depends(get_driver),
) -> GraphOut:
    async with get_session(driver) as session:
        ds_result = await session.run(
            "MATCH (d:Dataset {id: $id}) RETURN d", id=dataset_id
        )
        if not await ds_result.single():
            raise HTTPException(404, "Dataset not found")

        node_filter = ""
        params: dict = {"dataset_id": dataset_id}
        if search:
            node_filter = "AND (toLower(src.name) CONTAINS toLower($search) OR toLower(tgt.name) CONTAINS toLower($search)) "
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
                src.name AS src_name,
                tgt.name AS tgt_name,
                e.type AS rel_type,
                e.weight AS weight
            """,
            **params,
        )
        records = await result.data()

    nodes_map: dict[str, NodeOut] = {}
    edges: list[EdgeOut] = []

    for r in records:
        src_name = r["src_name"]
        tgt_name = r["tgt_name"]
        if src_name not in nodes_map:
            nodes_map[src_name] = NodeOut(id=src_name, name=src_name, dataset_id=dataset_id)
        if tgt_name not in nodes_map:
            nodes_map[tgt_name] = NodeOut(id=tgt_name, name=tgt_name, dataset_id=dataset_id)
        edge_id = f"{src_name}__{r['rel_type']}__{tgt_name}"
        edges.append(
            EdgeOut(
                id=edge_id,
                source=src_name,
                target=tgt_name,
                type=r["rel_type"],
                weight=r["weight"],
            )
        )

    return GraphOut(nodes=list(nodes_map.values()), edges=edges)


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
