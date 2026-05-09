export type AlarmItem = {
  id: string;
  timestamp: string;
  type: string;
  source_ip: string;
  severity: "CRITICAL" | "HIGH" | "MED" | "LOW" | "INFO";
  engine: string;
  score: number;
  message: string;
  human_insight: string;
  action: "BLOCK_NOW" | "WATCHLIST" | "ESCALATE" | "MONITOR";
  country: string;
  failures: number;
};