from contextlib import asynccontextmanager
from neo4j import AsyncGraphDatabase, AsyncDriver, AsyncSession
from .config import settings

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


@asynccontextmanager
async def lifespan(_app):
    driver = await get_driver()
    async with driver.session(database=settings.neo4j_database) as session:
        await session.run(
            "CREATE CONSTRAINT dataset_id_unique IF NOT EXISTS "
            "FOR (d:Dataset) REQUIRE d.id IS UNIQUE"
        )
        await session.run(
            "CREATE INDEX graph_node_dataset IF NOT EXISTS "
            "FOR (n:GraphNode) ON (n.dataset_id)"
        )
    yield
    await close_driver()
