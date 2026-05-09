import { Navigate } from "react-router-dom";
import { useAuth } from "../../infrastructure/auth/useAuth";

import type { ReactNode } from "react";

export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
};