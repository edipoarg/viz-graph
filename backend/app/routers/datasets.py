import csv
import io
import json
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from neo4j import AsyncDriver

from ..db import get_driver, get_session
from ..schemas import DatasetCreate, DatasetOut, ImportConfig

router = APIRouter()

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


# Binary format magic bytes that are definitely not CSV
_BINARY_MAGIC = [
    (b"PK",        "archivo ZIP (.xlsx, .numbers, .docx). Exportá el archivo como CSV primero."),
    (b"%PDF",      "archivo PDF. Exportá los datos como CSV primero."),
    (b"\xd0\xcf",  "archivo Office antiguo (.xls, .doc). Guardá como CSV primero."),
    (b"\x89PNG",   "imagen PNG."),
    (b"\xff\xd8",  "imagen JPEG."),
    (b"GIF8",      "imagen GIF."),
]


def _read_csv_bytes(raw: bytes) -> tuple[list[str], list[dict]]:
    if not raw:
        raise ValueError("El archivo está vacío.")

    for magic, description in _BINARY_MAGIC:
        if raw[:len(magic)] == magic:
            raise ValueError(f"El archivo parece ser un {description}")

    # Try encodings from most to least specific
    text: str | None = None
    for enc in ("utf-8-sig", "utf-16", "utf-8", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    if text is None:
        raise ValueError("No se pudo leer el archivo. Asegurate de que sea un CSV con codificación UTF-8 o Latin-1.")

    text = text.replace("\x00", "")  # strip NUL bytes from malformed encodings
    text = text.strip()
    if not text:
        raise ValueError("El archivo está vacío o solo contiene espacios en blanco.")

    try:
        reader = csv.DictReader(io.StringIO(text, newline=""))
        if reader.fieldnames is None:
            raise ValueError("El archivo no tiene encabezados. La primera fila debe contener los nombres de las columnas.")
        headers = [str(h).strip() for h in reader.fieldnames if h is not None and str(h).strip()]
        if not headers:
            raise ValueError("Las columnas del encabezado están vacías.")
        rows = list(reader)
    except csv.Error as exc:
        raise ValueError(f"Error al parsear el CSV: {exc}") from exc

    if not rows:
        raise ValueError("El archivo tiene encabezados pero no tiene filas de datos.")

    return headers, rows


@router.post("/preview")
async def preview_csv(file: UploadFile = File(...)) -> dict:
    raw = await file.read(MAX_FILE_SIZE + 1)
    if len(raw) > MAX_FILE_SIZE:
        raise HTTPException(413, "El archivo supera el límite de 50 MB.")
    try:
        headers, rows = _read_csv_bytes(raw)
    except (UnicodeDecodeError, csv.Error, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"columns": headers, "preview": rows[:5], "total_rows": len(rows)}


@router.get("", response_model=list[DatasetOut])
async def list_datasets(driver: AsyncDriver = Depends(get_driver)) -> list[DatasetOut]:
    async with get_session(driver) as session:
        result = await session.run(
            """
            MATCH (d:Dataset)
            CALL {
                WITH d
                MATCH (n:GraphNode {dataset_id: d.id})
                WHERE NOT coalesce(d.system, false)
                RETURN count(n) AS nc
            }
            CALL {
                WITH d
                MATCH ()-[e:EDGE {dataset_id: d.id}]->()
                WHERE NOT coalesce(d.system, false)
                RETURN count(e) AS ec
            }
            RETURN d.id AS id, d.name AS name, d.created_at AS created_at,
                   coalesce(d.system, false) AS system,
                   CASE WHEN coalesce(d.system, false)
                        THEN coalesce(d.node_count, 0) ELSE nc END AS node_count,
                   CASE WHEN coalesce(d.system, false)
                        THEN coalesce(d.edge_count, 0) ELSE ec END AS edge_count
            ORDER BY d.created_at DESC
            """
        )
        records = await result.data()
    return [DatasetOut(**r) for r in records]


@router.get("/{dataset_id}", response_model=DatasetOut)
async def get_dataset(
    dataset_id: str,
    driver: AsyncDriver = Depends(get_driver),
) -> DatasetOut:
    async with get_session(driver) as session:
        result = await session.run(
            """
            MATCH (d:Dataset {id: $id})
            RETURN d.id AS id, d.name AS name, d.created_at AS created_at,
                   coalesce(d.system, false) AS system,
                   coalesce(d.node_count, 0) AS node_count,
                   coalesce(d.edge_count, 0) AS edge_count
            """,
            id=dataset_id,
        )
        record = await result.single()
        if not record:
            raise HTTPException(404, "Dataset not found")
    return DatasetOut(**dict(record))


@router.post("", response_model=DatasetOut, status_code=201)
async def create_dataset(
    body: DatasetCreate,
    driver: AsyncDriver = Depends(get_driver),
) -> DatasetOut:
    dataset_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    async with get_session(driver) as session:
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
    async with get_session(driver) as session:
        result = await session.run(
            "MATCH (d:Dataset {id: $id}) RETURN d.system AS system",
            id=dataset_id,
        )
        record = await result.single()
        if not record:
            raise HTTPException(404, "Dataset not found")
        if record["system"]:
            raise HTTPException(403, "No se puede eliminar un dataset del sistema")
        await session.run(
            "MATCH (d:Dataset {id: $id}) DETACH DELETE d",
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
        async with get_session(driver) as session:
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
    async with get_session(driver) as session:
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

    raw = await file.read(MAX_FILE_SIZE + 1)
    if len(raw) > MAX_FILE_SIZE:
        raise HTTPException(413, "File exceeds 50 MB limit")

    return StreamingResponse(
        _import_stream(raw, dataset_id, config, driver),
        media_type="application/x-ndjson",
    )
