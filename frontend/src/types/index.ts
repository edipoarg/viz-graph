export interface Dataset {
  id: string;
  name: string;
  created_at: string;
  node_count: number;
  edge_count: number;
  system: boolean;
}

export interface CsvPreview {
  columns: string[];
  preview: Record<string, string>[];
  total_rows: number;
}

export interface ImportProgress {
  event: "start" | "progress" | "done" | "error";
  total?: number;
  imported?: number;
  skipped?: number;
  message?: string;
}

export interface GraphNode {
  id: string;
  name: string;
  dataset_id: string;
  role: "source" | "target" | "both";
  tipo?: string;
  cuit?: string;
  actividad_descripcion?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  weight: number | null;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
