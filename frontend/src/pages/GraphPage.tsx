import { useCallback, useEffect, useRef, useState } from "react";
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
import { useNavigate, useParams } from "react-router-dom";
import { datasetsApi, graphApi } from "../api/client";
import type { GraphData, GraphNode } from "../types";
import GraphView from "../components/GraphView";

const DRAWER_WIDTH = 280;
type SearchField = "name" | "cuit" | "actividad";

export default function GraphPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [isSystem, setIsSystem] = useState<boolean | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [relTypes, setRelTypes] = useState<string[]>([]);
  const [activeRelTypes, setActiveRelTypes] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchField, setSearchField] = useState<SearchField>("name");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Fetch dataset metadata to know if it's a system dataset
  useEffect(() => {
    if (!id) return;
    datasetsApi.get(id).then((ds) => setIsSystem(ds.system)).catch(() => {});
  }, [id]);

  // Load relation types once (only for user datasets)
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
        .then(setGraphData)
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
        .then(setGraphData)
        .catch(() => setError("Error al cargar el grafo"))
        .finally(() => setLoading(false));
    }
  }, [id, isSystem, activeRelTypes, debouncedSearch, relTypes.length, searchField]);

  useEffect(() => {
    if (isSystem === null) return; // wait until we know the dataset type
    loadGraph();
  }, [loadGraph]);

  const handleSearchChange = (v: string) => {
    setSearch(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(v), 400);
  };

  const toggleRelType = (t: string) => {
    setActiveRelTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const relColors = [
    "#7c4dff", "#03dac6", "#ff6d00", "#e91e63", "#00bcd4",
    "#8bc34a", "#ff5722", "#9c27b0", "#ffc107", "#2196f3",
  ];

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
        <Divider />

        {/* Campo de búsqueda: selector solo para dataset sistema */}
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

        {/* Filtros de relación solo para datasets de usuario */}
        {!isSystem && relTypes.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" display="flex" alignItems="center" gap={0.5} mb={0.5}>
              <FilterListIcon fontSize="inherit" /> Filtrar por tipo de relación
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
                    bgcolor: activeRelTypes.includes(t) ? relColors[i % relColors.length] : undefined,
                    borderColor: relColors[i % relColors.length],
                    color: activeRelTypes.includes(t) ? "#fff" : relColors[i % relColors.length],
                  }}
                />
              ))}
            </Box>
          </Box>
        )}

        <Divider />

        {graphData && graphData.nodes.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              {graphData.nodes.length} nodos · {graphData.edges.length} aristas
            </Typography>
          </Box>
        )}

        {/* Panel del nodo seleccionado */}
        {selectedNode && (
          <Box mt={1}>
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
            {selectedNode.cuit && (
              <Typography variant="caption" display="block" color="text.secondary">
                CUIT: {selectedNode.cuit}
              </Typography>
            )}
            {selectedNode.actividad_descripcion && (
              <Typography variant="caption" display="block" color="text.secondary" mt={0.5}>
                Actividad: {selectedNode.actividad_descripcion}
              </Typography>
            )}
            <Button size="small" sx={{ mt: 0.5 }} onClick={() => setSelectedNode(null)}>
              Deseleccionar
            </Button>
          </Box>
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
        {graphData && !loading && graphData.nodes.length > 0 && (
          <GraphView
            data={graphData}
            onNodeSelect={setSelectedNode}
            selectedNodeId={selectedNode?.id ?? null}
          />
        )}
      </Box>
    </Box>
  );
}
