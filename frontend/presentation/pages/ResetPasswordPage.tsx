import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || password !== confirm) {
      setMessage({ type: "error", text: "Les mots de passe ne correspondent pas." });
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/auth/reset-password`, {
        token,
        new_password: password,
      });
      setMessage({ type: "success", text: "Mot de passe réinitialisé. Redirection vers la connexion..." });
      setTimeout(() => navigate("/login"), 3000);
    } catch {
      setMessage({ type: "error", text: "Token invalide ou expiré. Veuillez refaire une demande." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={{ color: "#00d4ff" }}>🔐 Nouveau mot de passe</h2>
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            type="password"
            placeholder="Nouveau mot de passe"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={styles.input}
          />
          <input
            type="password"
            placeholder="Confirmer le mot de passe"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            style={styles.input}
          />
          {message && (
            <div style={{ color: message.type === "success" ? "#22c55e" : "#ef4444", fontSize: 14, marginBottom: 10 }}>
              {message.text}
            </div>
          )}
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? "Réinitialisation…" : "Réinitialiser le mot de passe"}
          </button>
        </form>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex", justifyContent: "center", alignItems: "center",
    height: "100vh", background: "#0a0e1a",
  },
  card: {
    background: "#111827", padding: "32px", borderRadius: 12,
    border: "1px solid #1e293b", width: 400, textAlign: "center",
  },
  form: { display: "flex", flexDirection: "column", gap: 16 },
  input: {
    padding: "10px", borderRadius: 6, background: "#1e293b",
    border: "1px solid #334155", color: "#e2e8f0", fontSize: 14,
    outline: "none",
  },
  button: {
    padding: "10px", borderRadius: 6, background: "#00d4ff", border: "none",
    color: "#0a0e1a", fontWeight: 700, fontSize: 14, cursor: "pointer",
  },
};