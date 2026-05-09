import { useContext } from "react";
import { AuthContext, type AuthContextType } from "../../application/state/context/AuthContext";

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};