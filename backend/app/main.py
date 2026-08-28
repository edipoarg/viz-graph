import logging

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from neo4j.exceptions import ServiceUnavailable

from .auth import require_auth
from .config import settings
from .db import get_driver, lifespan
from .routers import datasets, graph

logger = logging.getLogger(__name__)

app = FastAPI(title="Edipo Viz API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=r"https://[a-zA-Z0-9-]+\.onrender\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ServiceUnavailable)
async def neo4j_unavailable_handler(request: Request, exc: ServiceUnavailable) -> JSONResponse:
    logger.warning("Neo4j unavailable on %s %s: %s", request.method, request.url, exc)
    return JSONResponse(status_code=503, content={"detail": "Base de datos no disponible"})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

app.include_router(
    datasets.router,
    prefix="/api/datasets",
    tags=["datasets"],
    dependencies=[Depends(require_auth)],
)
app.include_router(
    graph.router,
    prefix="/api/datasets",
    tags=["graph"],
    dependencies=[Depends(require_auth)],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/keepalive")
async def keepalive() -> dict:
    driver = await get_driver()
    async with driver.session(database=settings.neo4j_database) as session:
        await session.run("RETURN 1")
    return {"status": "ok"}
