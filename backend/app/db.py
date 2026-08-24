import asyncio
import logging
from contextlib import asynccontextmanager
from neo4j import AsyncGraphDatabase, AsyncDriver, AsyncSession
from .config import settings

logger = logging.getLogger(__name__)

_driver: AsyncDriver | None = None


async def get_driver() -> AsyncDriver:
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
    return _driver


def get_session(driver: AsyncDriver) -> AsyncSession:
    return driver.session(database=settings.neo4j_database)


async def close_driver() -> None:
    global _driver
    if _driver:
        await _driver.close()
        _driver = None


async def _keepalive_loop() -> None:
    while True:
        await asyncio.sleep(24 * 60 * 60)
        try:
            driver = await get_driver()
            async with driver.session(database=settings.neo4j_database) as session:
                await session.run("RETURN 1")
            logger.info("Keepalive ping OK")
        except Exception as exc:
            logger.warning("Keepalive ping failed: %s", exc)


@asynccontextmanager
async def lifespan(_app):
    driver = await get_driver()
    try:
        async with driver.session(database=settings.neo4j_database) as session:
            await session.run(
                "CREATE CONSTRAINT dataset_id_unique IF NOT EXISTS "
                "FOR (d:Dataset) REQUIRE d.id IS UNIQUE"
            )
            await session.run(
                "CREATE INDEX graph_node_dataset IF NOT EXISTS "
                "FOR (n:GraphNode) ON (n.dataset_id)"
            )
            await session.run(
                "CREATE INDEX graph_node_nodeid IF NOT EXISTS "
                "FOR (n:GraphNode) ON (n.node_id)"
            )
            await session.run(
                "CREATE INDEX graph_node_dataset_nodeid IF NOT EXISTS "
                "FOR (n:GraphNode) ON (n.dataset_id, n.node_id)"
            )
            await session.run(
                "CREATE INDEX graph_node_cuit IF NOT EXISTS "
                "FOR (n:GraphNode) ON (n.cuit)"
            )
            await session.run(
                "CREATE FULLTEXT INDEX idx_node_search IF NOT EXISTS "
                "FOR (n:GraphNode) ON EACH [n.name, n.cuit, n.actividad_descripcion]"
            )
    except Exception as exc:
        logger.warning("Neo4j unreachable at startup, skipping schema init: %s", exc)
    task = asyncio.create_task(_keepalive_loop())
    yield
    task.cancel()
    await close_driver()
