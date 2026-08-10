import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import DatasetListPage from "./pages/DatasetListPage";
import UploadPage from "./pages/UploadPage";
import GraphPage from "./pages/GraphPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DatasetListPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/datasets/:id/graph" element={<GraphPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
