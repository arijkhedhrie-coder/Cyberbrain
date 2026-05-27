from __future__ import annotations

import glob
import json
import threading
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, List

from fastapi import APIRouter, HTTPException, Query

from app.ai.agents.memory import get_memory_file
from app.core.event_store import replay_timeline
from app.core.fusion_view import FUSION_DATASET, FUSION_LABEL, is_fusion_dataset, normalize_dataset_query
from app.core.pipeline_store import AVAILABLE_DATASETS, LEGACY_MERGED_DATASET, PIPELINE_RESULTS

router = APIRouter(prefix="/api", tags=["dashboard"])

_cache: dict[str, dict[str, Any]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = 30

PROJECT_ROOT = Path(__file__).resolve().parents[3]
MEMORY_FILE = PROJECT_ROOT / "app" / "long_term_memory.json"
OUTPUT_DIR = PROJECT_ROOT / "app" / "output"
_EXCLUDED_OUTPUT_DATASET_DIRS = {"event_store"}

_LABEL_TO_ENGINES: dict[str, list[str]] = {
    "auth": ["SSH"],
    "web": ["WEB"],
    "ftp": ["FTP"],
    "kernel": ["KERNEL", "SESSION"],
}
_ENGINE_TO_LABEL: dict[str, str] = {
    "SSH": "auth",
    "WEB": "web",
    "FTP": "ftp",
    "KERNEL": "kernel",
    "SESSION": "kernel",
    "PREDICTION": "kernel",
    "CORRELATION": "auth",
}


def _cached(key: str, loader, ttl: int = _CACHE_TTL):
    now = time.time()
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (now - entry["ts"]) < ttl:
            return entry["data"]
    data = loader()
    with _cache_lock:
        _cache[key] = {"data": data, "ts": now}
    return data


def _as_float_or_none(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _normalized_alarm_severity(value: str) -> str:
    sev = str(value or "").upper().strip()
    if sev == "CRITIQUE":
        return "CRITICAL"
    if sev == "AVERTISSEMENT":
        return "HIGH"
    if sev == "AVERTISSEMENT_MOYEN":
        return "MED"
    return sev


def _dataset_key(dataset: str | None) -> str:
    normalized = normalize_dataset_query(dataset)
    if normalized is None:
        return ""
    if normalized == FUSION_DATASET:
        return LEGACY_MERGED_DATASET
    return normalized


def _available_dataset_ids() -> list[str]:
    names = {str(d) for d in AVAILABLE_DATASETS if d}
    names.update(
        str(k) for k in PIPELINE_RESULTS.keys()
        if k and k != LEGACY_MERGED_DATASET
    )
    for path in PROJECT_ROOT.glob("app/memory_*.json"):
        names.add(path.stem.replace("memory_", "", 1))
    for path in OUTPUT_DIR.iterdir() if OUTPUT_DIR.exists() else []:
        if path.is_dir() and path.name not in _EXCLUDED_OUTPUT_DATASET_DIRS:
            names.add(path.name)
    return sorted(names)


def _should_expose_fusion_dataset(datasets: list[str]) -> bool:
    # Fusion replay can aggregate across the event store even when there is no
    # legacy merged payload in PIPELINE_RESULTS, so expose the selector option
    # whenever we have at least one real dataset to overlay.
    return bool(datasets) or LEGACY_MERGED_DATASET in PIPELINE_RESULTS


def _default_dataset_id() -> str | None:
    datasets = _available_dataset_ids()
    return datasets[0] if datasets else None


def _resolve_selected_dataset(dataset: str | None) -> str | None:
    if dataset:
        return dataset
    return _default_dataset_id()


def _get_dataset_payload(dataset: str | None) -> dict[str, Any] | None:
    key = _dataset_key(dataset)
    if key and key in PIPELINE_RESULTS:
        return PIPELINE_RESULTS[key]
    if not dataset:
        default_dataset = _default_dataset_id()
        if default_dataset and default_dataset in PIPELINE_RESULTS:
            return PIPELINE_RESULTS[default_dataset]
    return None


def _load_memory(dataset: str | None = None) -> dict[str, Any]:
    payload = _get_dataset_payload(dataset)
    if payload and isinstance(payload.get("memory"), dict):
        return payload["memory"]

    if is_fusion_dataset(dataset):
        return {}

    memory_path = get_memory_file(dataset) if dataset else MEMORY_FILE
    if not Path(memory_path).exists():
        return {}
    try:
        with open(memory_path, "r", encoding="utf-8", errors="replace") as f:
            return json.load(f)
    except Exception:
        return {}


def _latest_jsonl(dataset: str | None = None) -> list[dict[str, Any]]:
    payload = _get_dataset_payload(dataset)
    if payload and isinstance(payload.get("events"), list):
        return [e for e in payload["events"] if isinstance(e, dict)]

    if dataset:
        dataset_dir = OUTPUT_DIR / dataset
        files = sorted(glob.glob(str(dataset_dir / "session_*.jsonl")))
    else:
        files = sorted(glob.glob(str(OUTPUT_DIR / "session_*.jsonl")))
    if not files:
        return []

    events: list[dict[str, Any]] = []
    try:
        with open(files[-1], "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except Exception:
                    continue
                if isinstance(payload, dict):
                    events.append(payload)
    except Exception:
        return []
    return events


def _get_event(events: list[dict[str, Any]], event_type: str) -> dict[str, Any]:
    for event in events:
        if isinstance(event, dict) and event.get("event_type") == event_type:
            return event
    return {}


def _build_kpis(events: list[dict[str, Any]], memory: dict[str, Any], dataset: str | None = None) -> dict[str, Any]:
    payload = _get_dataset_payload(dataset)
    if payload and isinstance(payload.get("kpis"), dict):
        base = dict(payload["kpis"])
        base.setdefault("available", True)
        base.setdefault("missing_data", [])
        base.setdefault("server_count", len(payload.get("server_ids", [])))
        base.setdefault("data_sources", payload.get("data_sources", []))
        return base

    sessions = memory.get("sessions", [])
    last = sessions[-1].get("donnees", {}) if sessions else {}
    metrics = _get_event(events, "METRICS_COMPUTED")
    trust_ev = _get_event(events, "TRUST_COMPUTED")
    pass1 = _get_event(events, "PASS1_COMPLETE")

    health_score = _as_float_or_none(metrics.get("health_score") or last.get("health_score")) or 100.0
    row_count = int(metrics.get("row_count", 0) or last.get("row_count", 0) or last.get("lines_analyzed", 0))
    deduped_count = int(
        metrics.get("deduped_count", 0)
        or metrics.get("dedup_count", 0)
        or last.get("deduped_count", 0)
        or last.get("dedup_count", 0)
        or row_count
    )
    return {
        "available": True,
        "missing_data": [],
        "health_score": health_score,
        "health_status": "HEALTHY" if health_score >= 90 else ("WARNING" if health_score >= 70 else "CRITICAL"),
        "ssh_failures": int(last.get("ssh_failures", 0)),
        "blocked_ips": int(last.get("blocked_ips", 0)),
        "alert_status": metrics.get("alert_status") or last.get("alert_status") or "NORMAL",
        "attack_pattern": metrics.get("attack_pattern") or last.get("attack_pattern") or "",
        "ip_entropy": _as_float_or_none(metrics.get("ip_entropy") or last.get("ip_entropy")),
        "unique_attacking_ips": int(metrics.get("unique_attacking_ips", 0) or last.get("unique_attacking_ips", 0)),
        "attack_velocity": _as_float_or_none(metrics.get("attack_velocity") or last.get("attack_velocity")) or 0.0,
        "is_velocity_spike": bool(metrics.get("is_velocity_spike", False)),
        "night_ratio": _as_float_or_none(metrics.get("night_ratio") or last.get("night_ratio")),
        "row_count": row_count,
        "server_count": len(last.get("server_ids", []) or last.get("serveurs_actifs", []) or []),
        "data_sources": list(last.get("data_sources", [])),
        "deduped_count": deduped_count,
        "noise_ratio": _as_float_or_none(metrics.get("noise_ratio") or last.get("noise_ratio")),
        "data_quality": metrics.get("data_quality") or last.get("data_quality"),
        "notes": {},
        "nb_alarms": int(pass1.get("alarm_count", 0) or last.get("nb_alarmes_final", 0)),
        "trust_score": _as_float_or_none(trust_ev.get("confidence_in_metrics")),
        "trust_label": trust_ev.get("confidence_label", ""),
    }


def _build_alarms(memory: dict[str, Any], dataset: str | None = None) -> list[dict[str, Any]]:
    payload = _get_dataset_payload(dataset)
    if payload and isinstance(payload.get("alarms"), list):
        return payload["alarms"]

    sessions = memory.get("sessions", [])
    if not sessions:
        return []
    donnees = sessions[-1].get("donnees", {})
    alarmes = donnees.get("alarmes", [])
    return [a for a in alarmes if isinstance(a, dict)]


def _build_alarm_history(
    dataset: str | None = None,
    severity: str | None = None,
    offset: int = 0,
    limit: int = 20,
) -> dict[str, Any]:
    dataset_filter = None if is_fusion_dataset(dataset) else (dataset or None)
    severity_filter = _normalized_alarm_severity(severity or "")
    records = replay_timeline(categories=["alerts"], dataset_id=dataset_filter, limit=0)

    items: list[dict[str, Any]] = []
    for record in reversed(records):
        event_type = str(record.get("event_type") or "")
        if event_type not in {"ALERT_PASS1", "ALERT_FINAL"}:
            continue

        payload = record.get("payload") or {}
        if not isinstance(payload, dict):
            continue

        alarm_type = str(payload.get("type") or "")
        if not alarm_type or alarm_type.startswith("CORRECTIVE_"):
            continue

        normalized_severity = _normalized_alarm_severity(
            str(payload.get("severity") or payload.get("severite") or "")
        )
        if severity_filter and severity_filter != "ALL" and normalized_severity != severity_filter:
            continue

        alarm = dict(payload)
        alarm.setdefault("id", str(record.get("event_id") or payload.get("id") or ""))
        alarm.setdefault("event_id", str(record.get("event_id") or ""))
        alarm.setdefault("dataset_id", str(record.get("dataset_id") or payload.get("dataset_id") or ""))
        alarm.setdefault("stage", "final" if event_type == "ALERT_FINAL" else "pass1")
        items.append(alarm)

    safe_offset = max(0, int(offset or 0))
    safe_limit = max(1, min(int(limit or 20), 100))
    page = items[safe_offset:safe_offset + safe_limit]
    return {
        "items": page,
        "total": len(items),
        "offset": safe_offset,
        "limit": safe_limit,
        "has_more": safe_offset + safe_limit < len(items),
    }


def _build_engine_scores(events: list[dict[str, Any]], memory: dict[str, Any], dataset: str | None = None) -> list[dict[str, Any]]:
    payload = _get_dataset_payload(dataset)
    if payload and isinstance(payload.get("engine_scores"), list):
        return payload["engine_scores"]

    summary = _get_event(events, "SESSION_SUMMARY")
    snapshots = summary.get("threshold_snapshots", [])
    pass1_snap = snapshots[0] if snapshots else {}
    pass2_snap = snapshots[-1] if snapshots else pass1_snap
    pass1_event = _get_event(events, "PASS1_COMPLETE")
    by_domain = pass1_event.get("alarms_by_domain", {})

    result = []
    for eng in ["SSH", "WEB", "FTP", "KERNEL", "SESSION"]:
        eng_lower = eng.lower()
        count = int(by_domain.get(eng, 0))
        pass1_thresh = pass1_snap.get(f"{eng_lower}_high", 50)
        pass2_thresh = pass2_snap.get(f"{eng_lower}_high", pass1_thresh)
        result.append({
            "engine": eng,
            "alarms": count,
            "score": min(100, count * 5),
            "pass1": pass1_thresh,
            "pass2": pass2_thresh,
            "status": "ALARM" if count > pass1_thresh else "CLEAR",
            "rerun_p2": bool(pass2_snap.get("rerun_engines")),
        })
    return result


def _build_decisions(events: list[dict[str, Any]], dataset: str | None = None) -> list[dict[str, Any]]:
    payload = _get_dataset_payload(dataset)
    if payload and isinstance(payload.get("decisions"), list):
        return payload["decisions"]
    return [
        e for e in events
        if isinstance(e, dict) and e.get("event_type") in (
            "DYNAMIC_CONFIG_DEFAULT",
            "DYNAMIC_CONFIG_ISSUED",
            "AGENTS_COMPLETE",
        )
    ][-20:]


def _build_log_lines(events: list[dict[str, Any]], dataset: str | None = None) -> list[str]:
    payload = _get_dataset_payload(dataset)
    if payload and isinstance(payload.get("log_lines"), list):
        return payload["log_lines"]
    lines = []
    for event in events:
        ts = event.get("timestamp", "")
        msg = event.get("message") or event.get("msg") or event.get("event_type", "")
        lines.append(f"[{ts}] {msg}" if ts else str(msg))
    return lines[-60:]


def _build_trust(events: list[dict[str, Any]], dataset: str | None = None) -> dict[str, Any]:
    payload = _get_dataset_payload(dataset)
    if payload and isinstance(payload.get("trust"), dict):
        base = dict(payload["trust"])
        base.setdefault("available", True)
        return base
    trust_ev = _get_event(events, "TRUST_COMPUTED")
    if not trust_ev:
        return {
            "available": False,
            "model_agreement": None,
            "false_positive_rate": None,
            "drift_score": None,
            "drift_label": "N/A",
            "drift_flagged": False,
            "stability": "N/A",
            "stable_signals": None,
            "noise_ratio": None,
            "ml_score_weight": None,
            "confidence_in_metrics": None,
            "confidence_label": "N/A",
            "signals_summary": "No TRUST_COMPUTED event found.",
            "timestamp": "",
        }
    return {
        "available": True,
        "model_agreement": _as_float_or_none(trust_ev.get("model_agreement")),
        "false_positive_rate": _as_float_or_none(trust_ev.get("false_positive_rate")),
        "drift_score": _as_float_or_none(trust_ev.get("drift_score")),
        "drift_label": trust_ev.get("drift_label", "UNKNOWN"),
        "drift_flagged": bool(trust_ev.get("drift_flagged", False)),
        "stability": trust_ev.get("stability", ""),
        "stable_signals": trust_ev.get("stable_signals"),
        "noise_ratio": trust_ev.get("noise_ratio"),
        "ml_score_weight": trust_ev.get("ml_score_weight"),
        "confidence_in_metrics": _as_float_or_none(trust_ev.get("confidence_in_metrics")),
        "confidence_label": trust_ev.get("confidence_label", "UNKNOWN"),
        "signals_summary": trust_ev.get("signals_summary", ""),
        "timestamp": trust_ev.get("timestamp", ""),
    }


def _build_data_quality(events: list[dict[str, Any]], dataset: str | None = None) -> dict[str, Any]:
    payload = _get_dataset_payload(dataset)
    if payload and isinstance(payload.get("data_quality"), dict):
        return payload["data_quality"]
    pipeline_start = _get_event(events, "PIPELINE_START")
    return {
        "raw_rows": int(pipeline_start.get("row_count", 0)),
        "dedup_rows": int(pipeline_start.get("deduped_count", 0)),
        "noise_pct": _as_float_or_none(pipeline_start.get("noise_ratio")),
        "ml_weight": _as_float_or_none(pipeline_start.get("ml_score_weight")),
        "data_sources": pipeline_start.get("data_sources", []),
    }


def _build_sessions(memory: dict[str, Any], dataset: str | None = None) -> list[dict[str, Any]]:
    payload = _get_dataset_payload(dataset)
    if payload and isinstance(payload.get("sessions"), list):
        return payload["sessions"]
    result = []
    for session in reversed(memory.get("sessions", [])[-20:]):
        data = session.get("donnees", {})
        result.append({
            "date": session.get("date", ""),
            "threat_level": data.get("agent_threat_level", "NORMAL"),
            "nb_alarms_pass1": data.get("nb_alarmes_pass1", 0),
            "nb_alarms_final": data.get("nb_alarmes_final", 0),
            "pass2_ran": bool(data.get("pass2_ran", False)),
            "health_score": _as_float_or_none(data.get("health_score")),
            "ips_suspectes": data.get("ips_suspectes", []),
            "attack_pattern": data.get("attack_pattern", ""),
        })
    return result


def _build_threshold_history(memory: dict[str, Any], dataset: str | None = None) -> list[dict[str, Any]]:
    if is_fusion_dataset(dataset):
        return []

    sessions = memory.get("sessions", [])
    session_lookup: dict[str, dict[str, Any]] = {}
    for session in sessions:
        data = session.get("donnees", {})
        session_id = str(data.get("date") or session.get("date") or "")
        if session_id:
            session_lookup[session_id] = data

    history = memory.get("threshold_history", [])
    result: list[dict[str, Any]] = []
    engine_keys = {
        "SSH": "ssh_high",
        "WEB": "web_high",
        "FTP": "ftp_high",
        "KERNEL": "kernel_high",
        "SESSION": "session_high",
    }

    for entry in history[-20:]:
        snapshots = entry.get("snapshots", [])
        if not isinstance(snapshots, list) or not snapshots:
            continue

        pass1_snap = snapshots[0] if isinstance(snapshots[0], dict) else {}
        pass2_snap = snapshots[-1] if isinstance(snapshots[-1], dict) else pass1_snap
        session_id = str(entry.get("session_id") or "")
        session_data = session_lookup.get(session_id, {})

        engines: dict[str, dict[str, Any]] = {}
        changed_engines: list[str] = []
        for engine, key in engine_keys.items():
            pass1_value = _as_float_or_none(pass1_snap.get(key))
            pass2_value = _as_float_or_none(pass2_snap.get(key))
            changed = (
                pass1_value is not None
                and pass2_value is not None
                and abs(pass1_value - pass2_value) > 1e-9
            )
            if changed:
                changed_engines.append(engine)
            engines[engine] = {
                "pass1": pass1_value,
                "pass2": pass2_value if pass2_value is not None else pass1_value,
                "changed": changed,
            }

        nb_alarms_pass1 = int(entry.get("nb_alarms_pass1", 0) or 0)
        nb_alarms_final = int(entry.get("nb_alarms_final", 0) or 0)
        result.append({
            "timestamp": entry.get("date", ""),
            "session_id": session_id,
            "threat_level": entry.get("threat_level") or session_data.get("agent_threat_level", "NORMAL"),
            "pass2_ran": bool(entry.get("pass2_ran", False)),
            "nb_alarms_pass1": nb_alarms_pass1,
            "nb_alarms_final": nb_alarms_final,
            "alarm_delta": nb_alarms_final - nb_alarms_pass1,
            "agent_reasoning": str(session_data.get("agent_reasoning", "")),
            "agent_config_summary": str(session_data.get("agent_config_summary", "")),
            "engines": engines,
            "changed_engines": changed_engines,
            "gate": {
                "accepted": bool(pass2_snap.get("gate_accepted", False)) if len(snapshots) > 1 else False,
                "mode": str(pass2_snap.get("gate_mode") or ("NOT_RERUN" if len(snapshots) == 1 else "UNKNOWN")),
                "version_id": pass2_snap.get("gate_version_id"),
                "trust_score": _as_float_or_none(pass2_snap.get("trust_score")),
                "passed": list(pass2_snap.get("gate_passed", []) or []),
                "failed": list(pass2_snap.get("gate_failed", []) or []),
            },
        })

    return result


def _severity_rank(value: str | None) -> int:
    sev = str(value or "").upper()
    return {
        "CRITICAL": 4,
        "CRITIQUE": 4,
        "HIGH": 3,
        "AVERTISSEMENT": 3,
        "MED": 2,
        "MEDIUM": 2,
        "LOW": 1,
        "INFO": 0,
    }.get(sev, 0)


def _normalize_alarm_for_explainability(raw: dict[str, Any]) -> dict[str, Any]:
    alarm = dict(raw or {})
    severity = str(alarm.get("severity") or alarm.get("severite") or "MED").upper()
    if severity == "CRITIQUE":
        severity = "CRITICAL"
    elif severity == "AVERTISSEMENT":
        severity = "HIGH"
    elif severity == "AVERTISSEMENT_MOYEN":
        severity = "MED"

    return {
        "id": str(alarm.get("id") or f"{alarm.get('timestamp', '')}-{alarm.get('ip', '')}-{alarm.get('type', 'UNKNOWN')}"),
        "timestamp": str(alarm.get("timestamp") or ""),
        "type": str(alarm.get("type") or "UNKNOWN"),
        "source_ip": str(alarm.get("source_ip") or alarm.get("ip") or "unknown"),
        "severity": severity,
        "engine": str(alarm.get("engine") or alarm.get("domain") or "UNKNOWN").upper(),
        "score": _as_float_or_none(alarm.get("score")) or 0.0,
        "message": str(alarm.get("message") or ""),
        "human_insight": str(alarm.get("human_insight") or alarm.get("message") or ""),
        "action": str(alarm.get("action") or "MONITOR"),
        "country": str(alarm.get("country") or "Unknown"),
        "failures": int(alarm.get("failures", 0) or 0),
        "dataset_id": str(alarm.get("dataset_id") or ""),
        "stage": str(alarm.get("stage") or ""),
        "models_agreed": int(alarm.get("models_agreed", 0) or 0),
        "model_agreement": _as_float_or_none(alarm.get("model_agreement")),
        "agreement_label": str(alarm.get("agreement_label") or ""),
        "layer0_risk": _as_float_or_none(alarm.get("layer0_risk")),
        "layer0_flags": list(alarm.get("layer0_flags", []) or []),
        "threshold_snapshot": alarm.get("threshold_snapshot") if isinstance(alarm.get("threshold_snapshot"), dict) else None,
    }


def _pick_top_alarm(alarms: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not alarms:
        return None
    normalized = [_normalize_alarm_for_explainability(alarm) for alarm in alarms if isinstance(alarm, dict)]
    if not normalized:
        return None
    normalized.sort(
        key=lambda alarm: (
            _severity_rank(str(alarm.get("severity") or "")),
            float(alarm.get("score") or 0.0),
            str(alarm.get("timestamp") or ""),
        ),
        reverse=True,
    )
    return normalized[0]


def _normalize_decision_for_explainability(record: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(record, dict):
        return None

    event_type = str(record.get("event_type") or "")
    timestamp = str(record.get("timestamp") or record.get("ts") or "")

    if event_type == "DYNAMIC_CONFIG_ISSUED":
        return {
            "agent": "Orchestrateur",
            "action": "Pass 2 dynamic configuration issued",
            "reasoning": str(record.get("reasoning_excerpt") or "Dynamic configuration issued after Pass 1."),
            "confidence": _as_float_or_none(record.get("confidence")),
            "severity": str(record.get("threat_level") or "INFO"),
            "timestamp": timestamp,
            "approved": None,
        }
    if event_type == "DYNAMIC_CONFIG_DEFAULT":
        return {
            "agent": "Orchestrateur",
            "action": "Pass 2 skipped",
            "reasoning": str(record.get("note") or "No threshold override was required."),
            "confidence": None,
            "severity": "INFO",
            "timestamp": timestamp,
            "approved": None,
        }
    if event_type == "AGENTS_COMPLETE":
        return {
            "agent": "Rapporteur",
            "action": "Agent coordination completed",
            "reasoning": str(record.get("result_excerpt") or record.get("message") or "Session complete."),
            "confidence": None,
            "severity": "INFO",
            "timestamp": timestamp,
            "approved": None,
        }

    return None


def _build_explainability(events: list[dict[str, Any]], memory: dict[str, Any], dataset: str | None = None) -> dict[str, Any]:
    payload = _get_dataset_payload(dataset)
    generated_from = "pipeline_payload" if payload else "jsonl_replay"
    kpis = _build_kpis(events, memory, dataset)
    alarms = _build_alarms(memory, dataset)
    trust = _build_trust(events, dataset)
    engine_scores = _build_engine_scores(events, memory, dataset)
    threshold_history = _build_threshold_history(memory, dataset)
    top_alarm = _pick_top_alarm(alarms)

    decisions_raw = _build_decisions(events, dataset)
    latest_decision = None
    for record in decisions_raw:
        latest_decision = _normalize_decision_for_explainability(record)
        if latest_decision:
            break

    prediction_payload = None
    if payload and isinstance(payload.get("prediction"), dict):
        prediction_payload = payload.get("prediction")
    else:
        prediction_event = _get_event(events, "PREDICTION_COMPUTED")
        if prediction_event:
            prediction_payload = {
                "prediction_score": int(prediction_event.get("prediction_score", 0) or 0),
                "risk_level": "LOW",
                "flags": list(prediction_event.get("flags", []) or []),
                "explanations": list(prediction_event.get("explanations", []) or []),
                "message": str(prediction_event.get("message") or ""),
            }

    agreement = _as_float_or_none((top_alarm or {}).get("model_agreement"))
    if agreement is None:
        agreement = _as_float_or_none(trust.get("model_agreement"))
    models_agreed = int((top_alarm or {}).get("models_agreed") or sum(1 for engine in engine_scores if int(engine.get("alarms", 0) or 0) > 0))

    threshold_context = None
    if top_alarm:
        engine_name = str(top_alarm.get("engine") or "").upper()
        threshold_snapshot = top_alarm.get("threshold_snapshot") if isinstance(top_alarm.get("threshold_snapshot"), dict) else None
        if threshold_snapshot:
            key = f"{engine_name.lower()}_high"
            threshold_context = {
                "engine": engine_name,
                "pass": threshold_snapshot.get("pass"),
                "issued_by": threshold_snapshot.get("issued_by"),
                "threshold": _as_float_or_none(threshold_snapshot.get(key)),
                "threat_level": threshold_snapshot.get("threat_level"),
                "confidence": _as_float_or_none(threshold_snapshot.get("confidence")),
                "corr_window": _as_float_or_none(threshold_snapshot.get("corr_window")),
            }
        elif threshold_history:
            latest = threshold_history[-1]
            engine_snapshot = latest.get("engines", {}).get(engine_name, {})
            if isinstance(engine_snapshot, dict):
                threshold_context = {
                    "engine": engine_name,
                    "pass1": engine_snapshot.get("pass1"),
                    "pass2": engine_snapshot.get("pass2"),
                    "changed": bool(engine_snapshot.get("changed", False)),
                    "gate_mode": latest.get("gate", {}).get("mode"),
                    "gate_accepted": bool(latest.get("gate", {}).get("accepted", False)),
                    "threat_level": latest.get("threat_level"),
                    "confidence": latest.get("gate", {}).get("trust_score"),
                }

    evidence: list[dict[str, Any]] = []

    def add_evidence(label: str, value: str, detail: str, weight: float, tone: str, source: str) -> None:
        if weight <= 0:
            return
        evidence.append({
            "label": label,
            "value": value,
            "detail": detail,
            "weight": round(max(0.0, min(weight, 100.0)), 1),
            "tone": tone,
            "source": source,
        })

    if top_alarm:
        score = _as_float_or_none(top_alarm.get("score")) or 0.0
        add_evidence(
            "Alarm score",
            f"{score:.1f}",
            str(top_alarm.get("human_insight") or top_alarm.get("message") or "Top alarm selected from current session."),
            score,
            "risk",
            "alarm.score",
        )
        failures = int(top_alarm.get("failures", 0) or 0)
        add_evidence(
            "Observed failures",
            str(failures),
            f"{failures} failed attempts or suspicious events were attached to the selected alarm source.",
            min(failures * 5.0, 100.0),
            "risk",
            "alarm.failures",
        )
        layer0_risk = _as_float_or_none(top_alarm.get("layer0_risk"))
        if layer0_risk is not None:
            flags = ", ".join(top_alarm.get("layer0_flags", []) or []) or "no layer0 flags"
            add_evidence(
                "Early flood signal",
                f"{layer0_risk:.2f}",
                f"Layer 0 pre-scan raised {flags}.",
                layer0_risk * 100.0,
                "risk",
                "alarm.layer0_risk",
            )

    attack_velocity = _as_float_or_none(kpis.get("attack_velocity"))
    if attack_velocity is not None:
        add_evidence(
            "Attack velocity",
            f"{attack_velocity:.1f}/min",
            "Current backend metrics report this event rate across the selected dataset.",
            min(attack_velocity, 100.0),
            "risk",
            "metrics.attack_velocity",
        )

    entropy = _as_float_or_none(kpis.get("ip_entropy"))
    if entropy is not None:
        add_evidence(
            "IP entropy",
            f"{entropy:.2f}",
            "Higher entropy indicates more distributed attacker behavior.",
            min((entropy / 4.0) * 100.0, 100.0),
            "context",
            "metrics.ip_entropy",
        )

    unique_ips = int(kpis.get("unique_attacking_ips", 0) or 0)
    if unique_ips > 0:
        add_evidence(
            "Unique attacking IPs",
            str(unique_ips),
            "Distinct attacking sources recorded in the current session metrics.",
            min(unique_ips * 4.0, 100.0),
            "risk",
            "metrics.unique_attacking_ips",
        )

    if agreement is not None:
        add_evidence(
            "Model agreement",
            f"{agreement * 100:.0f}%",
            str((top_alarm or {}).get("agreement_label") or trust.get("confidence_label") or "Agreement signal from trust engine."),
            agreement * 100.0,
            "support",
            "trust.model_agreement",
        )

    noise_ratio = _as_float_or_none(kpis.get("noise_ratio"))
    if noise_ratio is not None:
        add_evidence(
            "Noise ratio",
            f"{noise_ratio * 100:.1f}%",
            "Noise is recorded during deduplication and quality scoring before anomaly analysis.",
            noise_ratio * 100.0,
            "context",
            "metrics.noise_ratio",
        )

    if prediction_payload:
        prediction_score = int(prediction_payload.get("prediction_score", 0) or 0)
        flags = list(prediction_payload.get("flags", []) or [])
        add_evidence(
            "Prediction score",
            str(prediction_score),
            ", ".join(flags) if flags else str(prediction_payload.get("message") or "Prediction context available."),
            prediction_score,
            "risk",
            "prediction.prediction_score",
        )

    if threshold_context and threshold_context.get("threshold") is not None:
        add_evidence(
            "Applied threshold",
            f"{float(threshold_context['threshold']):.1f}",
            f"{threshold_context.get('engine', 'ENGINE')} threshold used in the alarm snapshot for pass {threshold_context.get('pass')}.",
            min(float(threshold_context["threshold"]) * 2.0, 100.0),
            "context",
            "alarm.threshold_snapshot",
        )
    elif threshold_context and threshold_context.get("pass1") is not None and threshold_context.get("pass2") is not None:
        pass1_value = _as_float_or_none(threshold_context.get("pass1")) or 0.0
        pass2_value = _as_float_or_none(threshold_context.get("pass2")) or 0.0
        add_evidence(
            "Threshold shift",
            f"{pass1_value:.1f} -> {pass2_value:.1f}",
            f"Latest persisted threshold context for {threshold_context.get('engine', 'ENGINE')}.",
            min(abs(pass2_value - pass1_value) * 4.0, 100.0),
            "context",
            "threshold_history",
        )

    evidence.sort(key=lambda item: float(item.get("weight", 0.0)), reverse=True)

    prediction_context = None
    if prediction_payload:
        prediction_context = {
            "score": int(prediction_payload.get("prediction_score", 0) or 0),
            "risk_level": str(prediction_payload.get("risk_level") or "LOW"),
            "flags": list(prediction_payload.get("flags", []) or []),
            "explanations": list(prediction_payload.get("explanations", []) or []),
            "message": str(prediction_payload.get("message") or ""),
        }

    engine_contributions = [
        {
            "engine": str(engine.get("engine") or ""),
            "alarms": int(engine.get("alarms", 0) or 0),
            "status": str(engine.get("status") or "CLEAR"),
            "pass1": _as_float_or_none(engine.get("pass1")),
            "pass2": _as_float_or_none(engine.get("pass2")),
            "rerun_p2": bool(engine.get("rerun_p2", False)),
        }
        for engine in engine_scores
        if int(engine.get("alarms", 0) or 0) > 0
    ]

    narrative_parts = []
    if top_alarm:
        narrative_parts.append(
            f"{top_alarm['type']} on {top_alarm['source_ip']} was prioritized by the {top_alarm['engine']} engine with score {top_alarm['score']:.1f}."
        )
    if trust.get("available"):
        narrative_parts.append(
            f"Trust is {trust.get('confidence_label', 'UNKNOWN')} with drift {trust.get('drift_label', 'UNKNOWN')} and stability {trust.get('stability', 'UNKNOWN')}."
        )
    if threshold_context and threshold_context.get("gate_mode"):
        narrative_parts.append(
            f"Latest gate mode for this path is {threshold_context.get('gate_mode')}."
        )
    elif threshold_history:
        latest_gate = threshold_history[-1].get("gate", {})
        narrative_parts.append(
            f"Latest threshold history gate is {latest_gate.get('mode', 'UNKNOWN')}."
        )
    if prediction_context and prediction_context.get("flags"):
        narrative_parts.append(
            f"Prediction flags: {', '.join(prediction_context['flags'])}."
        )

    return {
        "available": top_alarm is not None or bool(evidence),
        "generated_from": generated_from,
        "dataset_scope": "fusion" if is_fusion_dataset(dataset) else "local",
        "summary": " ".join(narrative_parts) if narrative_parts else "No explainability evidence available for the selected dataset.",
        "top_alarm": top_alarm,
        "model_context": {
            "agreement": agreement,
            "models_agreed": models_agreed,
            "agreement_label": str((top_alarm or {}).get("agreement_label") or trust.get("confidence_label") or "UNKNOWN"),
            "trust_score": _as_float_or_none(trust.get("confidence_in_metrics")),
            "trust_label": str(trust.get("confidence_label") or "UNKNOWN"),
            "drift_label": str(trust.get("drift_label") or "UNKNOWN"),
            "stability": str(trust.get("stability") or "UNKNOWN"),
            "signals_summary": str(trust.get("signals_summary") or ""),
        },
        "evidence": evidence[:6],
        "engine_contributions": engine_contributions,
        "latest_decision": latest_decision,
        "prediction_context": prediction_context,
        "threshold_context": threshold_context,
    }


def _filter_alarms_by_servers(all_alarms: list[dict[str, Any]], servers: list[str]) -> list[dict[str, Any]]:
    if not servers:
        return all_alarms
    server_set = {s.lower() for s in servers}
    result = []
    for alarm in all_alarms:
        server_id = str(alarm.get("server_id") or "").lower()
        engine = str(alarm.get("engine") or alarm.get("domain") or "").upper()
        label = _ENGINE_TO_LABEL.get(engine, "")
        if server_id and server_id in server_set:
            result.append(alarm)
        elif label and label in server_set:
            result.append(alarm)
    return result


def _engines_for_servers(servers: list[str]) -> set[str]:
    engines: set[str] = set()
    for server in servers:
        label = server.lower()
        if label in _LABEL_TO_ENGINES:
            engines.update(_LABEL_TO_ENGINES[label])
    return engines


def _make_display_name(dataset_id: str) -> str:
    parts = dataset_id.split("_")
    if len(parts) >= 3 and parts[-2].count("-") == 2:
        return f"{parts[-2]} {parts[-1].replace('-', ':')}"
    return dataset_id


@router.get("/health")
def api_health() -> dict[str, Any]:
    latest_files = sorted(glob.glob(str(OUTPUT_DIR / "session_*.jsonl")))
    return {
        "status": "ok",
        "version": "3.0",
        "timestamp": datetime.now().isoformat(),
        "memory_file_exists": MEMORY_FILE.exists(),
        "output_dir_exists": OUTPUT_DIR.exists(),
        "latest_session_file": Path(latest_files[-1]).name if latest_files else None,
        "available_datasets": _available_dataset_ids(),
    }


@router.get("/datasets")
def api_datasets(format: str = Query(default="list")):
    datasets = _available_dataset_ids()
    expose_fusion = _should_expose_fusion_dataset(datasets)
    if format == "rich":
        items = [
            {
                "id": dataset_id,
                "label": dataset_id,
                "display": _make_display_name(dataset_id),
                "sources": [dataset_id],
            }
            for dataset_id in datasets
        ]
        if expose_fusion:
            items.append({
                "id": "fusion",
                "label": "fusion",
                "display": FUSION_LABEL,
                "sources": datasets,
            })
        return items
    if expose_fusion:
        return datasets + ["fusion"]
    return datasets


@router.get("/servers")
def api_servers(format: str = Query(default="list"), dataset: str | None = Query(default=None)):
    payload = _get_dataset_payload(dataset)
    if payload:
        server_ids = list(payload.get("server_ids") or [payload.get("dataset_id")])
        if format == "rich":
            return [
                {"id": sid, "label": sid, "display": _make_display_name(sid), "sources": [sid]}
                for sid in server_ids
            ]
        return server_ids
    return api_datasets(format=format)


@router.get("/prediction")
def api_prediction(dataset: str | None = Query(default=None)) -> dict[str, Any]:
    payload = _get_dataset_payload(dataset)
    if payload and isinstance(payload.get("prediction"), dict):
        return payload["prediction"]

    events = _latest_jsonl(dataset)
    prediction_event = _get_event(events, "PREDICTION_COMPUTED")
    if not prediction_event:
        return {
            "available": False,
            "prediction_score": 0,
            "flags": [],
            "predicted_events": [],
            "message": "Aucune prevision disponible.",
            "analysis_mode": "",
            "timeline_characteristics": {},
            "risk_evolution": [],
            "behavioral_analysis": {},
            "prevention_suggestions": [],
            "risk_level": "LOW",
            "signal_analysis": {},
            "explanations": [],
            "history": [],
        }
    return {
        "available": True,
        "prediction_score": int(prediction_event.get("prediction_score", 0) or 0),
        "flags": list(prediction_event.get("flags", []) or []),
        "predicted_events": list(prediction_event.get("predicted_events", []) or []),
        "message": str(prediction_event.get("message", "")),
        "analysis_mode": str(prediction_event.get("analysis_mode", "")),
        "timeline_characteristics": prediction_event.get("timeline_characteristics", {}),
        "risk_evolution": [
            {"time": h["timestamp"], "risk": h["score"], "failures": 0}
            for h in prediction_event.get("history", [])
        ],
        "behavioral_analysis": prediction_event.get("signal_analysis", {}),
        "prevention_suggestions": [],
        "risk_level": "LOW",
        "signal_analysis": prediction_event.get("signal_analysis", {}),
        "explanations": prediction_event.get("explanations", []),
        "history": prediction_event.get("history", []),
    }


@router.get("/kpis")
def api_kpis(
    servers: List[str] = Query(default=[]),
    dataset: str | None = Query(default=None),
) -> dict[str, Any]:
    cache_key = f"kpis::{dataset or 'default'}::{','.join(sorted(servers))}"
    def load():
        events = _latest_jsonl(dataset)
        memory = _load_memory(dataset)
        base = dict(_build_kpis(events, memory, dataset))
        if not servers:
            return base
        engines = _engines_for_servers(servers)
        if not engines:
            return base
        all_scores = _build_engine_scores(events, memory, dataset)
        base["nb_alarms"] = sum(int(s.get("alarms", 0)) for s in all_scores if s.get("engine") in engines)
        if "SSH" not in engines:
            base["ssh_failures"] = None
            base["blocked_ips"] = None
        return base
    return _cached(cache_key, load)


@router.get("/alarms")
def api_alarms(
    servers: List[str] = Query(default=[]),
    dataset: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    cache_key = f"alarms::{dataset or 'default'}::{','.join(sorted(servers))}"
    def load():
        alarms = _build_alarms(_load_memory(dataset), dataset)
        return _filter_alarms_by_servers(alarms, servers)
    return _cached(cache_key, load)


@router.get("/alarms/history")
def api_alarm_history(
    dataset: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    cache_key = f"alarm_history::{dataset or 'default'}::{severity or 'ALL'}::{offset}::{limit}"
    return _cached(
        cache_key,
        lambda: _build_alarm_history(dataset=dataset, severity=severity, offset=offset, limit=limit),
    )


@router.get("/engine-scores")
def api_engine_scores(
    servers: List[str] = Query(default=[]),
    dataset: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    cache_key = f"engine_scores::{dataset or 'default'}::{','.join(sorted(servers))}"
    def load():
        events = _latest_jsonl(dataset)
        memory = _load_memory(dataset)
        scores = _build_engine_scores(events, memory, dataset)
        if not servers:
            return scores
        engines = _engines_for_servers(servers)
        return [score for score in scores if str(score.get("engine", "")).upper() in engines]
    return _cached(cache_key, load)


@router.get("/sessions")
def api_sessions(dataset: str | None = Query(default=None)) -> list[dict[str, Any]]:
    return _cached(f"sessions::{dataset or 'default'}", lambda: _build_sessions(_load_memory(dataset), dataset))


@router.get("/threshold-history")
def api_threshold_history(dataset: str | None = Query(default=None)) -> list[dict[str, Any]]:
    return _cached(
        f"threshold_history::{dataset or 'default'}",
        lambda: _build_threshold_history(_load_memory(dataset), dataset),
    )


@router.get("/decisions")
def api_decisions(dataset: str | None = Query(default=None)) -> list[dict[str, Any]]:
    return _cached(
        f"decisions::{dataset or 'default'}",
        lambda: _build_decisions(_latest_jsonl(dataset), dataset),
    )


@router.get("/pipeline/latest")
def api_pipeline_latest(dataset: str | None = Query(default=None)) -> dict[str, Any]:
    def load():
        payload = _get_dataset_payload(dataset)
        if payload:
            return {
                "events": [e for e in payload.get("events", []) if isinstance(e, dict)][-150:],
                "log_lines": list(payload.get("log_lines", []))[-60:],
                "step_count": len(payload.get("events", [])),
            }
        events = _latest_jsonl(dataset)
        return {
            "events": [e for e in events if isinstance(e, dict)][-150:],
            "log_lines": _build_log_lines(events, dataset)[-60:],
            "step_count": len(events),
        }
    return _cached(f"pipeline_latest::{dataset or 'default'}", load)


@router.get("/trust")
def api_trust(dataset: str | None = Query(default=None)) -> dict[str, Any]:
    return _cached(f"trust::{dataset or 'default'}", lambda: _build_trust(_latest_jsonl(dataset), dataset))


@router.get("/explainability")
def api_explainability(dataset: str | None = Query(default=None)) -> dict[str, Any]:
    return _cached(
        f"explainability::{dataset or 'default'}",
        lambda: _build_explainability(_latest_jsonl(dataset), _load_memory(dataset), dataset),
    )


@router.get("/gate-history")
def api_gate_history(dataset: str | None = Query(default=None)) -> list[dict[str, Any]]:
    memory = _load_memory(dataset)
    return list(reversed(memory.get("gate_history", [])[-20:]))


@router.get("/data-quality")
def api_data_quality(dataset: str | None = Query(default=None)) -> dict[str, Any]:
    return _cached(
        f"data_quality::{dataset or 'default'}",
        lambda: _build_data_quality(_latest_jsonl(dataset), dataset),
    )


@router.get("/memory")
def api_memory(dataset: str | None = Query(default=None)) -> dict[str, Any]:
    return _cached(f"memory::{dataset or 'default'}", lambda: _load_memory(dataset))


@router.get("/suspicious-ips")
def api_suspicious_ips(dataset: str | None = Query(default=None)) -> dict[str, Any]:
    memory = _load_memory(dataset)
    return {"ips": memory.get("ips_suspectes", [])}


@router.get("/logs/stream")
def api_logs_stream(dataset: str | None = Query(default=None)) -> dict[str, Any]:
    return {
        "lines": _build_log_lines(_latest_jsonl(dataset), dataset)[-60:],
    }


@router.get("/backtest-history")
def api_backtest_history(dataset: str | None = Query(default=None)) -> list[dict[str, Any]]:
    payload = _get_dataset_payload(dataset)
    if payload and isinstance(payload.get("backtest_history"), list):
        return payload["backtest_history"]
    memory = _load_memory(dataset)
    return list(reversed(memory.get("backtest_history", [])))


def _push_minimization_point(nb_alarmes: int, health_score: float = 100.0, dataset_id: str | None = None) -> None:
    selected = _resolve_selected_dataset(dataset_id)
    if not selected:
        return
    payload = PIPELINE_RESULTS.get(selected)
    if not payload:
        return
    payload.setdefault("minimization", []).append({
        "timestamp": datetime.now().strftime("%H:%M:%S"),
        "alarmes": nb_alarmes,
        "risque": max(0, round(100 - health_score, 1)),
    })
    payload["minimization"] = payload["minimization"][-20:]


@router.get("/minimization")
def api_minimization(dataset: str | None = Query(default=None)) -> list[dict[str, Any]]:
    payload = _get_dataset_payload(dataset)
    if payload and isinstance(payload.get("minimization"), list):
        return payload["minimization"]
    memory = _load_memory(dataset)
    series = []
    for session in memory.get("sessions", [])[-20:]:
        data = session.get("donnees", {})
        try:
            timestamp = datetime.fromisoformat(session.get("date", "")).strftime("%H:%M")
        except Exception:
            timestamp = "?"
        health = float(data.get("health_score", 100) or 100)
        series.append({
            "timestamp": timestamp,
            "alarmes": int(data.get("nb_alarmes_final", 0) or 0),
            "risque": max(0, round(100 - health, 1)),
        })
    return series


@router.get("/fusion/summary")
def api_fusion_summary() -> dict[str, Any]:
    payload = PIPELINE_RESULTS.get(LEGACY_MERGED_DATASET)
    if not payload:
        raise HTTPException(status_code=404, detail="Fusion view not available")
    return dict(payload.get("fusion") or {})
