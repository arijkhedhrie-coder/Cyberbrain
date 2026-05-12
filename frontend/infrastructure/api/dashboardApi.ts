import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export interface LiveMetrics {
  tentatives_ssh: number;
  connexions_ok: number;
  invalid_user: number;
  tentatives_root: number;
  sudo_cmds: number;
  erreurs_sys: number;
  warnings_sys: number;
  erreurs_kernel: number;
  source: "reel" | "simulation";
}

export interface Alert {
  timestamp: string;
  type: string;
  ip: string;
  severite: "CRITIQUE" | "AVERTISSEMENT" | "NORMAL";
  action: string;
  score: number;
  message: string;
  domain: string;
  server_id: string;
}

export interface DashboardStats {
  overall_score: number;
  status: "CRITIQUE" | "AVERTISSEMENT" | "NORMAL";
  layer_scores: {
    post_breach: number;
    privilege_escalation: number;
    root_abuse: number;
    behavioral_deviation: number;
    combined_risk: number;
  };
  alarms: Alert[];
  total_events: number;
}

export const fetchServers = async (): Promise<string[]> => {
  try {
    const res = await axios.get(`${API_BASE}/api/servers`, { timeout: 3000 });
    const data = res.data;
    // ✅ Retourne les vrais serveurs ou tableau vide — jamais de fake
    if (Array.isArray(data) && data.length > 0) return data;
    return [];  // backend OK mais aucun serveur encore détecté
  } catch (err) {
    console.error("[fetchServers] backend indisponible:", err);
    return [];  //  tableau vide — l'UI affichera un message explicite
  }
};

export const EMPTY_LIVE_METRICS: LiveMetrics = {
  tentatives_ssh: 0,
  connexions_ok: 0,
  invalid_user: 0,
  tentatives_root: 0,
  sudo_cmds: 0,
  erreurs_sys: 0,
  warnings_sys: 0,
  erreurs_kernel: 0,
  source: "simulation",
};

export const EMPTY_DASHBOARD_STATS: DashboardStats = {
  overall_score: 0,
  status: "NORMAL",
  layer_scores: {
    post_breach: 0,
    privilege_escalation: 0,
    root_abuse: 0,
    behavioral_deviation: 0,
    combined_risk: 0,
  },
  alarms: [],
  total_events: 0,
};

// ── Appels API réels (avec fallback sur structures vides) ─────────────────
export const fetchLiveMetrics = async (): Promise<LiveMetrics> => {
  try {
    const res = await axios.get(`${API_BASE}/live`, { timeout: 2000 });
    return res.data;
  } catch (err) {
    console.error("[fetchLiveMetrics] backend indisponible:", err);
    return EMPTY_LIVE_METRICS;
  }
};

export const fetchDashboardStats = async (
  token: string,
): Promise<DashboardStats> => {
  try {
    const res = await axios.get(`${API_BASE}/dashboard/stats`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 3000,
    });
    return res.data;
  } catch (err) {
    console.error("[fetchDashboardStats] erreur:", err);
    return EMPTY_DASHBOARD_STATS;
  }
};