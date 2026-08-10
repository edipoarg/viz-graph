import csv
import io
import json
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from neo4j import AsyncDriver

from ..db import get_driver
from ..schemas import DatasetCreate, DatasetOut, ImportConfig

router = APIRouter()

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


def _read_csv_bytes(raw: bytes) -> tuple[list[str], list[dict]]:
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ValueError("CSV has no header row")
    headers = [str(h).strip() for h in reader.fieldnames]
    rows = [row for row in reader]
    return headers, rows


@router.post("/preview")
async def preview_csv(file: UploadFile = File(...)) -> dict:
    if file.content_type not in ("text/csv", "text/plain", "application/octet-stream", "application/vnd.ms-excel"):
        raise HTTPException(400, "File must be a CSV (text/csv)")
    raw = await file.read(MAX_FILE_SIZE + 1)
    if len(raw) > MAX_FILE_SIZE:
        raise HTTPException(413, "File exceeds 50 MB limit")
    try:
        headers, rows = _read_csv_bytes(raw)
    except (UnicodeDecodeError, csv.Error, ValueError) as exc:
        raise HTTPException(400, f"Invalid CSV: {exc}") from exc
    return {"columns": headers, "preview": rows[:5], "total_rows": len(rows)}


@router.get("", response_model=list[DatasetOut])
async def list_datasets(driver: AsyncDriver = Depends(get_driver)) -> list[DatasetOut]:
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (d:Dataset)
            OPTIONAL MATCH (n:GraphNode {dataset_id: d.id})
            OPTIONAL MATCH ()-[e:EDGE {dataset_id: d.id}]->()
            RETURN d.id AS id, d.name AS name, d.created_at AS created_at,
                   count(DISTINCT n) AS node_count, count(DISTINCT e) AS edge_count
            ORDER BY d.created_at DESC
            """
        )
        records = await result.data()
    return [DatasetOut(**r) for r in records]


@router.post("", response_model=DatasetOut, status_code=201)
async def create_dataset(
    body: DatasetCreate,
    driver: AsyncDriver = Depends(get_driver),
) -> DatasetOut:
    dataset_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    async with driver.session() as session:
        await session.run(
            "CREATE (d:Dataset {id: $id, name: $name, created_at: $created_at})",
            id=dataset_id,
            name=body.name,
            created_at=created_at,
        )
    return DatasetOut(id=dataset_id, name=body.name, created_at=created_at)


@router.delete("/{dataset_id}", status_code=204)
async def delete_dataset(
    dataset_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> None:
    async with driver.session() as session:
        result = await session.run(
            "MATCH (d:Dataset {id: $id}) RETURN d",
            id=dataset_id,
        )
        if not await result.single():
            raise HTTPException(404, "Dataset not found")
        await session.run(
            """
            MATCH (d:Dataset {id: $id}) DETACH DELETE d
            """,
            id=dataset_id,
        )
        await session.run(
            "MATCH (n:GraphNode {dataset_id: $id}) DETACH DELETE n",
            id=dataset_id,
        )


async def _import_stream(
    raw: bytes,
    dataset_id: str,
    config: ImportConfig,
    driver: AsyncDriver,
) -> AsyncIterator[str]:
    try:
        headers, rows = _read_csv_bytes(raw)
    except (UnicodeDecodeError, csv.Error, ValueError) as exc:
        yield json.dumps({"event": "error", "message": str(exc)}) + "\n"
        return

    required = {config.source_col, config.target_col, config.relation_col}
    if config.weight_col:
        required.add(config.weight_col)
    missing = required - set(headers)
    if missing:
        yield json.dumps({"event": "error", "message": f"Columns not found: {missing}"}) + "\n"
        return

    total = len(rows)
    if total == 0:
        yield json.dumps({"event": "error", "message": "CSV has no data rows"}) + "\n"
        return

    yield json.dumps({"event": "start", "total": total}) + "\n"

    imported = 0
    errors = 0
    batch = []

    async def flush_batch(b: list) -> None:
        async with driver.session() as session:
            await session.run(
                """
                UNWIND $rows AS row
                MERGE (src:GraphNode {name: row.source, dataset_id: row.dataset_id})
                MERGE (tgt:GraphNode {name: row.target, dataset_id: row.dataset_id})
                MERGE (src)-[e:EDGE {type: row.rel_type, dataset_id: row.dataset_id, source: row.source, target: row.target}]->(tgt)
                ON CREATE SET e.weight = row.weight
                ON MATCH SET e.weight = row.weight
                """,
                rows=b,
            )

    for row in rows:
        src = str(row.get(config.source_col, "")).strip()
        tgt = str(row.get(config.target_col, "")).strip()
        rel = str(row.get(config.relation_col, "")).strip()
        if not src or not tgt or not rel:
            errors += 1
            continue
        weight = None
        if config.weight_col:
            try:
                weight = float(row.get(config.weight_col, ""))
            except (ValueError, TypeError):
                weight = None

        batch.append(
            {
                "source": src,
                "target": tgt,
                "rel_type": rel,
                "weight": weight,
                "dataset_id": dataset_id,
            }
        )

        if len(batch) >= config.batch_size:
            await flush_batch(batch)
            imported += len(batch)
            batch = []
            yield json.dumps({"event": "progress", "imported": imported, "total": total}) + "\n"

    if batch:
        await flush_batch(batch)
        imported += len(batch)

    yield json.dumps(
        {"event": "done", "imported": imported, "skipped": errors, "total": total}
    ) + "\n"


@router.post("/{dataset_id}/import")
async def import_csv(
    dataset_id: str,
    file: UploadFile = File(...),
    source_col: str = Form(...),
    target_col: str = Form(...),
    relation_col: str = Form(...),
    weight_col: str | None = Form(default=None),
    batch_size: int = Form(default=500),
    driver: AsyncDriver = Depends(get_driver),
) -> StreamingResponse:
    async with driver.session() as session:
        result = await session.run(
            "MATCH (d:Dataset {id: $id}) RETURN d", id=dataset_id
        )
        if not await result.single():
            raise HTTPException(404, "Dataset not found")

    try:
        config = ImportConfig(
            source_col=source_col,
            target_col=target_col,
            relation_col=relation_col,
            weight_col=weight_col or None,
            batch_size=batch_size,
        )
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc

    if file.content_type not in ("text/csv", "text/plain", "application/octet-stream", "application/vnd.ms-excel"):
        raise HTTPException(400, "File must be a CSV")
    raw = await file.read(MAX_FILE_SIZE + 1)
    if len(raw) > MAX_FILE_SIZE:
        raise HTTPException(413, "File exceeds 50 MB limit")

    return StreamingResponse(
        _import_stream(raw, dataset_id, config, driver),
        media_type="application/x-ndjson",
    )
