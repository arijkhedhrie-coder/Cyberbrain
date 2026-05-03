// src/types/idps.ts
// ═══════════════════════════════════════════════════════════════════════════════
// SOURCE UNIQUE DE VÉRITÉ — tous les types du projet viennent d'ici.
//
// Synchronisé champ par champ avec les fonctions backend :
//   _build_kpis()          → KpiData
//   _build_alarms()        → AlarmItem
//   _build_engine_scores() → EngineScore
//   _build_decisions()     → AgentDecision
//   sessions endpoint      → SessionSummary
//   _build_trust()         → TrustData
//   pipeline/latest        → PipelineLatest
//   /health FastAPI        → HealthCheck
//   /ws/logs WebSocket     → WsIncomingMessage

// ═══════════════════════════════════════════════════════════════════════════════


// ─── /api/kpis  (_build_kpis) ────────────────────────────────────────────────
export type KpiData = {
  available:            boolean;
  missing_data:         string[];
  health_score:         number | null;
  ssh_failures:         number | null;
  blocked_ips:          number | null;
  alert_status:         string | null;
  attack_pattern:       string | null;
  ip_entropy:           number | null;
  unique_attacking_ips: number | null;
  attack_velocity:      number | null;
  is_velocity_spike:    boolean;
  night_ratio:          number | null;
  row_count:            number | null;
  server_count:         number | null;
  data_sources:         string[];
  deduped_count:        number | null;
  noise_ratio:          number | null;
  data_quality:         string | null;
  notes?:               Record<string, string>;
};


// ─── /api/alarms  (_build_alarms + _normalize_alarm) ─────────────────────────
// _SEV_MAP :  CRITIQUE→CRITICAL, AVERTISSEMENT→HIGH, AVERTISSEMENT_MOYEN→MED
// _ACTION_MAP: BLOCK_24H/PREEMPTIVE_BLOCK→BLOCK_NOW, WATCHLIST_30MIN→WATCHLIST
export type AlarmSeverity = "CRITICAL" | "HIGH" | "MED" | "LOW" | "INFO";
export type AlarmAction   = "BLOCK_NOW" | "WATCHLIST" | "ESCALATE" | "MONITOR";

export type AlarmItem = {
  id:            string;
  timestamp:     string;        // "HH:MM:SS"
  type:          string;
  source_ip:     string;
  severity:      AlarmSeverity;
  engine:        string;        // "SSH"|"WEB"|"FTP"|"SESSION"|"KERNEL"|"PREDICTION"|"CORRELATION"|"CHAIN"
  score:         number;
  message:       string;
  human_insight: string;        // toujours présent — généré via _HUMAN_INSIGHTS
  action:        AlarmAction;
  country:       string;
  failures:      number;
};


// ─── /api/engine-scores  (_build_engine_scores) ───────────────────────────────
// status = "ALARM" si alarms > 0, sinon "CLEAR"
export type EngineScore = {
  engine:   string;             // "SSH"|"WEB"|"FTP"|"SESSION"|"KERNEL"|"PREDICTION"
  score:    number;             // = alarm_count
  pass1:    number;             // seuil Pass 1
  pass2:    number;             // seuil Pass 2
  alarms:   number;             // = alarm_count
  status:   "ALARM" | "CLEAR";
  rerun_p2: boolean;
};


// ─── /api/decisions  (_build_decisions) ───────────────────────────────────────
export type AgentDecision = {
  id:         string;
  ts:         string;           // "HH:MM:SS"
  agent:      string;           // "Orchestrateur"|"Rapporteur"|"Détecteur"|"Collecteur"
  action:     string;
  threat:     string;           // "NORMAL"|"ELEVATED"|"CRITICAL"
  confidence: number;           // 0.0–1.0
  severity:   string;
  reasoning:  string;
  targets:    string[];
  config:     Record<string, unknown> | null;
  approved:   boolean | null;
  feedback:   string;
};


// ─── /api/sessions ───────────────────────────────────────────────────────────
export type SessionSummary = {
  date:            string;
  threat_level:    string;
  nb_alarms_pass1: number;
  nb_alarms_final: number;
  pass2_ran:       boolean;
  health_score:    number | null;
  ips_suspectes:   string[];
  attack_pattern:  string;
};


// ─── /api/trust  (_build_trust) ───────────────────────────────────────────────
export type TrustData = {
  available:             boolean;
  model_agreement:       number | null;
  false_positive_rate:   number | null;
  drift_score:           number | null;
  drift_label:           string;
  drift_flagged:         boolean;
  stability:             string;
  confidence_in_metrics: number | null;
  confidence_label:      string;
  signals_summary:       string;
  stable_signals?:       number | null;
  noise_ratio?:          number | null;
  ml_score_weight?:      number | null;
  timestamp?:            string;
};


// ─── /api/pipeline/latest ────────────────────────────────────────────────────
export type PipelineLatest = {
  events:     Record<string, unknown>[];
  log_lines:  string[];
  step_count: number;
};


// ─── /health  (FastAPI api_auth.py) ──────────────────────────────────────────
export type HealthCheck = {
  status:                string;
  ws_clients?:           number;
  ws_endpoint?:          string;
  version?:              string;
  timestamp?:            string;
  memory_file_exists?:   boolean;
  output_dir_exists?:    boolean;
  latest_session_file?:  string | null;
};


// ─── WebSocket  ws://localhost:8000/ws/logs ───────────────────────────────────
export type WsAlarmMessage = {
  type:     "alarm";
  alarm:    AlarmItem;
  version?: number;
};

export type WsLogMessage = {
  type: "log";
  line: string;
};

export type WsMetricsMessage = {
  type: "metrics";
  data: Partial<KpiData>;
};

export type WsPongMessage = { type: "pong" };
export type WsHeartbeat   = { type: "heartbeat" };
export type WsFilterAck   = { type: "filter_ack" };

export type WsIncomingMessage =
  | WsAlarmMessage
  | WsLogMessage
  | WsMetricsMessage
  | WsPongMessage
  | WsHeartbeat
  | WsFilterAck;

export type IdpsWsCallbacks = {
  onAlarm?:      (alarm: AlarmItem) => void;
  onLog?:        (line: string) => void;
  onMetrics?:    (data: Partial<KpiData>) => void;
  onConnect?:    () => void;
  onDisconnect?: () => void;
};

// Helpers de narrowing — utilisés dans useIdpsDashboard.ts
export const isAlarmMsg   = (m: WsIncomingMessage): m is WsAlarmMessage   => m.type === "alarm";
export const isLogMsg     = (m: WsIncomingMessage): m is WsLogMessage     => m.type === "log";
export const isMetricsMsg = (m: WsIncomingMessage): m is WsMetricsMessage => m.type === "metrics";