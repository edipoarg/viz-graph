from pydantic import BaseModel, field_validator
import re


class DatasetCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Dataset name cannot be empty")
        return v


class DatasetOut(BaseModel):
    id: str
    name: str
    created_at: str
    node_count: int = 0
    edge_count: int = 0


class ImportConfig(BaseModel):
    source_col: str
    target_col: str
    relation_col: str
    weight_col: str | None = None
    batch_size: int = 500

    @field_validator("source_col", "target_col", "relation_col", "weight_col")
    @classmethod
    def safe_column_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not re.match(r"^[\w\s\-\.]+$", v, re.UNICODE):
            raise ValueError(f"Invalid column name: {v!r}")
        return v


class NodeOut(BaseModel):
    id: str
    name: str
    dataset_id: str
    role: str = "both"  # "source", "target", or "both"


class EdgeOut(BaseModel):
    id: str
    source: str
    target: str
    type: str
    weight: float | None = None


class GraphOut(BaseModel):
    nodes: list[NodeOut]
    edges: list[EdgeOut]
