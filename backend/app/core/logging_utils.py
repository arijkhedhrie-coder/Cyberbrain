"""
src/logging_utils.py — Structured JSON session logger
═══════════════════════════════════════════════════════════════════
Replaces scattered print() calls in main.py with structured,
machine-readable JSON-Lines (JSONL) output.

Every key pipeline event emits one JSON object per line to:
  • stdout   (human-readable with a prefix tag so grep still works)
  • output/session_{timestamp}.jsonl  (append-only, one record / line)

The JSONL file is the primary artefact for the thesis results section:
  - Load with pandas: pd.read_json("output/session_*.jsonl", lines=True)
  - Dashboard in Streamlit: read, filter by event_type, plot alarm_count
  - Reproducibility: each run produces its own dated file

Event types emitted
───────────────────
  PIPELINE_START         — session opened, row counts
  METRICS_COMPUTED       — health score, entropy, alert status
  PASS1_COMPLETE         — alarm count, top-5 alarm messages
  DYNAMIC_CONFIG_ISSUED  — agent reasoning excerpt, threshold overrides
  DYNAMIC_CONFIG_DEFAULT — agent issued no overrides
  PASS2_COMPLETE         — alarm delta vs pass 1, engines re-run
  AGENTS_COMPLETE        — crew result excerpt
  SESSION_SUMMARY        — final counts, full threshold audit trail
  WARNING                — non-fatal errors (agent timeout, etc.)
  ERROR                  — fatal errors (written before re-raise)
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from app.core.event_store import append_event

try:
    from app.core.websocket_broadcast import broadcast_activity as _broadcast_activity
except Exception:
    def _broadcast_activity(data: dict) -> None:
        return


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _safe(val: Any, max_len: int = 300) -> Any:
    """Make a value JSON-serialisable; truncate long strings."""
    if val is None:
        return None
    if isinstance(val, (bool, int, float)):
        return val
    if isinstance(val, (list, dict)):
        try:
            # Validate serializability; fall back to repr if it fails
            json.dumps(val, ensure_ascii=False)
            return val
        except (TypeError, ValueError):
            return str(val)[:max_len]
    text = str(val)
    return text[:max_len] + ("…" if len(text) > max_len else "")


def _safe_console_print(message: str, *, stream: Any = None) -> None:
    target = stream or sys.stdout
    encoding = getattr(target, "encoding", None) or "utf-8"
    text = str(message)
    try:
        print(text, file=target)
    except UnicodeEncodeError:
        sanitized = text.encode(encoding, errors="replace").decode(encoding, errors="replace")
        print(sanitized, file=target)


def _threshold_row(snap: dict) -> dict:
    """Return a compact, flat dict of the thresholds from one snapshot."""
    return {
        "pass":         snap.get("pass"),
        "issued_by":    snap.get("issued_by"),
        "ssh_high":     snap.get("ssh_high"),
        "ssh_med":      snap.get("ssh_med"),
        "web_high":     snap.get("web_high"),
        "web_med":      snap.get("web_med"),
        "ftp_high":     snap.get("ftp_high"),
        "ftp_med":      snap.get("ftp_med"),
        "kernel_high":  snap.get("kernel_high"),
        "session_high": snap.get("session_high"),
        "session_med":  snap.get("session_med"),
        "corr_window":  snap.get("corr_window"),
        "threat_level": snap.get("threat_level"),
        "confidence":   snap.get("confidence"),
        "escalate_ips": snap.get("escalate_ips", []),
        "suppress_ips": snap.get("suppress_ips", []),
    }


_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_DEFAULT_OUTPUT_DIR = _BACKEND_ROOT / "output"


def _resolve_output_dir(output_dir: str | os.PathLike[str] | None) -> Path:
    if output_dir is None:
        return _DEFAULT_OUTPUT_DIR
    candidate = Path(output_dir)
    if not candidate.is_absolute():
        candidate = _BACKEND_ROOT / candidate
    return candidate


def _activity_id(record: dict[str, Any]) -> str:
    suffix = (
        str(record.get("source") or record.get("status") or record.get("threat_level") or "")
        .replace(" ", "_")
        .replace("/", "_")
    )[:24]
    return f"{record.get('session_id', 'session')}:{record.get('event_type', 'event')}:{record.get('timestamp', '')}:{suffix}"


def _activity_severity_from_threat(threat: str | None) -> str:
    threat_upper = str(threat or "NORMAL").upper()
    if threat_upper == "CRITICAL":
        return "CRITICAL"
    if threat_upper in {"ELEVATED", "HIGH"}:
        return "HIGH"
    return "INFO"


def _dashboard_activity(record: dict[str, Any]) -> dict[str, Any] | None:
    event_type = str(record.get("event_type", ""))
    timestamp = str(record.get("timestamp", ""))
    session_id = str(record.get("session_id", ""))
    dataset_id = str(record.get("dataset_id", ""))

    def activity(
        *,
        stage: str,
        actor: str,
        title: str,
        detail: str,
        status: str,
        severity: str = "INFO",
        progress: int | None = None,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "id": _activity_id(record),
            "timestamp": timestamp,
            "session_id": session_id,
            "dataset_id": dataset_id,
            "event_type": event_type,
            "stage": stage,
            "actor": actor,
            "title": title,
            "detail": detail,
            "status": status,
            "severity": severity,
            "progress": progress,
            "meta": meta or {},
        }
        return payload

    if event_type == "SESSION_INIT":
        return activity(
            stage="session",
            actor="System",
            title="Pipeline session opened",
            detail=str(record.get("note", "Session logger ready.")),
            status="started",
            progress=1,
        )

    if event_type == "PIPELINE_START":
        row_count = int(record.get("row_count") or 0)
        deduped = int(record.get("deduped_count") or row_count)
        server_count = int(record.get("server_count") or 0)
        return activity(
            stage="ingestion",
            actor="Collecteur",
            title="Log ingestion completed",
            detail=f"{row_count} raw lines, {deduped} deduplicated from {server_count} server(s).",
            status="completed",
            progress=12,
            meta={
                "data_sources": record.get("data_sources", []),
                "data_quality": record.get("data_quality"),
                "noise_ratio": record.get("noise_ratio"),
                "ml_score_weight": record.get("ml_score_weight"),
            },
        )

    if event_type == "METRICS_COMPUTED":
        return activity(
            stage="metrics",
            actor="Analyste",
            title="Security metrics computed",
            detail=(
                f"Health {record.get('health_score')}% | "
                f"pattern {record.get('attack_pattern')} | "
                f"entropy {record.get('ip_entropy')} bits."
            ),
            status="completed",
            progress=28,
            meta={
                "alert_status": record.get("alert_status"),
                "unique_attacking_ips": record.get("unique_attacking_ips"),
                "attack_velocity": record.get("attack_velocity"),
                "night_ratio": record.get("night_ratio"),
            },
        )

    if event_type == "PASS1_COMPLETE":
        return activity(
            stage="pass1",
            actor="Détecteur",
            title="Pass 1 detection completed",
            detail=f"{record.get('alarm_count', 0)} alarm(s) identified during primary analysis.",
            status="completed",
            severity="HIGH" if int(record.get("alarm_count", 0) or 0) > 0 else "INFO",
            progress=42,
            meta={
                "alarms_by_domain": record.get("alarms_by_domain", {}),
                "alarms_by_severity": record.get("alarms_by_severity", {}),
                "top5_messages": record.get("top5_messages", []),
            },
        )

    if event_type == "TRUST_COMPUTED":
        return activity(
            stage="trust",
            actor="Trust Gate",
            title="Trust score computed",
            detail=(
                f"Confidence {record.get('confidence_in_metrics')} "
                f"({record.get('confidence_label')}) with stability {record.get('stability')}."
            ),
            status="completed",
            severity="HIGH" if (record.get("drift_flagged") or False) else "INFO",
            progress=50,
            meta={
                "model_agreement": record.get("model_agreement"),
                "false_positive_rate": record.get("false_positive_rate"),
                "drift_score": record.get("drift_score"),
                "drift_label": record.get("drift_label"),
            },
        )

    if event_type == "DYNAMIC_CONFIG_ISSUED":
        threat_level = str(record.get("threat_level", "NORMAL"))
        return activity(
            stage="orchestrator",
            actor="Orchestrateur",
            title="Pass 2 escalation issued",
            detail=str(record.get("reasoning_excerpt") or "Dynamic configuration was issued after Pass 1."),
            status="completed",
            severity=_activity_severity_from_threat(threat_level),
            progress=60,
            meta={
                "threat_level": threat_level,
                "confidence": record.get("confidence"),
                "rerun_engines": record.get("rerun_engines", []),
                "escalate_ips": record.get("escalate_ips", []),
                "suppress_ips": record.get("suppress_ips", []),
            },
        )

    if event_type == "DYNAMIC_CONFIG_DEFAULT":
        return activity(
            stage="orchestrator",
            actor="Orchestrateur",
            title="Pass 2 skipped",
            detail=str(record.get("note") or "No threshold override was required."),
            status="completed",
            progress=60,
        )

    if event_type == "PASS2_COMPLETE":
        delta = int(record.get("alarm_delta") or 0)
        delta_text = f"+{delta}" if delta >= 0 else str(delta)
        return activity(
            stage="pass2",
            actor="Détecteur",
            title="Pass 2 analysis completed",
            detail=f"{record.get('alarm_count', 0)} final alarm(s), delta {delta_text} vs Pass 1.",
            status="completed",
            severity="HIGH" if int(record.get("new_alarm_count", 0) or 0) > 0 else "INFO",
            progress=68,
            meta={
                "engines_rerun": record.get("engines_rerun", []),
                "new_alarm_count": record.get("new_alarm_count"),
                "new_alarm_messages": record.get("new_alarm_messages", []),
            },
        )

    if event_type == "ANALYSIS_CREW_STARTED":
        return activity(
            stage="analysis",
            actor="CrewAI",
            title="Analysis crew started",
            detail="Collector, Analyst, and Detector are reasoning over the latest pipeline state.",
            status="running",
            progress=74,
            meta={
                "agents": record.get("agents", []),
                "nb_anomalies": record.get("nb_anomalies"),
                "ip_principale": record.get("ip_principale"),
            },
        )

    if event_type == "ANALYSIS_CREW_COMPLETED":
        return activity(
            stage="analysis",
            actor="CrewAI",
            title="Analysis crew completed",
            detail=str(record.get("result_excerpt") or "Crew analysis finished."),
            status="completed",
            progress=78,
            meta={"agents": record.get("agents", [])},
        )

    if event_type == "REPORT_CREW_STARTED":
        return activity(
            stage="reporting",
            actor="Rapporteur",
            title="Report generation started",
            detail="Reporter agent is preparing the narrative output for this run.",
            status="running",
            progress=82,
            meta={"agents": record.get("agents", [])},
        )

    if event_type == "REPORT_CREW_COMPLETED":
        return activity(
            stage="reporting",
            actor="Rapporteur",
            title="Report generation completed",
            detail=str(record.get("result_excerpt") or "Reporter output produced."),
            status="completed",
            progress=86,
        )

    if event_type == "CORRECTIVE_TOOL_STARTED":
        return activity(
            stage="corrective",
            actor="Corrective Agent",
            title="Corrective reasoning started",
            detail="Corrective agent is evaluating remediation or escalation actions.",
            status="running",
            progress=90,
            meta={
                "nb_anomalies": record.get("nb_anomalies"),
                "ip_principale": record.get("ip_principale"),
            },
        )

    if event_type == "CORRECTIVE_TOOL_COMPLETED":
        status = str(record.get("status") or "completed").lower()
        severity = "HIGH" if status in {"pending", "blocked"} else "INFO"
        return activity(
            stage="corrective",
            actor="Corrective Agent",
            title=str(record.get("title") or "Corrective decision produced"),
            detail=str(record.get("result_excerpt") or "Corrective agent finished."),
            status=status,
            severity=severity,
            progress=94,
            meta={
                "mode": record.get("mode"),
                "action_type": record.get("action_type"),
                "confidence": record.get("confidence"),
            },
        )

    if event_type == "AGENTS_COMPLETE":
        return activity(
            stage="reporting",
            actor="Rapporteur",
            title="Agent coordination finished",
            detail=str(record.get("result_excerpt") or "All agent outputs were consolidated."),
            status="completed",
            progress=97,
        )

    if event_type == "SESSION_SUMMARY":
        return activity(
            stage="session",
            actor="Pipeline",
            title="Pipeline run completed",
            detail=(
                f"{record.get('alarm_count', 0)} final alarm(s) | "
                f"Pass 2 {'ran' if record.get('pass2_ran') else 'skipped'} | "
                f"elapsed {record.get('elapsed_seconds')}s."
            ),
            status="completed",
            severity=_activity_severity_from_threat(str(record.get("agent_threat_level", "NORMAL"))),
            progress=100,
            meta={
                "agent_threat_level": record.get("agent_threat_level"),
                "health_score": record.get("health_score"),
                "attack_pattern": record.get("attack_pattern"),
                "agent_config_summary": record.get("agent_config_summary"),
            },
        )

    if event_type == "WARNING":
        return activity(
            stage="session",
            actor=str(record.get("source") or "System"),
            title=f"Warning from {record.get('source', 'system')}",
            detail=str(record.get("message") or ""),
            status="warning",
            severity="HIGH",
        )

    if event_type == "ERROR":
        return activity(
            stage="session",
            actor=str(record.get("source") or "System"),
            title=f"Error in {record.get('source', 'system')}",
            detail=str(record.get("error") or ""),
            status="error",
            severity="CRITICAL",
        )

    return None


# ── SessionLogger ──────────────────────────────────────────────────────────────

class SessionLogger:
    """
    Thin structured logger for one pipeline run.

    Usage
    ─────
        from app.cors.logging_utils import SessionLogger
        log = SessionLogger()                      # creates output/ file
        log.pipeline_start(row_count=12000)
        log.pass1_complete(alarmes_pass1)
        ...
        log.session_summary(alarmes_pass1, alarmes_final, threshold_snapshots)
        log.close()

    Each public method both prints a human-readable line to stdout AND
    appends a JSON record to the .jsonl file.
    """

    # Event type constants — use these as the canonical names in dashboards
    EV_PIPELINE_START        = "PIPELINE_START"
    EV_METRICS_COMPUTED      = "METRICS_COMPUTED"
    EV_PASS1_COMPLETE        = "PASS1_COMPLETE"
    EV_DYNAMIC_CONFIG_ISSUED = "DYNAMIC_CONFIG_ISSUED"
    EV_DYNAMIC_CONFIG_DEFAULT= "DYNAMIC_CONFIG_DEFAULT"
    EV_PASS2_COMPLETE        = "PASS2_COMPLETE"
    EV_ANALYSIS_CREW_STARTED = "ANALYSIS_CREW_STARTED"
    EV_ANALYSIS_CREW_COMPLETED = "ANALYSIS_CREW_COMPLETED"
    EV_REPORT_CREW_STARTED   = "REPORT_CREW_STARTED"
    EV_REPORT_CREW_COMPLETED = "REPORT_CREW_COMPLETED"
    EV_CORRECTIVE_TOOL_STARTED = "CORRECTIVE_TOOL_STARTED"
    EV_CORRECTIVE_TOOL_COMPLETED = "CORRECTIVE_TOOL_COMPLETED"
    EV_AGENTS_COMPLETE       = "AGENTS_COMPLETE"
    EV_SESSION_SUMMARY       = "SESSION_SUMMARY"
    EV_TRUST_COMPUTED        = "TRUST_COMPUTED"      # Phase B — performance engine
    EV_SESSION_INIT          = "SESSION_INIT"
    EV_WARNING               = "WARNING"
    EV_ERROR                 = "ERROR"

    def __init__(
        self,
        output_dir: str | os.PathLike[str] | None = None,
        dataset_id: str | None = None,
    ):
        resolved_output_dir = _resolve_output_dir(output_dir)
        os.makedirs(resolved_output_dir, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.session_id   = ts
        self.dataset_id   = dataset_id
        self.output_path  = str(resolved_output_dir / f"session_{ts}.jsonl")
        self._file        = open(self.output_path, "a", encoding="utf-8")
        self._session_start = datetime.now(timezone.utc)
        # Print to stdout so operators see the file path immediately
        _safe_console_print(f"[LOG] Session logger -> {self.output_path}")
        self._emit(self.EV_SESSION_INIT, {
            "status": "logger_created",
            "note": "Session file created before ingestion starts.",
        })

    # ── Core emit ─────────────────────────────────────────────────────────────

    def _emit(self, event_type: str, payload: dict[str, Any]) -> None:
        """Write one JSON line; also echo a compact version to stdout."""
        record = {
            "timestamp":  _now_iso(),
            "session_id": self.session_id,
            "dataset_id": self.dataset_id,
            "event_type": event_type,
            **{k: _safe(v) for k, v in payload.items()},
        }
        dashboard_activity = _dashboard_activity(record)
        if dashboard_activity:
            record["dashboard_activity"] = dashboard_activity
        line = json.dumps(record, ensure_ascii=False)
        self._file.write(line + "\n")
        self._file.flush()
        if dashboard_activity:
            try:
                _broadcast_activity(dashboard_activity)
            except Exception:
                pass

        # Human-readable stdout echo
        alarm_count = payload.get("alarm_count", "")
        alarm_part  = f" | alarms={alarm_count}" if alarm_count != "" else ""
        _safe_console_print(f"[LOG:{event_type}]{alarm_part} -> {self.output_path}")

    # ── Public event methods ──────────────────────────────────────────────────

    def pipeline_start(
        self,
        row_count: int,
        server_count: int = 3,
        data_sources: list[str] | None = None,
        # Phase 0.4 — noise + data quality fields
        deduped_count: int | None = None,
        noise_ratio: float | None = None,
        data_quality: str | None = None,
        ml_score_weight: float | None = None,
    ) -> None:
        unique_pct = round((1.0 - (noise_ratio or 0.0)) * 100, 1)
        _safe_console_print(f"\n{'='*60}\n   HYBRID IDPS PIPELINE - START\n{'='*60}")
        _safe_console_print(
            f"[DATA] raw={row_count} | deduped={deduped_count or row_count} | "
            f"quality={data_quality or 'N/A'} | ml_weight={ml_score_weight or 1.0:.2f}"
        )
        self._emit(self.EV_PIPELINE_START, {
            "row_count":       row_count,
            "server_count":    server_count,
            "data_sources":    data_sources or [],
            "deduped_count":   deduped_count if deduped_count is not None else row_count,
            "noise_ratio":     noise_ratio if noise_ratio is not None else 0.0,
            "unique_pct":      unique_pct,
            "data_quality":    data_quality or "N/A",
            "ml_score_weight": ml_score_weight if ml_score_weight is not None else 1.0,
        })

    def metrics_computed(self, metrics: dict) -> None:
        _safe_console_print(
            f"[METRICS] Health: {metrics.get('health_score')}% | "
            f"Alert: {metrics.get('alert_status')} | "
            f"Pattern: {metrics.get('attack_pattern')} | "
            f"Entropy: {round(float(metrics.get('ip_entropy', 0)), 2)} bits"
        )
        self._emit(self.EV_METRICS_COMPUTED, {
            "health_score":         metrics.get("health_score"),
            "alert_status":         metrics.get("alert_status"),
            "attack_pattern":       metrics.get("attack_pattern"),
            "ip_entropy":           round(float(metrics.get("ip_entropy", 0)), 3),
            "unique_attacking_ips": metrics.get("unique_attacking_ips"),
            "attack_velocity":      metrics.get("attack_velocity"),
            "is_velocity_spike":    metrics.get("is_velocity_spike"),
            "is_scheduled_attack":  metrics.get("is_scheduled_attack"),
            "peak_attack_hour":     metrics.get("peak_attack_hour"),
            "night_ratio":          metrics.get("night_ratio"),
        })

    def pass1_complete(
        self,
        alarmes: list[dict],
        threshold_snapshot: dict | None = None,
    ) -> None:
        top5 = [str(a.get("message", ""))[:120] for a in alarmes[:5]]
        by_domain: dict[str, int] = {}
        by_sev:    dict[str, int] = {}
        for a in alarmes:
            by_domain[a.get("domain", "OTHER")] = by_domain.get(a.get("domain", "OTHER"), 0) + 1
            by_sev[a.get("severite", "?")] = by_sev.get(a.get("severite", "?"), 0) + 1

        _safe_console_print(f"[IDPS] Pass 1 complete: {len(alarmes)} alarm(s)")
        for msg in top5:
            enc = getattr(sys.stdout, "encoding", "utf-8") or "utf-8"
            _safe_console_print(f"   -> {msg.encode(enc, 'replace').decode(enc)}")
        if len(alarmes) > 5:
            _safe_console_print(f"   ... and {len(alarmes)-5} more")

        self._emit(self.EV_PASS1_COMPLETE, {
            "alarm_count":        len(alarmes),
            "alarms_by_domain":   by_domain,
            "alarms_by_severity": by_sev,
            "top5_messages":      top5,
            "thresholds_used":    _threshold_row(threshold_snapshot) if threshold_snapshot else None,
        })

    def dynamic_config_issued(self, cfg_obj: Any) -> None:
        """
        cfg_obj is a DynamicConfig instance (imported at call site to avoid
        circular import; we just call its methods here).
        """
        summary   = cfg_obj.summary()
        reasoning = str(cfg_obj.reasoning)[:200]
        _safe_console_print(f"[HYBRID] Config  : {summary}")
        _safe_console_print(f"[HYBRID] Threat  : {cfg_obj.threat_level}")
        _safe_console_print(f"[HYBRID] Reasoning: {reasoning}")

        self._emit(self.EV_DYNAMIC_CONFIG_ISSUED, {
            "config_summary":    summary,
            "threat_level":      cfg_obj.threat_level,
            "confidence":        cfg_obj.confidence,
            "reasoning_excerpt": reasoning,
            "ssh_high_override": cfg_obj.ssh_high_risk_threshold,
            "web_high_override": cfg_obj.web_high_risk_threshold,
            "ftp_high_override": cfg_obj.ftp_high_risk_threshold,
            "kernel_override":   cfg_obj.kernel_high_risk_threshold,
            "session_override":  cfg_obj.session_high_risk_threshold,
            "escalate_ips":      cfg_obj.escalate_ips,
            "suppress_ips":      cfg_obj.suppress_ips,
            "rerun_engines":     cfg_obj.rerun_engines,
            "corr_window_override": cfg_obj.correlation_window_min,
            "issued_by":         cfg_obj.issued_by,
        })

    def dynamic_config_default(self) -> None:
        _safe_console_print("[IDPS] Agent issued no overrides - Pass 1 results are final")
        self._emit(self.EV_DYNAMIC_CONFIG_DEFAULT, {
            "alarm_count": None,
            "note": "orchestrator found no threshold adjustments necessary",
        })

    def pass2_complete(
        self,
        alarmes_final: list[dict],
        alarmes_pass1: list[dict],
        threshold_snapshot: dict | None = None,
        rerun_engines: list[str] | None = None,
    ) -> None:
        delta       = len(alarmes_final) - len(alarmes_pass1)
        delta_sign  = f"+{delta}" if delta >= 0 else str(delta)
        by_domain: dict[str, int] = {}
        by_sev:    dict[str, int] = {}
        for a in alarmes_final:
            by_domain[a.get("domain", "OTHER")] = by_domain.get(a.get("domain", "OTHER"), 0) + 1
            by_sev[a.get("severite", "?")] = by_sev.get(a.get("severite", "?"), 0) + 1

        # New alarms that didn't exist in pass 1
        p1_msgs = {a.get("message", "") for a in alarmes_pass1}
        new_alarms = [a for a in alarmes_final if a.get("message", "") not in p1_msgs]

        _safe_console_print(
            f"[IDPS] Pass 2 complete: {len(alarmes_final)} alarms "
            f"({delta_sign} vs Pass 1)"
        )
        for a in new_alarms[:3]:
            enc = getattr(sys.stdout, "encoding", "utf-8") or "utf-8"
            msg = str(a.get("message", ""))[:120]
            _safe_console_print(f"   NEW -> {msg.encode(enc, 'replace').decode(enc)}")

        self._emit(self.EV_PASS2_COMPLETE, {
            "alarm_count":         len(alarmes_final),
            "alarm_count_pass1":   len(alarmes_pass1),
            "alarm_delta":         delta,
            "new_alarm_count":     len(new_alarms),
            "new_alarm_messages":  [str(a.get("message", ""))[:120] for a in new_alarms[:5]],
            "alarms_by_domain":    by_domain,
            "alarms_by_severity":  by_sev,
            "thresholds_used":     _threshold_row(threshold_snapshot) if threshold_snapshot else None,
            "engines_rerun":       rerun_engines or ["all"],
        })

    def agents_complete(self, result: Any) -> None:
        result_str = str(result)[:400]
        _safe_console_print(f"[AGENTS] Crew complete. Excerpt: {result_str[:80]}...")
        self._emit(self.EV_AGENTS_COMPLETE, {
            "result_excerpt": result_str,
        })

    def session_summary(
        self,
        alarmes_pass1:      list[dict],
        alarmes_final:      list[dict],
        threshold_snapshots: list[dict],
        metrics:            dict | None = None,
        dynamic_config:     Any | None = None,
    ) -> None:
        elapsed_s = (datetime.now(timezone.utc) - self._session_start).total_seconds()
        pass2_ran = len(threshold_snapshots) > 1

        # Compact per-pass threshold rows for the JSONL record
        snap_rows = [_threshold_row(s) for s in threshold_snapshots]

        # Build stdout audit trail
        _safe_console_print(f"\n{'='*60}")
        _safe_console_print("   HYBRID ANALYSIS COMPLETE")
        _safe_console_print(f"   Pass 1 alarms : {len(alarmes_pass1)}")
        _safe_console_print(f"   Pass 2 ran    : {pass2_ran}")
        _safe_console_print(f"   Final alarms  : {len(alarmes_final)}")
        if dynamic_config:
            _safe_console_print(f"   Agent config  : {dynamic_config.summary()}")
        _safe_console_print(f"   Elapsed       : {elapsed_s:.1f}s")
        _safe_console_print("\n   THRESHOLD AUDIT TRAIL:")
        for snap in threshold_snapshots:
            _safe_console_print(
                f"   Pass {snap['pass']} ({snap['issued_by']}): "
                f"SSH≥{snap['ssh_high']}/{snap['ssh_med']} "
                f"WEB≥{snap['web_high']}/{snap['web_med']} "
                f"FTP≥{snap['ftp_high']}/{snap['ftp_med']} "
                f"KERNEL≥{snap['kernel_high']} "
                f"SESSION≥{snap['session_high']}/{snap['session_med']} "
                f"window={snap['corr_window']}min "
                f"threat={snap['threat_level']} conf={snap.get('confidence', 1):.0%}"
            )
        _safe_console_print(f"{'='*60}")

        self._emit(self.EV_SESSION_SUMMARY, {
            "alarm_count":         len(alarmes_final),
            "alarm_count_pass1":   len(alarmes_pass1),
            "alarm_delta":         len(alarmes_final) - len(alarmes_pass1),
            "pass2_ran":           pass2_ran,
            "elapsed_seconds":     round(elapsed_s, 2),
            "threshold_snapshots": snap_rows,
            "health_score":        metrics.get("health_score") if metrics else None,
            "attack_pattern":      metrics.get("attack_pattern") if metrics else None,
            "agent_threat_level":  dynamic_config.threat_level if dynamic_config else "NORMAL",
            "agent_reasoning":     str(dynamic_config.reasoning)[:200] if dynamic_config else "",
            "agent_config_summary": dynamic_config.summary() if dynamic_config else "default",
        })

    def trust_computed(self, trust: dict) -> None:
        """
        Phase B — Emit TRUST_COMPUTED event to JSONL.
        Called right after Pass 1 completes in main.py.
        Dashboard polls this event to populate the Performance panel.
        """
        label = trust.get("confidence_label", "?")
        conf  = trust.get("confidence_in_metrics", 0.0)
        _safe_console_print(
            f"[TRUST] confidence={conf:.3f} ({label}) | "
            f"agreement={trust.get('model_agreement', 0):.2f} | "
            f"fp_rate={trust.get('false_positive_rate', 0):.2f} | "
            f"drift={trust.get('drift_score', 0):.3f}({trust.get('drift_label', '?')}) | "
            f"stability={trust.get('stability', '?')}"
        )
        self._emit(self.EV_TRUST_COMPUTED, {
            "model_agreement":       trust.get("model_agreement"),
            "false_positive_rate":   trust.get("false_positive_rate"),
            "drift_score":           trust.get("drift_score"),
            "drift_label":           trust.get("drift_label"),
            "drift_flagged":         trust.get("drift_flagged"),
            "stability":             trust.get("stability"),
            "stable_signals":        trust.get("stable_signals"),
            "noise_ratio":           trust.get("noise_ratio"),
            "ml_score_weight":       trust.get("ml_score_weight"),
            "confidence_in_metrics": conf,
            "confidence_label":      label,
            "signals_summary":       trust.get("signals_summary"),
        })
        try:
            append_event(
                category="trust",
                event_type=self.EV_TRUST_COMPUTED,
                payload=dict(trust),
                dataset_id=str(trust.get("dataset_id") or self.dataset_id or ""),
                source="session_logger",
                tags=["trust", "analytics"],
            )
        except Exception:
            pass

    def warning(self, source: str, message: str) -> None:
        _safe_console_print(f"[WARN:{source}] {message}")
        self._emit(self.EV_WARNING, {"source": source, "message": message[:300]})

    def error(self, source: str, exc: Exception) -> None:
        msg = f"{type(exc).__name__}: {exc}"
        _safe_console_print(f"[ERROR:{source}] {msg}", stream=sys.stderr)
        self._emit(self.EV_ERROR, {"source": source, "error": msg[:300]})

    def close(self) -> None:
        try:
            self._file.close()
        except Exception:
            pass
        _safe_console_print(f"[LOG] Session log closed -> {self.output_path}")
