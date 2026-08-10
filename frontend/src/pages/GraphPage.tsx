import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import FilterListIcon from "@mui/icons-material/FilterList";
import CloseIcon from "@mui/icons-material/Close";
import { useNavigate, useParams } from "react-router-dom";
import { graphApi } from "../api/client";
import type { GraphData, GraphNode } from "../types";
import GraphView from "../components/GraphView";

const DRAWER_WIDTH = 280;

export default function GraphPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [relTypes, setRelTypes] = useState<string[]>([]);
  const [activeRelTypes, setActiveRelTypes] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load relation types once
  useEffect(() => {
    if (!id) return;
    graphApi
      .relationTypes(id)
      .then((types) => {
        setRelTypes(types);
        setActiveRelTypes(types);
      })
      .catch(() => {});
  }, [id]);

  const loadGraph = useCallback(() => {
    if (!id) return;
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
  }, [id, activeRelTypes, debouncedSearch, relTypes.length]);

  useEffect(() => {
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

        <TextField
          size="small"
          placeholder="Buscar nodos…"
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

        <Divider />

        {graphData && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              {graphData.nodes.length} nodos · {graphData.edges.length} aristas
            </Typography>
          </Box>
        )}

        {/* Selected node properties */}
        {selectedNode && (
          <Box mt={1}>
            <Divider sx={{ mb: 1 }} />
            <Typography variant="subtitle2" fontWeight={700}>
              Nodo seleccionado
            </Typography>
            <Typography variant="body2">{selectedNode.name}</Typography>
            <Button
              size="small"
              sx={{ mt: 0.5 }}
              onClick={() => setSelectedNode(null)}
            >
              Deseleccionar
            </Button>
          </Box>
        )}
      </Paper>

      {/* Graph area */}
      <Box flex={1} position="relative">
        {loading && (
          <Box
            position="absolute"
            top="50%"
            left="50%"
            sx={{ transform: "translate(-50%, -50%)", zIndex: 10 }}
          >
            <CircularProgress />
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}
        {graphData && !loading && graphData.nodes.length === 0 && (
          <Box position="absolute" top="50%" left="50%" sx={{ transform: "translate(-50%,-50%)" }}>
            <Typography color="text.secondary">Ningún nodo coincide con los filtros actuales.</Typography>
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
