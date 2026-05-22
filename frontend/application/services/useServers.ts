// src/hooks/useServers.ts


import { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Type serveur riche ────────────────────────────────────────────────────────
export interface ServerInfo {
  id:      string;
  label:   string;
  display: string;
  sources: string[];
}

// ── Fallback si backend hors ligne ───────────────────────────────────────────
// NE PAS utiliser de fallback statique ["auth","web","ftp","kernel"] ici
// car ça masquerait les vrais problèmes (FIX-1)
const EMPTY: ServerInfo[] = [];

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useServers() {
  const [servers,  setServers]  = useState<ServerInfo[]>(EMPTY);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      console.log("[useServers] fetching datasets from:", `${API_BASE}/api/datasets?format=rich`);
      const res = await fetch(`${API_BASE}/api/datasets?format=rich`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
        },
      });

      console.log("[useServers] response status:", res.status);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      
      const data: ServerInfo[] = await res.json();
      console.log("[useServers] datasets received:", data);

      // ✅ [FIX-1] Si backend retourne [] → on expose la vraie situation
      // Pas de fallback statique qui masquerait le problème
      setServers(prev => {
        const next = Array.isArray(data) ? data : [];
        return JSON.stringify(prev) !== JSON.stringify(next) ? next : prev;
      });
      setError(null);
    } catch (err) {
      console.error("[useServers] fetchServers error:", err);
      setError(String(err));
      // ✅ En cas d'erreur réseau, on garde les serveurs précédents (si existants)
      // On ne remet PAS à [] pour éviter de perdre l'état UI
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000); // refresh toutes les 15s
    return () => clearInterval(id);
  }, [refresh]);

  return {
    servers,                                          // ServerInfo[] complet
    serverLabels: servers.map(s => s.label),         // string[] pour le filtrage API
    serverIds:    servers.map(s => s.id),            // string[] IDs S3 bruts (rétrocompat)
    loading,
    error,
    refresh,
    isEmpty: !loading && servers.length === 0,
  };
}

