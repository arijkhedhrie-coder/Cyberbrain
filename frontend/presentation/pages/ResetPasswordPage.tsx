import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams();
  const initialEmail = searchParams.get("email") || "";
  const navigate = useNavigate();

  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setEmail(initialEmail);
  }, [initialEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setMessage({ type: "error", text: "Veuillez renseigner votre adresse email." });
      return;
    }
    if (!otp.trim()) {
      setMessage({ type: "error", text: "Veuillez saisir le code OTP reçu par email." });
      return;
    }
    if (!password || password !== confirm) {
      setMessage({ type: "error", text: "Les mots de passe ne correspondent pas." });
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/auth/reset-password`, {
        email: email.trim(),
        otp: otp.trim(),
        new_password: password,
      });
      setMessage({ type: "success", text: "Code validé. Mot de passe réinitialisé. Redirection vers la connexion..." });
      setTimeout(() => navigate("/login"), 3000);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      setMessage({
        type: "error",
        text: detail || "Code OTP invalide ou expiré. Veuillez refaire une demande.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={{ color: "#00d4ff" }}>🔐 Vérification OTP</h2>
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            type="email"
            placeholder="Adresse email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={styles.input}
          />
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            placeholder="Code OTP à 6 chiffres"
            value={otp}
            onChange={e => setOtp(e.target.value)}
            required
            style={styles.input}
          />
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
            {loading ? "Vérification…" : "Vérifier et réinitialiser"}
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
