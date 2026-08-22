import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Box,
  Button,
  Container,
  TextField,
  Typography,
  Alert,
} from "@mui/material";
import BubbleChartIcon from "@mui/icons-material/BubbleChart";
import { setCredentials } from "../api/auth";
import { datasetsApi } from "../api/client";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string })?.from ?? "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setCredentials(username, password);
    try {
      await datasetsApi.list();
      navigate(from, { replace: true });
    } catch (err: unknown) {
      setCredentials("", "");
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 401) {
        setError("Usuario o contraseña incorrectos");
      } else if (status === 500 || status == null) {
        setError("Error del servidor. Verificá que el backend y Neo4j estén corriendo.");
      } else {
        setError(`Error inesperado (${status})`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="xs">
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="100vh"
        gap={3}
      >
        <Box display="flex" alignItems="center" gap={1}>
          <BubbleChartIcon sx={{ fontSize: 40, color: "primary.main" }} />
          <Typography variant="h4" fontWeight={700}>
            Edipo Viz 🚀
          </Typography>
        </Box>

        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            width: "100%",
            bgcolor: "background.paper",
            borderRadius: 3,
            p: 4,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <Typography variant="h6" fontWeight={600} textAlign="center">
            Iniciar sesión
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Usuario"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            fullWidth
          />
          <TextField
            label="Contraseña"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            fullWidth
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={loading}
            fullWidth
          >
            {loading ? "Verificando…" : "Entrar"}
          </Button>
        </Box>
      </Box>
    </Container>
  );
}
