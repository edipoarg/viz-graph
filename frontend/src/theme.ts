import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#7c4dff" },
    secondary: { main: "#03dac6" },
    background: { default: "#121212", paper: "#1e1e2e" },
  },
  shape: { borderRadius: 10 },
  typography: { fontFamily: "'Inter', 'Roboto', sans-serif" },
});

export default theme;
