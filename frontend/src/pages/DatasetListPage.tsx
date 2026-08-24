import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import BubbleChartIcon from "@mui/icons-material/BubbleChart";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import StorageIcon from "@mui/icons-material/Storage";
import { useNavigate } from "react-router-dom";
import { datasetsApi } from "../api/client";
import type { Dataset } from "../types";

export default function DatasetListPage() {
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    datasetsApi
      .list()
      .then(setDatasets)
      .catch(() => setError("Error al cargar los datasets"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const ds = await datasetsApi.create(newName.trim());
      setCreateOpen(false);
      setNewName("");
      navigate(`/upload?dataset_id=${ds.id}&dataset_name=${encodeURIComponent(ds.name)}`);
    } catch {
      setError("Error al crear el dataset");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await datasetsApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      load();
    } catch {
      setError("Error al eliminar el dataset");
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box display="flex" alignItems="center" gap={1}>
          <BubbleChartIcon sx={{ fontSize: 36, color: "primary.main" }} />
          <Typography variant="h4" fontWeight={700}>
            Edipo Viz
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
        >
          Nuevo Dataset
        </Button>
      </Box>

      {error && (
        <Typography color="error" mb={2}>
          {error}
        </Typography>
      )}

      {loading ? (
        <Typography color="text.secondary">Cargando…</Typography>
      ) : datasets.length === 0 ? (
        <Box textAlign="center" mt={8}>
          <UploadFileIcon sx={{ fontSize: 64, color: "text.disabled" }} />
          <Typography color="text.secondary" mt={1}>
            Todavía no hay datasets. Creá uno para empezar.
          </Typography>
        </Box>
      ) : (
        <Box display="flex" flexDirection="column" gap={2}>
          {datasets.map((ds) => (
            <Card key={ds.id} variant="outlined">
              <CardContent sx={{ pb: 1 }}>
                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                  <Typography variant="h6" fontWeight={600}>
                    {ds.name}
                  </Typography>
                  {ds.system && (
                    <Chip
                      icon={<StorageIcon />}
                      label="Sistema"
                      size="small"
                      color="primary"
                      variant="filled"
                    />
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {new Date(ds.created_at).toLocaleString()}
                </Typography>
                <Box mt={1} display="flex" gap={1}>
                  <Chip label={`${ds.node_count} nodos`} size="small" color="primary" variant="outlined" />
                  <Chip label={`${ds.edge_count} aristas`} size="small" color="secondary" variant="outlined" />
                </Box>
              </CardContent>
              <Divider />
              <CardActions sx={{ justifyContent: "space-between" }}>
                <Box display="flex" gap={1}>
                  <Button
                    size="small"
                    startIcon={<BubbleChartIcon />}
                    onClick={() => navigate(`/datasets/${ds.id}/graph`)}
                  >
                    Visualizar
                  </Button>
                  {!ds.system && (
                    <Button
                      size="small"
                      startIcon={<UploadFileIcon />}
                      onClick={() =>
                        navigate(
                          `/upload?dataset_id=${ds.id}&dataset_name=${encodeURIComponent(ds.name)}`
                        )
                      }
                    >
                      Importar más
                    </Button>
                  )}
                </Box>
                {!ds.system && (
                  <Tooltip title="Eliminar dataset">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => setDeleteTarget(ds)}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                )}
              </CardActions>
            </Card>
          ))}
        </Box>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Nuevo Dataset</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Nombre del dataset"
            fullWidth
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancelar</Button>
          <Button onClick={handleCreate} variant="contained" disabled={creating || !newName.trim()}>
            {creating ? "Creando…" : "Crear e importar"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm delete */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>¿Eliminar "{deleteTarget?.name}"?</DialogTitle>
        <DialogContent>
          <Typography>
            Se eliminarán permanentemente todos los nodos y aristas de este dataset.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button onClick={handleDelete} color="error" variant="contained">
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
