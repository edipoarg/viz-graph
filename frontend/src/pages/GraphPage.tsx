import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import FilterListIcon from "@mui/icons-material/FilterList";
import CloseIcon from "@mui/icons-material/Close";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AltRouteIcon from "@mui/icons-material/AltRoute";
import UndoIcon from "@mui/icons-material/Undo";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import DownloadIcon from "@mui/icons-material/Download";
import { useNavigate, useParams } from "react-router-dom";
import { datasetsApi, graphApi } from "../api/client";
import type { GraphData, GraphNode } from "../types";
import GraphView, { type GraphViewHandle } from "../components/GraphView";

const PALETTE = [
  "#7c4dff", "#03dac6", "#ff6d00", "#e91e63", "#00bcd4",
  "#8bc34a", "#ff5722", "#9c27b0", "#ffc107", "#2196f3",
];

const DRAWER_WIDTH = 300;
type SearchField = "name" | "cuit" | "actividad";

function mergeGraphData(base: GraphData, incoming: GraphData): GraphData {
  const nodeIds = new Set(base.nodes.map((n) => n.id));
  const edgeIds = new Set(base.edges.map((e) => e.id));
  return {
    nodes: [...base.nodes, ...incoming.nodes.filter((n) => !nodeIds.has(n.id))],
    edges: [...base.edges, ...incoming.edges.filter((e) => !edgeIds.has(e.id))],
  };
}

export default function GraphPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [isSystem, setIsSystem] = useState<boolean | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  // Each system search becomes a chip; non-system uses a single unnamed entry
  const [searches, setSearches] = useState<Array<{ label: string; nodeIds: string[] }>>([]);
  const seedNodeIds = useMemo(
    () => new Set(searches.flatMap((s) => s.nodeIds)),
    [searches]
  );
  const [relTypes, setRelTypes] = useState<string[]>([]);;
  const [activeRelTypes, setActiveRelTypes] = useState<string[]>([]);
  const [deselectedEdgeTypes, setDeselectedEdgeTypes] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchField, setSearchField] = useState<SearchField>("name");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // Undo history
  const [history, setHistory] = useState<GraphData[]>([]);

  const graphViewRef = useRef<GraphViewHandle>(null);

  // Expand state
  const [expanding, setExpanding] = useState(false);

  // Shortest path state
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [pathLoading, setPathLoading] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Derive available edge types from current graph
  const availableEdgeTypes = useMemo(
    () => [...new Set((graphData?.edges ?? []).map((e) => e.type))].sort(),
    [graphData]
  );

  const relColorMap = useMemo(
    () => Object.fromEntries(availableEdgeTypes.map((t, i) => [t, PALETTE[i % PALETTE.length]])),
    [availableEdgeTypes]
  );

  // filteredData: seed nodes always shown; neighbor nodes only shown if connected by a visible edge
  const filteredData = useMemo((): GraphData | null => {
    if (!graphData) return null;
    if (deselectedEdgeTypes.length === 0) return graphData;
    const visibleEdges = graphData.edges.filter((e) => !deselectedEdgeTypes.includes(e.type));
    const connectedIds = new Set(visibleEdges.flatMap((e) => [e.source, e.target]));
    return {
      nodes: graphData.nodes.filter((n) => seedNodeIds.has(n.id) || connectedIds.has(n.id)),
      edges: visibleEdges,
    };
  }, [graphData, deselectedEdgeTypes, seedNodeIds]);

  useEffect(() => {
    if (!id) return;
    datasetsApi.get(id).then((ds) => setIsSystem(ds.system)).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!id || isSystem !== false) return;
    graphApi
      .relationTypes(id)
      .then((types) => {
        setRelTypes(types);
        setActiveRelTypes(types);
      })
      .catch(() => {});
  }, [id, isSystem]);

  const loadGraph = useCallback(() => {
    if (!id || isSystem === null) return;

    if (isSystem) {
      if (!debouncedSearch.trim()) {
        setGraphData({ nodes: [], edges: [] });
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      graphApi
        .search(id, { q: debouncedSearch.trim(), field: searchField })
        .then((data) => {
          if (data.nodes.length === 0) return;
          const label = debouncedSearch.trim();
          const nodeIds = data.nodes.map((n) => n.id);
          // Add or update the chip for this search term
          setSearches((prev) => {
            const existing = prev.findIndex((s) => s.label === label);
            if (existing >= 0) {
              const next = [...prev];
              next[existing] = { label, nodeIds };
              return next;
            }
            return [...prev, { label, nodeIds }];
          });
          setGraphData((prev) => prev ? mergeGraphData(prev, data) : data);
        })
        .catch(() => setError("Error al buscar en el grafo"))
        .finally(() => setLoading(false));
    } else {
      setLoading(true);
      setError(null);
      graphApi
        .get(id, {
          rel_types: activeRelTypes.length < relTypes.length ? activeRelTypes : undefined,
          search: debouncedSearch || undefined,
        })
        .then((data) => {
          setGraphData(data);
          setSearches([{ label: "", nodeIds: data.nodes.map((n) => n.id) }]);
        })
        .catch(() => setError("Error al cargar el grafo"))
        .finally(() => setLoading(false));
    }
  }, [id, isSystem, activeRelTypes, debouncedSearch, relTypes.length, searchField]);

  useEffect(() => {
    if (isSystem === null) return;
    loadGraph();
  }, [loadGraph]);

  const handleSearchChange = (v: string) => {
    setSearch(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(v), 400);
  };

  const handleClearView = () => {
    setGraphData({ nodes: [], edges: [] });
    setSearches([]);
    setHistory([]);
    setSelectedNode(null);
    setDeselectedEdgeTypes([]);
    setSearch("");
    setDebouncedSearch("");
  };

  const handleRemoveSearch = (idx: number) => {
    const removed = searches[idx];
    const remaining = searches.filter((_, i) => i !== idx);
    const remainingSeedIds = new Set(remaining.flatMap((s) => s.nodeIds));
    const toRemove = new Set(removed.nodeIds.filter((id) => !remainingSeedIds.has(id)));
    setSearches(remaining);
    setGraphData((prev) => {
      if (!prev) return prev;
      let nodes = prev.nodes.filter((n) => !toRemove.has(n.id));
      let edges = prev.edges.filter((e) => !toRemove.has(e.source) && !toRemove.has(e.target));
      // Cascade: remove neighbors that are no longer connected to any remaining seed
      let changed = true;
      while (changed) {
        changed = false;
        const connectedIds = new Set(edges.flatMap((e) => [e.source, e.target]));
        const pruned = nodes.filter((n) => remainingSeedIds.has(n.id) || connectedIds.has(n.id));
        if (pruned.length < nodes.length) {
          changed = true;
          const prunedIds = new Set(pruned.map((n) => n.id));
          edges = edges.filter((e) => prunedIds.has(e.source) && prunedIds.has(e.target));
          nodes = pruned;
        }
      }
      return { nodes, edges };
    });
  };

  const toggleRelType = (t: string) => {
    setActiveRelTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const handleExpand = () => {
    if (!id || !selectedNode || !graphData) return;
    setHistory((h) => [...h, graphData]);
    setExpanding(true);
    const activeEdgeTypes = availableEdgeTypes.filter((t) => !deselectedEdgeTypes.includes(t));
    const relFilter = deselectedEdgeTypes.length > 0 ? activeEdgeTypes : undefined;
    graphApi
      .expand(id, selectedNode.id, relFilter)
      .then((incoming) => {
        setGraphData((prev) => mergeGraphData(prev ?? { nodes: [], edges: [] }, incoming));
      })
      .catch(() => setError("Error al expandir el nodo"))
      .finally(() => setExpanding(false));
  };

  const handleUndo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      setGraphData(h[h.length - 1]);
      return h.slice(0, -1);
    });
  };

  const handleHideNode = (nodeId: string) => {
    setGraphData((prev) =>
      prev
        ? {
            nodes: prev.nodes.filter((n) => n.id !== nodeId),
            edges: prev.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
          }
        : prev
    );
    if (selectedNode?.id === nodeId) setSelectedNode(null);
  };

  const handlePathSearch = () => {
    if (!id || !pathFrom.trim() || !pathTo.trim()) return;
    if (graphData && graphData.nodes.length > 0) setHistory((h) => [...h, graphData]);
    setPathLoading(true);
    setPathError(null);
    graphApi
      .path(id, pathFrom.trim(), pathTo.trim())
      .then((data) => {
        if (data.nodes.length === 0) {
          setPathError("No se encontró un camino entre los dos nodos.");
        } else {
          setGraphData(data);
        }
      })
      .catch(() => setPathError("Error al buscar el camino."))
      .finally(() => setPathLoading(false));
  };

  const isEmpty = graphData?.nodes.length === 0;
  const showSearchPrompt = isSystem && isEmpty && !debouncedSearch && !loading;
  return (
    <Box display="flex" height="100vh" overflow="hidden">
      {/* Sidebar */}
      <Paper
        square
        elevation={3}
        sx={{ width: DRAWER_WIDTH, display: "flex", flexDirection: "column", p: 2, gap: 1, overflow: "auto" }}
      >
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/")} size="small">
          Datasets
        </Button>
        <Box display="flex" gap={1}>
          {history.length > 0 && (
            <Button size="small" startIcon={<UndoIcon fontSize="small" />} onClick={handleUndo} sx={{ flex: 1 }}>
              Deshacer ({history.length})
            </Button>
          )}
          {graphData && graphData.nodes.length > 0 && (
            <Button size="small" color="error" startIcon={<DeleteSweepIcon fontSize="small" />} onClick={handleClearView} sx={{ flex: 1 }}>
              Limpiar
            </Button>
          )}
        </Box>
        {graphData && graphData.nodes.length > 0 && (
          <Button size="small" startIcon={<DownloadIcon fontSize="small" />} onClick={() => graphViewRef.current?.exportPng()}>
            Exportar imagen
          </Button>
        )}
        <Divider />

        {/* Búsqueda principal */}
        {isSystem && (
          <FormControl size="small">
            <InputLabel>Buscar por</InputLabel>
            <Select
              value={searchField}
              label="Buscar por"
              onChange={(e) => {
                setSearchField(e.target.value as SearchField);
                setDebouncedSearch("");
                setSearch("");
              }}
            >
              <MenuItem value="name">Razón social / Nombre</MenuItem>
              <MenuItem value="cuit">CUIT (exacto)</MenuItem>
              <MenuItem value="actividad">Actividad económica</MenuItem>
            </Select>
          </FormControl>
        )}

        <TextField
          size="small"
          placeholder={
            isSystem
              ? searchField === "cuit"
                ? "Ej: 30500000127"
                : "Ingresá un término para buscar…"
              : "Buscar nodos…"
          }
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => handleSearchChange("")}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
        />

        {/* Chips de búsquedas activas (solo sistema) */}
        {isSystem && searches.length > 0 && (
          <Box display="flex" flexWrap="wrap" gap={0.5}>
            {searches.map((s, i) => (
              <Chip
                key={s.label + i}
                label={s.label}
                size="small"
                onDelete={() => handleRemoveSearch(i)}
                color="primary"
                variant="outlined"
              />
            ))}
          </Box>
        )}

        {/* Filtros de tipo de relación (todos los datasets) */}
        {availableEdgeTypes.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" display="flex" alignItems="center" gap={0.5} mb={0.5}>
              <FilterListIcon fontSize="inherit" /> Tipo de relación
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={0.5}>
              {availableEdgeTypes.map((t, i) => (
                <Chip
                  key={t}
                  label={t}
                  size="small"
                  onClick={() =>
                    setDeselectedEdgeTypes((prev) =>
                      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                    )
                  }
                  variant={deselectedEdgeTypes.includes(t) ? "outlined" : "filled"}
                  sx={{
                    bgcolor: !deselectedEdgeTypes.includes(t) ? relColorMap[t] : undefined,
                    borderColor: relColorMap[t],
                    color: !deselectedEdgeTypes.includes(t) ? "#fff" : relColorMap[t],
                  }}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* Filtros por relType para datasets de usuario (server-side) */}
        {!isSystem && relTypes.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" display="flex" alignItems="center" gap={0.5} mb={0.5}>
              <FilterListIcon fontSize="inherit" /> Filtrar carga (servidor)
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={0.5}>
              {relTypes.map((t, i) => (
                <Chip
                  key={t}
                  label={t}
                  size="small"
                  onClick={() => toggleRelType(t)}
                  variant={activeRelTypes.includes(t) ? "filled" : "outlined"}
                  sx={{
                    bgcolor: activeRelTypes.includes(t) ? PALETTE[i % PALETTE.length] : undefined,
                    borderColor: PALETTE[i % PALETTE.length],
                    color: activeRelTypes.includes(t) ? "#fff" : PALETTE[i % PALETTE.length],
                  }}
                />
              ))}
            </Box>
          </Box>
        )}

        <Divider />

        {graphData && graphData.nodes.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {(filteredData ?? graphData).nodes.length} nodos · {(filteredData ?? graphData).edges.length} aristas visibles
          </Typography>
        )}

        {/* Panel del nodo seleccionado */}
        {selectedNode && (
          <Box>
            <Divider sx={{ mb: 1 }} />
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Nodo seleccionado
            </Typography>
            <Typography variant="body2" fontWeight={600}>{selectedNode.name}</Typography>
            {selectedNode.tipo && (
              <Chip
                label={selectedNode.tipo}
                size="small"
                sx={{ mt: 0.5, mb: 0.5,
                  bgcolor: selectedNode.tipo === "Sociedad" ? "#7c4dff" : "#ff6d00",
                  color: "#fff" }}
              />
            )}
            {selectedNode.tipo === "Sociedad" && selectedNode.cuit && (
              <Typography variant="caption" display="block" color="text.secondary">
                CUIT: {selectedNode.cuit}
              </Typography>
            )}
            {selectedNode.tipo === "Persona" && (
              <Typography variant="caption" display="block" color="text.secondary">
                DNI: {selectedNode.id}
              </Typography>
            )}
            {selectedNode.actividad_descripcion && (
              <Typography variant="caption" display="block" color="text.secondary" mt={0.5}>
                Actividad: {selectedNode.actividad_descripcion}
              </Typography>
            )}
            <Box display="flex" gap={1} mt={1} flexWrap="wrap">
              <Button
                size="small"
                variant="contained"
                startIcon={expanding ? <CircularProgress size={14} color="inherit" /> : <AccountTreeIcon fontSize="small" />}
                disabled={expanding}
                onClick={handleExpand}
                sx={{ flexGrow: 1 }}
              >
                Expandir vecinos
              </Button>
              <Button size="small" onClick={() => setSelectedNode(null)}>
                Deseleccionar
              </Button>
            </Box>
          </Box>
        )}

        {/* Camino más corto (solo dataset sistema) */}
        {isSystem && (
          <>
            <Divider />
            <Typography variant="subtitle2" fontWeight={700} display="flex" alignItems="center" gap={0.5}>
              <AltRouteIcon fontSize="small" /> Camino más corto
            </Typography>
            <TextField
              size="small"
              label="Desde (node_id / CUIT / DNI)"
              value={pathFrom}
              onChange={(e) => setPathFrom(e.target.value)}
            />
            <TextField
              size="small"
              label="Hasta (node_id / CUIT / DNI)"
              value={pathTo}
              onChange={(e) => setPathTo(e.target.value)}
            />
            {pathError && (
              <Typography variant="caption" color="error">{pathError}</Typography>
            )}
            <Button
              size="small"
              variant="outlined"
              disabled={pathLoading || !pathFrom.trim() || !pathTo.trim()}
              startIcon={pathLoading ? <CircularProgress size={14} /> : undefined}
              onClick={handlePathSearch}
            >
              Buscar camino
            </Button>
          </>
        )}
      </Paper>

      {/* Área del grafo */}
      <Box flex={1} position="relative">
        {loading && (
          <Box position="absolute" top="50%" left="50%" sx={{ transform: "translate(-50%, -50%)", zIndex: 10 }}>
            <CircularProgress />
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}
        {showSearchPrompt && (
          <Box
            position="absolute" top="50%" left="50%"
            sx={{ transform: "translate(-50%,-50%)", textAlign: "center", px: 4 }}
          >
            <SearchIcon sx={{ fontSize: 56, color: "text.disabled", mb: 1 }} />
            <Typography color="text.secondary" variant="h6">
              Buscá para explorar el grafo
            </Typography>
            <Typography color="text.disabled" variant="body2" mt={0.5}>
              Ingresá una razón social, CUIT o actividad económica
            </Typography>
          </Box>
        )}
        {!loading && !showSearchPrompt && graphData && graphData.nodes.length === 0 && (
          <Box position="absolute" top="50%" left="50%" sx={{ transform: "translate(-50%,-50%)" }}>
            <Typography color="text.secondary">Ningún nodo coincide con la búsqueda.</Typography>
          </Box>
        )}
        {filteredData && !loading && filteredData.nodes.length > 0 && (
          <GraphView
            ref={graphViewRef}
            data={filteredData}
            onNodeSelect={setSelectedNode}
            selectedNodeId={selectedNode?.id ?? null}
            onHideNode={handleHideNode}
            relColorMap={relColorMap}
          />
        )}
      </Box>
    </Box>
  );
}
