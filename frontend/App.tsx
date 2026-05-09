import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./application/state/context/AuthContext";
import { ProtectedRoute } from "./presentation/components/ProtectedRoute";
import { LoginPage } from "./presentation/pages/LoginPage";
import { DashboardPage } from "./presentation/pages/DashboardPage";
import { ForgotPasswordPage } from "./presentation/pages/ForgotPasswordPage";
import "./shared/style/Global.css";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
export default App;