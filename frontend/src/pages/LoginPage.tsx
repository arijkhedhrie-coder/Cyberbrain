// src/pages/LoginPage.tsx
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { loginRequest } from "../api/authApi";
import "../style/LoginPage.css";


export const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Cyber grid animation with canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const setCanvasSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    setCanvasSize();
    window.addEventListener("resize", setCanvasSize);

    let time = 0;
    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      alpha: number;
    }> = [];

    // Create particles
    for (let i = 0; i < 100; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 2 + 1,
        alpha: Math.random() * 0.5 + 0.2,
      });
    }

    const animate = () => {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Gradient background
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, "#0a0e1a");
      gradient.addColorStop(0.5, "#0f121f");
      gradient.addColorStop(1, "#0a0e1a");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw grid
      const gridSize = 40;
      ctx.strokeStyle = "rgba(0, 212, 255, 0.08)";
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Draw animated hexagons
      const hexSize = 30;
      const hexWidth = hexSize * Math.sqrt(3);
      const hexHeight = hexSize * 2;
      const cols = Math.ceil(canvas.width / hexWidth) + 2;
      const rows = Math.ceil(canvas.height / hexHeight) + 2;

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = i * hexWidth;
          const y = j * hexHeight + (i % 2) * hexSize;
          const pulse = Math.sin(time * 0.001 + i * 0.2 + j * 0.3) * 0.3 + 0.1;
          
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const angle = (k * 60 - 30) * Math.PI / 180;
            const px = x + hexSize * Math.cos(angle);
            const py = y + hexSize * Math.sin(angle);
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.strokeStyle = `rgba(0, 212, 255, ${0.03 + pulse * 0.05})`;
          ctx.stroke();
        }
      }

      // Draw particles
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 212, 255, ${p.alpha + Math.sin(time * 0.002) * 0.1})`;
        ctx.fill();
      });

      // Draw connecting lines
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 100) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(0, 212, 255, ${0.05 * (1 - distance / 100)})`;
            ctx.stroke();
          }
        }
      }
      ctx.globalCompositeOperation = "source-over";

      time++;
      requestAnimationFrame(animate);
    };

    animate();
    return () => window.removeEventListener("resize", setCanvasSize);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await loginRequest({ username, password });
      login(response.access_token);
      navigate("/dashboard");
    } catch {
      setError("Identifiants invalides. Accès refusé.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <canvas ref={canvasRef} className="cyber-canvas" />
      
      <div className="login-overlay">
        <div className="login-card">
          <div className="card-glow" />
          
          <div className="login-header">
            <div className="logo-wrapper">
              <div className="logo-ring">
                <svg className="logo-icon" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
            <h1>Security<span>Dashboard</span></h1>
            <div className="badge">
              <span className="badge-dot" />
              SOC Access Portal
            </div>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="input-field">
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                placeholder=" "
              />
              <label htmlFor="username">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M20 21V19C20 16.8 18.2 15 16 15H8C5.8 15 4 16.8 4 19V21" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M12 11C14.2091 11 16 9.20914 16 7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7C8 9.20914 9.79086 11 12 11Z" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                Nom d'utilisateur
              </label>
              <div className="input-border" />
            </div>

            <div className="input-field">
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder=" "
              />
              <label htmlFor="password">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M12 15V12M12 18H12.01M5 3H19C20.1 3 21 3.9 21 5V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V5C3 3.9 3.9 3 5 3Z" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                Mot de passe
              </label>
              <div className="input-border" />
            </div>
<div className="forgot-password">
  <button
    type="button"
    onClick={() => navigate("/forgot-password")}
    className="forgot-link"
  >
    Mot de passe oublié ?
  </button>
</div>
            {error && (
              <div className="error-message">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M12 8V12M12 16H12.01M3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12Z" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                {error}
              </div>
            )}

            <button type="submit" className="login-button" disabled={loading}>
              <span className="button-text">
                {loading ? (
                  <>
                    <svg className="spinner" viewBox="0 0 50 50">
                      <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
                    </svg>
                    Authentification
                  </>
                ) : (
                  "Accéder au Dashboard"
                )}
              </span>
              {!loading && (
                <svg className="button-icon" viewBox="0 0 24 24" fill="none">
                  <path d="M13 7L18 12M18 12L13 17M18 12H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              )}
            </button>
          </form>

          <div className="login-footer">
            <div className="security-badges">
              <span>🔐 JWT Encrypted</span>
              <span>🛡️ XSS Protected</span>
              <span>⚡ TLS 1.3</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
