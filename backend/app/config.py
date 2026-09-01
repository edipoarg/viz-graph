from pydantic_settings import BaseSettings
from pydantic import model_validator
import json


class Settings(BaseSettings):
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_username: str = ""          # Aura calls it USERNAME
    neo4j_password: str = ""
    neo4j_database: str = "neo4j"     # Aura provides a named database
    # Accept JSON array or comma-separated string; defaults to localhost origins
    cors_origins: str = '["http://localhost:5173","http://localhost:3000"]'
    app_username: str = ""
    app_password: str = ""
    duckdb_path: str = "/data/poder_economico.duckdb"

    @property
    def cors_origins_list(self) -> list[str]:
        v = self.cors_origins.strip()
        if not v:
            return ["http://localhost:5173"]
        if v.startswith("["):
            return json.loads(v)
        return [o.strip().rstrip("/") for o in v.split(",") if o.strip()]

    @model_validator(mode="after")
    def _resolve_username(self) -> "Settings":
        # Aura uses NEO4J_USERNAME; fall back to NEO4J_USER for local/Docker
        if self.neo4j_username:
            self.neo4j_user = self.neo4j_username
        return self

    class Config:
        env_file = ".env"


settings = Settings()
