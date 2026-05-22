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
