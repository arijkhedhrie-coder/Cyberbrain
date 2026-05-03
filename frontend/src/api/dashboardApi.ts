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

// ── 🔥 NOUVEAU : fetch liste serveurs dynamique ─────────────
export const fetchServers = async (): Promise<string[]> => {
  try {
    const res = await axios.get(`${API_BASE}/api/servers`, { timeout: 3000 });
    const data = res.data;
    if (Array.isArray(data) && data.length > 0) return data;
    return ["server1"]; // fallback minimal
  } catch {
    // Si backend absent → on retourne un serveur par défaut
    return ["server1"];
  }
};

// ── Mock data dynamique (s'adapte aux serveurs réels) ───────
export const getMockLiveMetrics = (): LiveMetrics => ({
  tentatives_ssh: Math.floor(Math.random() * 40 + 120),
  connexions_ok: Math.floor(Math.random() * 10 + 8),
  invalid_user: Math.floor(Math.random() * 20 + 30),
  tentatives_root: Math.floor(Math.random() * 15 + 5),
  sudo_cmds: Math.floor(Math.random() * 8 + 2),
  erreurs_sys: Math.floor(Math.random() * 5 + 1),
  warnings_sys: Math.floor(Math.random() * 12 + 4),
  erreurs_kernel: Math.floor(Math.random() * 3),
  source: "simulation",
});

// 🔥 getMockStats accepte une liste de serveurs dynamique
export const getMockStats = (servers: string[] = ["server1"]): DashboardStats => {
  const alarmTypes = [
    { type: "BRUTE_FORCE_SSH",     domain: "SSH",     severite: "CRITIQUE" as const,      action: "BLOCK_24H",      score: 91.2, message: "🔴 BRUTE FORCE SSH | 143 tentatives" },
    { type: "PRIVILEGE_ESCALATION",domain: "SESSION",  severite: "CRITIQUE" as const,      action: "BLOCK_24H",      score: 76.5, message: "🟠 PRIVILEGE ESCALATION | sudo su" },
    { type: "BEHAVIORAL_ANOMALY",  domain: "SESSION",  severite: "AVERTISSEMENT" as const, action: "WATCHLIST_30MIN", score: 48.3, message: "🟡 BEHAVIORAL ANOMALY | 2 users" },
    { type: "PORT_SCAN",           domain: "NETWORK",  severite: "AVERTISSEMENT" as const, action: "WATCHLIST_30MIN", score: 39.1, message: "🟡 PORT SCAN NMAP | 256 ports" },
    { type: "FTP_EXFIL",           domain: "FTP",      severite: "CRITIQUE" as const,      action: "BLOCK_NOW",       score: 88.0, message: "🔴 FTP DATA EXFIL | anomalous transfer" },
    { type: "KERNEL_SPIKE",        domain: "KERNEL",   severite: "AVERTISSEMENT" as const, action: "MONITOR",         score: 55.0, message: "🟡 KERNEL ERROR SPIKE | instability" },
  ];

  const ips = ["192.168.1.45", "10.0.0.12", "172.16.0.5", "192.168.2.100", "10.10.0.55"];

  // Génère une alarme par serveur (+ quelques extra si > 1 serveur)
  const alarms: Alert[] = servers.flatMap((server_id, i) => {
    const base = alarmTypes[i % alarmTypes.length];
    return [{
      timestamp: new Date(Date.now() - i * 120000).toISOString(),
      type:      base.type,
      ip:        ips[i % ips.length],
      severite:  base.severite,
      action:    base.action,
      score:     base.score,
      message:   `${base.message} | ${server_id}`,
      domain:    base.domain,
      server_id,           // 🔥 server_id = nom réel du serveur
    }];
  });

  return {
    overall_score: 72.4,
    status: "CRITIQUE",
    layer_scores: {
      post_breach: 85,
      privilege_escalation: 62,
      root_abuse: 40,
      behavioral_deviation: 55,
      combined_risk: 78,
    },
    alarms,
    total_events: 1847,
  };
};

// ── Appels API réels (avec fallback mock) ──────────────────
export const fetchLiveMetrics = async (): Promise<LiveMetrics> => {
  try {
    const res = await axios.get(`${API_BASE}/live`, { timeout: 2000 });
    return res.data;
  } catch {
    return getMockLiveMetrics();
  }
};

export const fetchDashboardStats = async (
  token: string,
  servers?: string[]
): Promise<DashboardStats> => {
  try {
    const res = await axios.get(`${API_BASE}/dashboard/stats`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 3000,
    });
    return res.data;
  } catch {
    // 🔥 fallback mock dynamique — utilise les vrais serveurs si dispo
    const knownServers = servers && servers.length > 0 ? servers : ["server1"];
    return getMockStats(knownServers);
  }
};