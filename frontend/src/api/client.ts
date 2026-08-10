import axios from "axios";
import type { Dataset, CsvPreview, GraphData } from "../types";

const api = axios.create({ baseURL: "/api" });

export const datasetsApi = {
  list: () => api.get<Dataset[]>("/datasets").then((r) => r.data),
  create: (name: string) =>
    api.post<Dataset>("/datasets", { name }).then((r) => r.data),
  delete: (id: string) => api.delete(`/datasets/${id}`),
  preview: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<CsvPreview>("/datasets/preview", fd).then((r) => r.data);
  },
  importCsv: (
    datasetId: string,
    file: File,
    cols: {
      source_col: string;
      target_col: string;
      relation_col: string;
      weight_col?: string;
    },
    onProgress: (p: { imported: number; total: number }) => void
  ): Promise<{ imported: number; skipped: number }> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("source_col", cols.source_col);
    fd.append("target_col", cols.target_col);
    fd.append("relation_col", cols.relation_col);
    if (cols.weight_col) fd.append("weight_col", cols.weight_col);

    return fetch(`/api/datasets/${datasetId}/import`, {
      method: "POST",
      body: fd,
    }).then(async (res) => {
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let imported = 0;
      let skipped = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.event === "error") throw new Error(evt.message);
          if (evt.event === "progress") onProgress({ imported: evt.imported, total: evt.total });
          if (evt.event === "done") {
            imported = evt.imported;
            skipped = evt.skipped;
          }
        }
      }
      return { imported, skipped };
    });
  },
};

export const graphApi = {
  get: (id: string, params?: { rel_types?: string[]; search?: string }) =>
    api
      .get<GraphData>(`/datasets/${id}/graph`, {
        params: {
          ...(params?.rel_types?.length ? { rel_types: params.rel_types } : {}),
          ...(params?.search ? { search: params.search } : {}),
        },
        paramsSerializer: { indexes: null },
      })
      .then((r) => r.data),
  relationTypes: (id: string) =>
    api.get<string[]>(`/datasets/${id}/graph/relation-types`).then((r) => r.data),
};
