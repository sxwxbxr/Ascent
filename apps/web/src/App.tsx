import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { DownloadPage } from "./pages/DownloadPage";
import { ExerciseDetailPage } from "./pages/ExerciseDetailPage";
import { ExercisesPage } from "./pages/ExercisesPage";
import { HistoryPage } from "./pages/HistoryPage";
import { LoginPage } from "./pages/LoginPage";
import { PlanDetailPage } from "./pages/PlanDetailPage";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { PlansPage } from "./pages/PlansPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SettingsPage } from "./pages/SettingsPage";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/" element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="verlauf" element={<HistoryPage />} />
        <Route path="plaene" element={<PlansPage />} />
        {/* /plaene/:planId ist jetzt die Übersicht (Muskel-Karte, siehe PlanDetailPage) —
            der bisherige Übungs-Editor (Reihenfolge/Zielwerte/Hinzufügen/Entfernen) ist
            dafür auf .../bearbeiten gewandert und bleibt über den Header-Link dort erreichbar. */}
        <Route path="plaene/:planId" element={<PlanDetailPage />} />
        <Route path="plaene/:planId/bearbeiten" element={<PlanEditorPage />} />
        <Route path="uebungen" element={<ExercisesPage />} />
        <Route path="uebungen/:id" element={<ExerciseDetailPage />} />
        <Route path="download" element={<DownloadPage />} />
        <Route path="einstellungen" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default App;
