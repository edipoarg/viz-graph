from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import lifespan
from .routers import datasets, graph

app = FastAPI(title="Edipo Viz API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(datasets.router, prefix="/api/datasets", tags=["datasets"])
app.include_router(graph.router, prefix="/api/datasets", tags=["graph"])


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
