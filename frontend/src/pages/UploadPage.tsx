import { useCallback, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Container,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { useNavigate, useSearchParams } from "react-router-dom";
import { datasetsApi } from "../api/client";
import type { CsvPreview } from "../types";

const STEPS = ["Subir CSV", "Configurar columnas", "Importar"];

export default function UploadPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const datasetId = params.get("dataset_id") ?? "";
  const datasetName = params.get("dataset_name") ?? "Dataset";

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [sourceCol, setSourceCol] = useState("");
  const [targetCol, setTargetCol] = useState("");
  const [relationCol, setRelationCol] = useState("");
  const [weightCol, setWeightCol] = useState("");

  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ imported: number; total: number } | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const dropRef = useRef<HTMLDivElement>(null);

  const handleFileChange = async (f: File) => {
    setFile(f);
    setPreviewError(null);
    setPreview(null);
    setLoadingPreview(true);
    try {
      const data = await datasetsApi.preview(f);
      setPreview(data);
      // Auto-select columns by common names
      const cols = data.columns;
      const find = (...names: string[]) =>
        cols.find((c) => names.includes(c.toLowerCase())) ?? "";
      setSourceCol(find("source", "src", "from", "origin"));
      setTargetCol(find("target", "dst", "dest", "to", "destination"));
      setRelationCol(find("relation", "type", "rel", "relationship", "edge"));
      setWeightCol(find("weight", "w", "value", "cost"));
      setStep(1);
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : "Error al leer el CSV");
    } finally {
      setLoadingPreview(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFileChange(f);
  }, []);

  const handleImport = async () => {
    if (!file || !datasetId) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    setStep(2);
    try {
      const result = await datasetsApi.importCsv(
        datasetId,
        file,
        { source_col: sourceCol, target_col: targetCol, relation_col: relationCol, weight_col: weightCol || undefined },
        (p) => setImportProgress(p)
      );
      setImportResult(result);
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : "Error en la importación");
    } finally {
      setImporting(false);
    }
  };

  const columns = preview?.columns ?? [];

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/")} sx={{ mb: 2 }}>
        Volver a Datasets
      </Button>
      <Typography variant="h5" fontWeight={700} mb={3}>
        Importar CSV → <em>{datasetName}</em>
      </Typography>

      <Stepper activeStep={step} sx={{ mb: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* Step 0: Upload */}
      {step === 0 && (
        <Box>
          <Paper
            ref={dropRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            variant="outlined"
            sx={{
              p: 6,
              textAlign: "center",
              cursor: "pointer",
              borderStyle: "dashed",
              borderColor: "primary.main",
              "&:hover": { bgcolor: "action.hover" },
            }}
            onClick={() => document.getElementById("csv-input")?.click()}
          >
            <UploadFileIcon sx={{ fontSize: 56, color: "primary.main", mb: 1 }} />
            <Typography variant="h6">Arrastrá y soltá un archivo CSV acá</Typography>
            <Typography color="text.secondary">o hacé clic para buscar (máx. 50 MB)</Typography>
            <input
              id="csv-input"
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileChange(f);
              }}
            />
          </Paper>
          {loadingPreview && <LinearProgress sx={{ mt: 2 }} />}
          {previewError && <Alert severity="error" sx={{ mt: 2 }}>{previewError}</Alert>}
        </Box>
      )}

      {/* Step 1: Configure */}
      {step >= 1 && preview && (
        <Box>
          <Typography variant="subtitle1" fontWeight={600} mb={1}>
            Vista previa — {preview.total_rows} filas detectadas
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 3, maxHeight: 220 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {preview.columns.map((col) => (
                    <TableCell key={col}>{col}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.preview.map((row, i) => (
                  <TableRow key={i}>
                    {preview.columns.map((col) => (
                      <TableCell key={col}>{row[col]}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Typography variant="subtitle1" fontWeight={600} mb={2}>
            Mapeo de columnas
          </Typography>
          <Box display="grid" gridTemplateColumns="1fr 1fr" gap={2} mb={3}>
            {[
              { label: "Nodo origen *", value: sourceCol, setter: setSourceCol },
              { label: "Nodo destino *", value: targetCol, setter: setTargetCol },
              { label: "Tipo de relación *", value: relationCol, setter: setRelationCol },
              { label: "Peso (opcional)", value: weightCol, setter: setWeightCol },
            ].map(({ label, value, setter }) => (
              <FormControl key={label} size="small">
                <InputLabel>{label}</InputLabel>
                <Select
                  value={value}
                  label={label}
                  onChange={(e) => setter(e.target.value)}
                >
                  {!label.includes("*") && <MenuItem value="">(ninguno)</MenuItem>}
                  {columns.map((c) => (
                    <MenuItem key={c} value={c}>
                      {c}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ))}
          </Box>

          {step < 2 && (
            <Button
              variant="contained"
              size="large"
              disabled={!sourceCol || !targetCol || !relationCol}
              onClick={handleImport}
            >
              Importar en Neo4j
            </Button>
          )}
        </Box>
      )}

      {/* Step 2: Import progress */}
      {step === 2 && (
        <Box mt={2}>
          {importing && importProgress && (
            <Box>
              <Typography mb={1}>
                Importando… {importProgress.imported} / {importProgress.total} filas
              </Typography>
              <LinearProgress
                variant="determinate"
                value={(importProgress.imported / importProgress.total) * 100}
              />
            </Box>
          )}
          {importing && !importProgress && <LinearProgress />}
          {importError && <Alert severity="error">{importError}</Alert>}
          {importResult && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Importación completa — {importResult.imported} filas importadas
              {importResult.skipped > 0 && `, ${importResult.skipped} omitidas`}.
            </Alert>
          )}
          {importResult && (
            <Button
              variant="contained"
              onClick={() => navigate(`/datasets/${datasetId}/graph`)}
            >
              Ver grafo
            </Button>
          )}
        </Box>
      )}
    </Container>
  );
}
