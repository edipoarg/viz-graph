from pydantic_settings import BaseSettings
from pydantic import model_validator


class Settings(BaseSettings):
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_username: str = ""          # Aura calls it USERNAME
    neo4j_password: str = "edipo_secret"
    neo4j_database: str = "neo4j"     # Aura provides a named database
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    @model_validator(mode="after")
    def _resolve_username(self) -> "Settings":
        # Aura uses NEO4J_USERNAME; fall back to NEO4J_USER for local/Docker
        if self.neo4j_username and not self.neo4j_user:
            self.neo4j_user = self.neo4j_username
        elif self.neo4j_username:
            self.neo4j_user = self.neo4j_username
        return self

    class Config:
        env_file = ".env"


settings = Settings()
