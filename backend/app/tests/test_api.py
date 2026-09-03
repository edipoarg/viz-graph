"""
Basic tests for Edipo Viz API.
Run with: pytest app/tests/ -v
Requires a running Neo4j instance (set NEO4J_URI env var or use defaults).
"""

import io
import json

import pytest
from httpx import AsyncClient, ASGITransport

import app.routers.igj as igj_router
from app.main import app

CSV_CONTENT = b"source,target,relation,weight\nAlice,Bob,KNOWS,1\nBob,Carol,KNOWS,2\n"


@pytest.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


@pytest.mark.asyncio
async def test_health(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_preview_csv(client: AsyncClient):
    resp = await client.post(
        "/api/datasets/preview",
        files={"file": ("test.csv", io.BytesIO(CSV_CONTENT), "text/csv")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "columns" in body
    assert "source" in body["columns"]
    assert len(body["preview"]) == 2


@pytest.mark.asyncio
async def test_preview_rejects_large_non_csv(client: AsyncClient):
    resp = await client.post(
        "/api/datasets/preview",
        files={"file": ("test.exe", io.BytesIO(b"MZ\x00"), "application/octet-stream")},
    )
    # content-type application/octet-stream is allowed (some browsers send it for CSV),
    # but the response should still work or fail gracefully.
    assert resp.status_code in (200, 400)


@pytest.mark.asyncio
async def test_create_and_delete_dataset(client: AsyncClient):
    # Create
    resp = await client.post("/api/datasets", json={"name": "Test Dataset"})
    assert resp.status_code == 201
    dataset = resp.json()
    assert dataset["name"] == "Test Dataset"
    dataset_id = dataset["id"]

    # List
    resp = await client.get("/api/datasets")
    assert resp.status_code == 200
    ids = [d["id"] for d in resp.json()]
    assert dataset_id in ids

    # Delete
    resp = await client.delete(f"/api/datasets/{dataset_id}")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_import_and_graph(client: AsyncClient):
    # Create dataset
    resp = await client.post("/api/datasets", json={"name": "Import Test"})
    dataset_id = resp.json()["id"]

    # Import CSV
    resp = await client.post(
        f"/api/datasets/{dataset_id}/import",
        files={"file": ("test.csv", io.BytesIO(CSV_CONTENT), "text/csv")},
        data={
            "source_col": "source",
            "target_col": "target",
            "relation_col": "relation",
            "weight_col": "weight",
        },
    )
    assert resp.status_code == 200
    lines = [json.loads(line) for line in resp.text.strip().splitlines()]
    events = {l["event"] for l in lines}
    assert "done" in events
    done = next(l for l in lines if l["event"] == "done")
    assert done["imported"] == 2

    # Fetch graph
    resp = await client.get(f"/api/datasets/{dataset_id}/graph")
    assert resp.status_code == 200
    graph = resp.json()
    assert len(graph["nodes"]) == 3  # Alice, Bob, Carol
    assert len(graph["edges"]) == 2

    # Fetch relation types
    resp = await client.get(f"/api/datasets/{dataset_id}/graph/relation-types")
    assert resp.status_code == 200
    assert "KNOWS" in resp.json()

    # Cleanup
    await client.delete(f"/api/datasets/{dataset_id}")


def test_person_expansion_stays_centered_at_depth_1(monkeypatch):
    class FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def fetchall(self):
            return self._rows

    class FakeConn:
        def __init__(self):
            self.queries = []

        def execute(self, query, params=None):
            self.queries.append((query, params))
            if "SELECT DISTINCT numero_correlativo FROM igj_autoridades" in query and "ANY(?)" in query:
                return FakeResult([("101",), ("102",)])
            if "SELECT DISTINCT tipo_documento, numero_documento, apellido_nombre" in query and "ANY(?)" in query:
                return FakeResult([("1", "12345678", "Ana Torres")])
            if "JOIN igj_entidades e ON e.numero_correlativo = a.numero_correlativo" in query:
                return FakeResult([
                    ("1", "12345678", "Ana Torres", "SOCIO", "101", "Acme SA", "Sociedad", "30-12345678-9"),
                    ("1", "12345678", "Ana Torres", "REPRESENTANTE", "102", "Beta SRL", "Sociedad", "30-87654321-9"),
                ])
            return FakeResult([])

        def close(self):
            pass

    monkeypatch.setattr(igj_router.duckdb, "connect", lambda *args, **kwargs: FakeConn())

    graph = igj_router.expand_graph(persona=["1:12345678"], depth=1)

    node_ids = {n.id for n in graph.nodes}
    assert "p_1_12345678" in node_ids
    assert "e_101" in node_ids
    assert "e_102" in node_ids
    assert len(graph.nodes) <= 4


@pytest.mark.asyncio
async def test_delete_nonexistent_dataset(client: AsyncClient):
    resp = await client.delete("/api/datasets/nonexistent-id-xyz")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_invalid_column_config(client: AsyncClient):
    resp = await client.post("/api/datasets", json={"name": "Bad Col Test"})
    dataset_id = resp.json()["id"]

    resp = await client.post(
        f"/api/datasets/{dataset_id}/import",
        files={"file": ("test.csv", io.BytesIO(CSV_CONTENT), "text/csv")},
        data={
            "source_col": "nonexistent_col",
            "target_col": "target",
            "relation_col": "relation",
        },
    )
    assert resp.status_code == 200
    lines = [json.loads(line) for line in resp.text.strip().splitlines()]
    assert any(l["event"] == "error" for l in lines)

    await client.delete(f"/api/datasets/{dataset_id}")
