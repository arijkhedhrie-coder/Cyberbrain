// src/hooks/useServers.ts
import { useState, useEffect, useCallback } from "react";
import { fetchServers } from "../api/dashboardApi";

export function useServers() {
  const [servers, setServers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await fetchServers();

      // éviter re-render inutile si pas de changement
      setServers(prev =>
        JSON.stringify(prev) !== JSON.stringify(list) ? list : prev
      );
    } catch (err) {
      console.error("fetchServers error:", err);
    } finally {
      setLoading(false); // toujours désactiver loading après 1er appel
    }
  }, []);

  useEffect(() => {
    // chargement initial
    refresh();

    // auto-refresh toutes les 10s
    const id = setInterval(refresh, 10_000);

    return () => clearInterval(id);
  }, [refresh]);

  return {
    servers,
    loading,
    refresh,
    isEmpty: !loading && servers.length === 0, // 🔥 utile pour UI
  };
}