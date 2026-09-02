import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import DownloadIcon from "@mui/icons-material/Download";
import { useNavigate } from "react-router-dom";
import { igjApi, type IgjEntityOption, type IgjPersonOption } from "../api/client";
import type { GraphData, GraphNode } from "../types";
import GraphView, { type GraphViewHandle } from "../components/GraphView";

const IGJ_COLORS: Record<string, string> = {
  AUTORIDAD:     "#7c4dff",
  SOCIO:         "#03dac6",
  REPRESENTANTE: "#ff9800",
  DESCONOCIDO:   "#555555",
};
const EXTRA_PALETTE = ["#e91e63", "#00bcd4", "#8bc34a", "#ff5722", "#9c27b0", "#2196f3"];

type DirectSearchType = "cuit" | "dni";
const EMPTY: GraphData = { nodes: [], edges: [] };

function mergeGraphData(base: GraphData, incoming: GraphData): GraphData {
  const nodeIds = new Set(base.nodes.map((n) => n.id));
  const edgeIds = new Set(base.edges.map((e) => e.id));
  return {
    nodes: [...base.nodes, ...incoming.nodes.filter((n) => !nodeIds.has(n.id))],
    edges: [...base.edges, ...incoming.edges.filter((e) => !edgeIds.has(e.id))],
  };
}

export default function IgjPage() {
  const navigate = useNavigate();
  const graphViewRef = useRef<GraphViewHandle>(null);

  const [inputValue, setInputValue] = useState("");
  const [options, setOptions] = useState<IgjEntityOption[]>([]);
  const [selectedEntities, setSelectedEntities] = useState<IgjEntityOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const [personInputValue, setPersonInputValue] = useState("");
  const [personOptions, setPersonOptions] = useState<IgjPersonOption[]>([]);
  const [selectedPersons, setSelectedPersons] = useState<IgjPersonOption[]>([]);
  const [loadingPersonOptions, setLoadingPersonOptions] = useState(false);

  const [directType, setDirectType] = useState<DirectSearchType>("cuit");
  const [directQuery, setDirectQuery] = useState("");

  const [depth, setDepth] = useState(1);
  const [graphData, setGraphData] = useState<GraphData>(EMPTY);
  const [relColorMap, setRelColorMap] = useState<Record<string, string>>(IGJ_COLORS);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hiddenNodeIds, setHiddenNodeIds] = useState<Set<string>>(new Set());
  const [hidePersons, setHidePersons] = useState(false);
  const [hideEntities, setHideEntities] = useState(false);
  const [hiddenRelTypes, setHiddenRelTypes] = useState<Set<string>>(new Set());
  const [rootNodeIds, setRootNodeIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const depthRef = useRef<number>(depth);

  const updateColors = (data: GraphData, current: Record<string, string>) => {
    const map = { ...current };
    let idx = Object.keys(map).filter((k) => !IGJ_COLORS[k]).length;
    data.edges.forEach((e) => {
      if (!map[e.type]) map[e.type] = EXTRA_PALETTE[idx++ % EXTRA_PALETTE.length];
    });
    return map;
  };

  // Debounced autocomplete fetch
  useEffect(() => {
    const term = inputValue.trim();
    if (term.length < 2) { setOptions([]); return; }
    const timer = setTimeout(() => {
      setLoadingOptions(true);
      igjApi.search(term)
        .then(setOptions)
        .catch(() => setOptions([]))
        .finally(() => setLoadingOptions(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue]);

  // Debounced person autocomplete fetch
  useEffect(() => {
    const term = personInputValue.trim();
    if (term.length < 2) { setPersonOptions([]); return; }
    const timer = setTimeout(() => {
      setLoadingPersonOptions(true);
      igjApi.searchPersonas(term)
        .then(setPersonOptions)
        .catch(() => setPersonOptions([]))
        .finally(() => setLoadingPersonOptions(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [personInputValue]);

  // Rebuild graph when the selected search changes; if only the depth changes, add one extra layer.
  useEffect(() => {
    const correlativos = selectedEntities.map((e) => e.correlativo);
    const personas = selectedPersons.map((p) => `${p.tipo_documento}:${p.numero_documento}`);
    if (correlativos.length === 0 && personas.length === 0) return;

    const doLoad = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await igjApi.expand({ correlativos, personas, depth });
        setRelColorMap((current) => updateColors(data, current));
        const seedIds = new Set([
          ...correlativos.map((id) => `e_${id}`),
          ...personas.map((pair) => `p_${pair.replace(":", "_")}`),
        ]);
        setRootNodeIds((prev) => {
          if (depth !== depthRef.current && prev.size > 0) return new Set([...prev, ...seedIds]);
          return seedIds;
        });
        if (depth === depthRef.current) {
          setGraphData(data);
          setHiddenNodeIds(new Set());
          setHidePersons(false);
          setHideEntities(false);
        } else {
          setGraphData((prev) => mergeGraphData(prev, data));
        }
      } catch {
        setError("Error al cargar el grafo.");
      } finally {
        setLoading(false);
      }
    };

    const depthChanged = depth !== depthRef.current;
    depthRef.current = depth;

    if (depthChanged && graphData.nodes.length > 0) {
      doLoad();
      return;
    }

    setGraphData({ nodes: [], edges: [] });
    setRootNodeIds(new Set(correlativos.map((id) => `e_${id}`)));
    setHiddenNodeIds(new Set());
    setHidePersons(false);
    setHideEntities(false);
    doLoad();
  }, [selectedEntities, selectedPersons, depth]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDirectSearch = async () => {
    const q = directQuery.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setSelectedNode(null);
    try {
      const params = directType === "cuit" ? { cuit: q, depth } : { dni: q, depth };
      const data = await igjApi.expand(params);
      setRelColorMap((current) => updateColors(data, current));
      const seedIds = new Set(data.nodes.filter((n) => n.id.startsWith("e_")).map((n) => n.id));
      setRootNodeIds(seedIds);
      setGraphData(data);
      setHiddenNodeIds(new Set());
      setHidePersons(false);
      setHideEntities(false);
    } catch {
      setError("No se encontraron resultados o hubo un error.");
    } finally {
      setLoading(false);
    }
  };

  const clearVisualization = () => {
    setGraphData(EMPTY);
    setSelectedEntities([]);
    setSelectedPersons([]);
    setDirectQuery("");
    setSelectedNode(null);
    setHiddenNodeIds(new Set());
    setHidePersons(false);
    setHideEntities(false);
    setHiddenRelTypes(new Set());
    setRootNodeIds(new Set());
    setError(null);
  };

  const handleNodeExpand = async (node: GraphNode) => {
    if (expanding) return;
    setExpanding(true);
    setError(null);
    try {
      let params: Parameters<typeof igjApi.expand>[0];
      if (node.id.startsWith("e_") && node.cuit) {
        params = { cuit: node.cuit, depth: 1 };
      } else if (node.id.startsWith("p_")) {
        const parts = node.id.split("_");
        if (parts[1] !== "1") return;
        params = { dni: parts.slice(2).join("_"), depth: 1 };
      } else {
        return;
      }
      const incoming = await igjApi.expand(params);
      setRelColorMap((c) => updateColors(incoming, c));
      setRootNodeIds((prev) => new Set([...prev, ...incoming.nodes.filter((n) => n.id.startsWith("e_")).map((n) => n.id)]));
      setGraphData((prev) => mergeGraphData(prev, incoming));
    } catch {
      setError("Error al expandir el nodo.");
    } finally {
      setExpanding(false);
    }
  };

  const handleHideNode = (nodeId: string) => {
    setHiddenNodeIds((prev) => new Set([...prev, nodeId]));
    if (selectedNode?.id === nodeId) setSelectedNode(null);
  };

  const visibleData = useMemo((): GraphData => {
    const visibleEdges = graphData.edges.filter((e) =>
      !hiddenNodeIds.has(e.source) &&
      !hiddenNodeIds.has(e.target) &&
      !hiddenRelTypes.has(e.type)
    );
    const visibleNodeIds = new Set(visibleEdges.flatMap((e) => [e.source, e.target]));
    for (const id of rootNodeIds) visibleNodeIds.add(id);

    return {
      nodes: graphData.nodes.filter((n) =>
        !hiddenNodeIds.has(n.id) &&
        !(hidePersons && n.tipo === "PERSONA") &&
        !(hideEntities && n.tipo !== "PERSONA") &&
        (rootNodeIds.has(n.id) || visibleNodeIds.has(n.id))
      ),
      edges: visibleEdges,
    };
  }, [graphData, hiddenNodeIds, hidePersons, hideEntities, hiddenRelTypes, rootNodeIds]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", bgcolor: "#0d0d1a" }}>
      <Paper elevation={0} sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", gap: 2,
            bgcolor: "#1a1a2e", borderBottom: "1px solid #2a2a3e", flexWrap: "wrap" }}>
        <IconButton onClick={() => navigate("/")} size="small" sx={{ color: "#aaa" }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="subtitle1" sx={{ color: "#fff", fontWeight: 600 }}>
          IGJ — Datos Societarios
        </Typography>

        {/* Multi-select autocomplete for societies by name */}
        <Autocomplete
          multiple size="small"
          options={options}
          value={selectedEntities}
          inputValue={inputValue}
          loading={loadingOptions}
          getOptionLabel={(o) => o.name}
          isOptionEqualToValue={(a, b) => a.correlativo === b.correlativo}
          filterOptions={(x) => x}
          onInputChange={(_, v, reason) => { if (reason !== "reset") setInputValue(v); }}
          onChange={(_, v) => setSelectedEntities(v)}
          renderOption={(props, o) => (
            <li {...props} key={o.correlativo}>
              <Box>
                <Typography variant="body2">{o.name}</Typography>
                <Typography variant="caption" sx={{ color: "#888" }}>
                  {o.tipo}{o.cuit ? ` · ${o.cuit}` : ""}
                </Typography>
              </Box>
            </li>
          )}
          renderTags={(value, getTagProps) =>
            value.map((o, i) => (
              <Chip {...getTagProps({ index: i })} key={o.correlativo} label={o.name}
                size="small" sx={{ maxWidth: 160, fontSize: 11 }} />
            ))
          }
          sx={{
            width: 380, minWidth: 200,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: "#444" },
            "& input": { color: "#fff" },
            "& .MuiChip-root": { bgcolor: "#7c4dff33", color: "#ccc" },
          }}
          renderInput={(params) => (
            <TextField {...params} placeholder={selectedEntities.length === 0 ? "Buscar sociedad por nombre…" : ""}
              InputProps={{ ...params.InputProps,
                endAdornment: (<>
                  {loadingOptions && <CircularProgress size={14} sx={{ color: "#7c4dff" }} />}
                  {params.InputProps.endAdornment}
                </>),
              }}
            />
          )}
        />

        {/* Person multi-select autocomplete */}
        <Autocomplete
          multiple size="small"
          options={personOptions}
          value={selectedPersons}
          inputValue={personInputValue}
          loading={loadingPersonOptions}
          getOptionLabel={(o) => o.name}
          isOptionEqualToValue={(a, b) => a.tipo_documento === b.tipo_documento && a.numero_documento === b.numero_documento}
          filterOptions={(x) => x}
          onInputChange={(_, v, reason) => { if (reason !== "reset") setPersonInputValue(v); }}
          onChange={(_, v) => setSelectedPersons(v)}
          renderOption={(props, o) => (
            <li {...props} key={`${o.tipo_documento}:${o.numero_documento}`}>
              <Box>
                <Typography variant="body2">{o.name}</Typography>
                <Typography variant="caption" sx={{ color: "#888" }}>
                  Doc: {o.numero_documento} · {o.n_entidades} entidad{o.n_entidades !== 1 ? "es" : ""}
                </Typography>
              </Box>
            </li>
          )}
          renderTags={(value, getTagProps) =>
            value.map((o, i) => (
              <Chip {...getTagProps({ index: i })} key={`${o.tipo_documento}:${o.numero_documento}`}
                label={o.name} size="small" sx={{ maxWidth: 160, fontSize: 11 }} />
            ))
          }
          sx={{
            width: 320, minWidth: 160,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: "#444" },
            "& input": { color: "#fff" },
            "& .MuiChip-root": { bgcolor: "#ff6d0033", color: "#ccc" },
          }}
          renderInput={(params) => (
            <TextField {...params} placeholder={selectedPersons.length === 0 ? "Buscar persona por nombre…" : ""}
              InputProps={{ ...params.InputProps,
                endAdornment: (<>
                  {loadingPersonOptions && <CircularProgress size={14} sx={{ color: "#ff6d00" }} />}
                  {params.InputProps.endAdornment}
                </>),
              }}
            />
          )}
        />

        {/* Direct search by CUIT or DNI */}        <FormControl size="small" sx={{ minWidth: 90 }}>
          <InputLabel sx={{ color: "#aaa" }}>Por</InputLabel>
          <Select value={directType} label="Por"
            onChange={(e) => setDirectType(e.target.value as DirectSearchType)}
            sx={{ color: "#fff", "& .MuiOutlinedInput-notchedOutline": { borderColor: "#444" } }}>
            <MenuItem value="cuit">CUIT</MenuItem>
            <MenuItem value="dni">DNI</MenuItem>
          </Select>
        </FormControl>
        <TextField size="small"
          placeholder={directType === "cuit" ? "30710866313" : "12345678"}
          value={directQuery}
          onChange={(e) => setDirectQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleDirectSearch()}
          sx={{ width: 150, "& input": { color: "#fff" },
                "& .MuiOutlinedInput-notchedOutline": { borderColor: "#444" } }}
          InputProps={{ endAdornment: (
            <InputAdornment position="end">
              <IconButton onClick={handleDirectSearch} size="small" sx={{ color: "#aaa" }}>
                <SearchIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          )}}
        />

        <FormControl size="small" sx={{ minWidth: 100 }}>
          <InputLabel sx={{ color: "#aaa" }}>Profundidad</InputLabel>
          <Select value={depth} label="Profundidad"
            onChange={(e) => setDepth(Number(e.target.value))}
            sx={{ color: "#fff", "& .MuiOutlinedInput-notchedOutline": { borderColor: "#444" } }}>
            {[1, 2, 3, 4].map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
          </Select>
        </FormControl>

        <Button variant="outlined" size="small" sx={{ color: "#ddd", borderColor: "#555" }}
          onClick={clearVisualization}>
          Borrar visualización
        </Button>

        {(loading || expanding) && <CircularProgress size={20} sx={{ color: "#7c4dff" }} />}

        {graphData.nodes.length > 0 && (<>
          <Box sx={{ display: "flex", gap: 0.5 }}>
            <Chip label="Entidades" size="small" onClick={() => setHideEntities((v) => !v)}
              sx={{ bgcolor: hideEntities ? "#333" : "#7c4dff22", color: hideEntities ? "#666" : "#7c4dff",
                    border: "1px solid #7c4dff55", cursor: "pointer" }} />
            <Chip label="Personas" size="small" onClick={() => setHidePersons((v) => !v)}
              sx={{ bgcolor: hidePersons ? "#333" : "#ff6d0022", color: hidePersons ? "#666" : "#ff6d00",
                    border: "1px solid #ff6d0055", cursor: "pointer" }} />
          </Box>
          <Box sx={{ display: "flex", gap: 0.5 }}>
            {Object.entries(IGJ_COLORS).filter(([k]) => k !== "DESCONOCIDO").map(([rel, color]) => {
              const hidden = hiddenRelTypes.has(rel);
              return (
                <Chip key={rel} label={rel} size="small"
                  onClick={() => setHiddenRelTypes((prev) => {
                    const next = new Set(prev); hidden ? next.delete(rel) : next.add(rel); return next;
                  })}
                  sx={{ bgcolor: hidden ? "#333" : `${color}22`, color: hidden ? "#666" : color,
                        border: `1px solid ${color}55`, cursor: "pointer", fontSize: 10 }} />
              );
            })}
          </Box>
          <Tooltip title="Exportar PNG">
            <IconButton onClick={() => graphViewRef.current?.exportPng()} size="small"
              sx={{ color: "#aaa", ml: "auto" }}><DownloadIcon /></IconButton>
          </Tooltip>
        </>)}
      </Paper>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mx: 2, mt: 1 }}>{error}</Alert>
      )}

      {selectedNode && (
        <Paper sx={{ position: "absolute", top: 72, right: 16, zIndex: 10, p: 2,
                     bgcolor: "#1a1a2e", border: "1px solid #2a2a3e", minWidth: 220 }}>
          <Typography variant="subtitle2" sx={{ color: "#fff", fontWeight: 700 }}>{selectedNode.name}</Typography>
          {selectedNode.tipo && (
            <Typography variant="caption" sx={{ color: "#aaa", display: "block" }}>{selectedNode.tipo}</Typography>
          )}
          {selectedNode.cuit && (
            <Typography variant="caption" sx={{ color: "#aaa", display: "block" }}>CUIT: {selectedNode.cuit}</Typography>
          )}
          <Button size="small" variant="outlined" sx={{ mt: 1, fontSize: 11 }}
            onClick={() => handleNodeExpand(selectedNode)} disabled={expanding}>
            Expandir
          </Button>
        </Paper>
      )}

      <Box sx={{ flex: 1, overflow: "hidden" }}>
        {graphData.nodes.length === 0 && !loading ? (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center",
                     height: "100%", color: "#555" }}>
            <Typography>Buscá una sociedad por nombre, o ingresá un CUIT o DNI</Typography>
          </Box>
        ) : (
          <GraphView ref={graphViewRef} data={visibleData} onNodeSelect={setSelectedNode}
            selectedNodeId={selectedNode?.id ?? null} onHideNode={handleHideNode} relColorMap={relColorMap}
            rootNodeIds={rootNodeIds} />
        )}
      </Box>
    </Box>
  );
}
