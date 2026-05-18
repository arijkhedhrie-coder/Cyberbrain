# dashboard_routes.py
# ─────────────────────────────────────────────────────────────
from __future__ import annotations

from typing import List
from fastapi import APIRouter, Query

import glob
import json
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path

# ── Cache ─────────────────────────────────────────────────────
_cache: dict = {}
_cache_lock = threading.Lock()
_CACHE_TTL = 30  # secondes

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

# ── Chemins ───────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parents[3]   
MEMORY_FILE  = PROJECT_ROOT / "app" / "long_term_memory.json"
OUTPUT_DIR   = PROJECT_ROOT / "app" / "output"

# ── Fonctions utilitaires ─────────────────────────────────────
def _as_float_or_none(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None

def _load_memory() -> dict:
    if not MEMORY_FILE.exists():
        return {}
    try:
        with open(MEMORY_FILE, "r", encoding="utf-8", errors="replace") as f:
            return json.load(f)
    except Exception:
        return {}

def _latest_jsonl() -> list:
    files = sorted(glob.glob(str(OUTPUT_DIR / "session_*.jsonl")))
    if not files:
        return []
    events = []
    try:
        with open(files[-1], "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        events.append(json.loads(line))
                    except Exception:
                        pass
    except Exception:
        pass
    return events

def _get_event(events: list, event_type: str) -> dict:
    for e in events:
        if isinstance(e, dict) and e.get("event_type") == event_type:
            return e
    return {}

def _build_kpis(events: list, memory: dict) -> dict:
    """Construit les KPIs depuis les events JSONL et la mémoire."""
    sessions = memory.get("sessions", [])
    last = sessions[-1].get("donnees", {}) if sessions else {}

    metrics   = _get_event(events, "METRICS_COMPUTED")
    pass1     = _get_event(events, "PASS1_COMPLETE")
    trust_ev  = _get_event(events, "TRUST_COMPUTED")

    health_score = _as_float_or_none(
        metrics.get("health_score") or last.get("health_score")
    ) or 100.0

    nb_alarms    = int(pass1.get("alarms", 0) or last.get("nb_alarmes_final", 0))
    alert_status = metrics.get("alert_status") or last.get("agent_threat_level", "NORMAL")

    return {
        "health_score":          health_score,
        "health_status":         "HEALTHY" if health_score >= 90 else ("WARNING" if health_score >= 70 else "CRITICAL"),
        "alert_status":          alert_status,
        "nb_alarms":             nb_alarms,
        "ssh_failures":          int(last.get("ssh_failures", 0)),
        "blocked_ips":           int(last.get("blocked_ips", 0)),
        "unique_attacking_ips":  int(metrics.get("unique_ips", 0) or last.get("unique_attacking_ips", 0)),
        "attack_velocity":       float(metrics.get("velocity", 0.0) or 0.0),
        "is_velocity_spike":     bool(metrics.get("velocity_spike", False)),
        "attack_pattern":        metrics.get("attack_pattern") or last.get("attack_pattern", ""),
        "entropy":               _as_float_or_none(metrics.get("entropy")),
        "trust_score":           _as_float_or_none(
            trust_ev.get("confidence_in_metrics") or trust_ev.get("confidence")
        ),
        "trust_label":           trust_ev.get("confidence_label") or trust_ev.get("label", ""),
        "row_count":      int(metrics.get("row_count", 0) or last.get("lines_analyzed", 0)),
        "deduped_count":  int(metrics.get("dedup_count", 0) or last.get("dedup_count", 0)),
        "lines_analyzed": int(metrics.get("row_count", 0) or last.get("lines_analyzed", 0)),
        "dedup_count":    int(metrics.get("dedup_count", 0) or last.get("dedup_count", 0)),
    }

def _build_alarms(memory: dict) -> list:
    """Extrait les alarmes depuis la mémoire long terme."""
    sessions = memory.get("sessions", [])
    if not sessions:
        return []
    donnees = sessions[-1].get("donnees", {})
    alarmes = donnees.get("alarmes", [])
    if not isinstance(alarmes, list):
        return []
    result = []
    for a in alarmes:
        if isinstance(a, dict):
            result.append(a)
    return result

def _build_engine_scores(events: list, memory: dict) -> list:
    """Construit les scores par moteur depuis les events JSONL.
       Utilise threshold_snapshots de l'événement SESSION_SUMMARY pour
       obtenir les seuils réels du Pass 1 et du Pass 2.
    """
    # 1. Récupérer l'événement SESSION_SUMMARY (le dernier de la session)
    summary = _get_event(events, "SESSION_SUMMARY")
    snapshots = summary.get("threshold_snapshots", [])
    
    # snapshots[0] = Pass 1, snapshots[1] = Pass 2 (s'il existe)
    pass1_snap = snapshots[0] if snapshots else {}
    pass2_snap = snapshots[1] if len(snapshots) > 1 else pass1_snap
    
    # 2. Compter les alarmes par domaine (toujours depuis PASS1_COMPLETE,
    #    car c'est le décompte final après fusion éventuelle)
    pass1_event = _get_event(events, "PASS1_COMPLETE")
    by_domain = pass1_event.get("alarms_by_domain", {})
    
    engines = ["SSH", "WEB", "FTP", "KERNEL", "SESSION"]
    result = []
    
    for eng in engines:
        count = int(by_domain.get(eng, 0))
        eng_lower = eng.lower()
        
        # Seuils depuis les snapshots (valeurs par défaut si absentes)
        pass1_thresh = pass1_snap.get(f"{eng_lower}_high", 50)
        pass2_thresh = pass2_snap.get(f"{eng_lower}_high", pass1_thresh)
        
        # Statut ALARM si count > seuil du Pass 1 (cohérence avec l'affichage)
        status = "ALARM" if count > pass1_thresh else "CLEAR"
        rerun_p2 = bool(pass2_snap.get("rerun_engines"))  # ou vérifier si pass2_thresh != pass1_thresh
        
        result.append({
            "engine": eng,
            "alarms": count,
            "score": min(100, count * 5),
            "pass1": pass1_thresh,
            "pass2": pass2_thresh,
            "status": status,
            "rerun_p2": rerun_p2,
        })
    
    return result

def _build_decisions(events: list, memory: dict) -> list:
    """Extrait les décisions agents depuis les events JSONL."""
    decisions = []
    for e in events:
        if isinstance(e, dict) and e.get("event_type") in (
            "DYNAMIC_CONFIG_DEFAULT", "DYNAMIC_CONFIG_APPLIED", "AGENTS_COMPLETE"
        ):
            decisions.append(e)
    return decisions[-20:]

def _build_log_lines(events: list) -> list:
    """Extrait les lignes de log lisibles depuis les events."""
    lines = []
    for e in events:
        if not isinstance(e, dict):
            continue
        ev = e.get("event_type", "")
        ts = e.get("ts", e.get("timestamp", ""))
        msg = e.get("message") or e.get("msg") or ev
        if msg:
            lines.append(f"[{ts}] {msg}" if ts else msg)
    return lines

def _build_trust(events: list) -> dict:
    """Extrait le trust gate depuis les events."""
    trust_ev = _get_event(events, "TRUST_COMPUTED")
    if not trust_ev:
        return {
            "available":             False,
            "model_agreement":       None,
            "false_positive_rate":   None,
            "drift_score":           None,
            "drift_label":           "N/A",
            "drift_flagged":         False,
            "stability":             "N/A",
            "stable_signals":        None,
            "noise_ratio":           None,
            "ml_score_weight":       None,
            "confidence_in_metrics": None,
            "confidence_label":      "N/A",
            "signals_summary":       "No TRUST_COMPUTED event found — run the pipeline once.",
            "timestamp":             "",
        }

    return {
        "available":             True,
        "model_agreement":       _as_float_or_none(trust_ev.get("model_agreement")),
        "false_positive_rate":   _as_float_or_none(trust_ev.get("false_positive_rate")),
        "drift_score":           _as_float_or_none(trust_ev.get("drift_score")),
        "drift_label":           trust_ev.get("drift_label", trust_ev.get("drift", "UNKNOWN")),
        "drift_flagged":         bool(trust_ev.get("drift_flagged", False)),
        "stability":             trust_ev.get("stability", ""),
        "stable_signals":        trust_ev.get("stable_signals"),
        "noise_ratio":           trust_ev.get("noise_ratio"),
        "ml_score_weight":       trust_ev.get("ml_score_weight"),
        "confidence_in_metrics": _as_float_or_none(
            trust_ev.get("confidence_in_metrics") or trust_ev.get("confidence")
        ),
        "confidence_label":      trust_ev.get("confidence_label") or trust_ev.get("label", "UNKNOWN"),
        "signals_summary":       trust_ev.get("signals_summary", ""),
        "timestamp":             trust_ev.get("timestamp", ""),
    }

def _build_gate_history() -> list:
    """Lit l'historique des gates depuis la mémoire."""
    mem = _load_memory()
    return list(reversed(mem.get("gate_history", [])[-20:]))

def _build_data_quality(events: list) -> dict:
    """Extrait les métriques qualité données depuis les events."""
    pipeline_start = _get_event(events, "PIPELINE_START")
    metrics        = _get_event(events, "METRICS_COMPUTED")
    return {
        "raw_rows":    int(metrics.get("raw_rows", 0)),
        "dedup_rows":  int(metrics.get("dedup_count", 0)),
        "noise_pct":   _as_float_or_none(metrics.get("noise_pct")),
        "ml_weight":   _as_float_or_none(metrics.get("ml_weight")),
        "data_sources": pipeline_start.get("data_sources", []),
    }

# ── Router ────────────────────────────────────────────────────

router = APIRouter(prefix="/api", tags=["dashboard"])

# ── Mapping label frontend → moteurs backend ──────────────────
_LABEL_TO_ENGINES: dict[str, list[str]] = {
    "auth":   ["SSH"],
    "web":    ["WEB"],
    "ftp":    ["FTP"],
    "kernel": ["KERNEL", "SESSION"],
}

_LABEL_DISPLAY: dict[str, str] = {
    "auth":   "SSH Auth",
    "web":    "Web Server",
    "ftp":    "FTP Server",
    "kernel": "Kernel/Sys",
}

_S3_KEYWORD_TO_LABEL: list[tuple[str, str]] = [
    ("sshd",    "auth"), ("auth",   "auth"), ("secure", "auth"), ("ssh",    "auth"),
    ("nginx",   "web"),  ("apache", "web"),  ("access", "web"),  ("http",   "web"),  ("web",    "web"),
    ("vsftpd",  "ftp"),  ("xferlog","ftp"),  ("xfer",   "ftp"),  ("ftp",    "ftp"),
    ("kern",    "kernel"),("dmesg", "kernel"),("syslog","kernel"),("system","kernel"),("kernel","kernel"),
]

_VALID_LABELS = set(_LABEL_TO_ENGINES.keys())

def _s3_id_to_label(server_id: str) -> str | None:
    lower = server_id.lower()
    for keyword, label in _S3_KEYWORD_TO_LABEL:
        if keyword in lower:
            return label
    return None

def _engines_for_servers(servers: list[str]) -> set[str]:
    engines: set[str] = set()
    for s in servers:
        label = s.lower()
        if label in _LABEL_TO_ENGINES:
            engines.update(_LABEL_TO_ENGINES[label])
        else:
            inferred = _s3_id_to_label(s)
            if inferred:
                engines.update(_LABEL_TO_ENGINES[inferred])
            else:
                print(f"[WARN][api_dashboard] Unknown server label: '{s}' — ignoré")
    return engines

# ── /api/health ───────────────────────────────────────────────
@router.get("/health")
def api_health() -> dict:
    latest_files = sorted(glob.glob(str(OUTPUT_DIR / "session_*.jsonl")))
    return {
        "status":              "ok",
        "version":             "2.0",
        "timestamp":           datetime.now().isoformat(),
        "memory_file_exists":  MEMORY_FILE.exists(),
        "output_dir_exists":   OUTPUT_DIR.exists(),
        "latest_session_file": Path(latest_files[-1]).name if latest_files else None,
    }


@router.get("/prediction")
@router.get("/prediction")
def api_prediction() -> dict:
    events = _latest_jsonl()
    prediction_event = _get_event(events, "PREDICTION_COMPUTED")

    if not prediction_event:
        return {
            "available": False,
            "prediction_score": 0,
            "flags": [],
            "predicted_events": [],
            "message": "Aucune prévision disponible – exécutez le pipeline.",
            "risk_evolution": [],
            "behavioral_analysis": {},
            "prevention_suggestions": [],
            "risk_level": "LOW",
            "signal_analysis": {},
            "explanations": [],
            "history": [],
        }

    signals = prediction_event.get("signals", {})
    prediction_score = int(prediction_event.get("prediction_score", 0) or 0)

    # Risk evolution from history
    history = prediction_event.get("history", [])
    risk_evolution = [
        {"time": h["timestamp"], "risk": h["score"], "failures": 0}
        for h in history
    ]

    # Behavioral analysis from signal_analysis
    signal_analysis = prediction_event.get("signal_analysis", {})
    behavioral_analysis = {
        "ssh_failures_trend": signal_analysis.get("failures", {}).get("trend_ratio", 1.0),
        "unique_ips_trend": signal_analysis.get("unique_ips", {}).get("trend_ratio", 1.0),
        "username_diversity": signal_analysis.get("usernames", {}).get("last", 0),
        "ftp_activity": signal_analysis.get("ftp_events", {}).get("last", 0),
        "kernel_errors": signal_analysis.get("kernel_errors", {}).get("last", 0),
    }

    # Prevention suggestions based on flags
    flags = list(prediction_event.get("flags", []) or [])
    prevention_suggestions = []
    if "BOTNET_WARMUP" in flags:
        prevention_suggestions.append("Augmenter la surveillance des IPs multiples")
    if "SPRAY_PHASE" in flags:
        prevention_suggestions.append("Activer le rate limiting sur SSH")
    if "CRASH_COMING" in flags:
        prevention_suggestions.append("Vérifier la charge système et redémarrer si nécessaire")
    if "DATA_EXFIL_START" in flags:
        prevention_suggestions.append("Bloquer les transferts FTP suspects")

    risk_level = "LOW"
    if prediction_score >= 70:
        risk_level = "CRITICAL"
    elif prediction_score >= 40:
        risk_level = "HIGH"
    elif prediction_score >= 20:
        risk_level = "MEDIUM"

    return {
        "available": True,
        "prediction_score": prediction_score,
        "flags": flags,
        "predicted_events": list(prediction_event.get("predicted_events", []) or []),
        "message": str(prediction_event.get("message", "Prévision calculée")),
        "risk_evolution": risk_evolution,
        "behavioral_analysis": behavioral_analysis,
        "prevention_suggestions": prevention_suggestions,
        "risk_level": risk_level,
        "signal_analysis": signal_analysis,
        "explanations": prediction_event.get("explanations", []),
        "history": history,
    }
# ── /api/servers ──────────────────────────────────────────────
@router.get("/servers")
def api_servers(format: str = Query(default="list")) -> list:
    memory   = _load_memory()
    sessions = memory.get("sessions", [])
    raw_ids: list[str] = []

    if sessions:
        donnees = sessions[-1].get("donnees", {})
        for key in ("serveurs_actifs", "server_ids"):
            s = donnees.get(key)
            if isinstance(s, list) and s:
                raw_ids = [str(x) for x in s if x]
                break
        if not raw_ids:
            alarmes = donnees.get("alarmes", [])
            if isinstance(alarmes, list):
                seen: set[str] = set()
                for a in alarmes:
                    if isinstance(a, dict):
                        sid = a.get("server_id") or a.get("Serveur")
                        if sid:
                            seen.add(str(sid))
                if seen:
                    raw_ids = sorted(seen)

    if not raw_ids:
        try:
            events = _latest_jsonl()
            ps = _get_event(events, "PIPELINE_START")
            sources = ps.get("data_sources", [])
            if isinstance(sources, list) and sources:
                raw_ids = [str(s) for s in sources if s]
        except Exception:
            pass

    labels_found: set[str] = set()

    for raw_id in raw_ids:
        if raw_id.lower() in _VALID_LABELS:
            labels_found.add(raw_id.lower())
        else:
            inferred = _s3_id_to_label(raw_id)
            if inferred:
                labels_found.add(inferred)

    if not labels_found:
        _ENGINE_TO_LABEL_LOCAL = {
            "SSH": "auth", "WEB": "web", "FTP": "ftp",
            "KERNEL": "kernel", "SESSION": "kernel",
            "PREDICTION": "kernel", "CORRELATION": "auth",
        }
        try:
            all_alarms = _build_alarms(_load_memory())
            for a in all_alarms:
                engine = str(a.get("engine") or "").upper()
                label  = _ENGINE_TO_LABEL_LOCAL.get(engine, "")
                if label:
                    labels_found.add(label)
        except Exception as e:
            print(f"[WARN][api_dashboard] Fallback alarmes échoué: {e}")

    if not labels_found:
        try:
            events  = _latest_jsonl()
            scores  = _build_engine_scores(events, _load_memory())
            active  = {str(s.get("engine", "")).upper() for s in scores if s.get("engine")}
            for label, engs in _LABEL_TO_ENGINES.items():
                if any(e in active for e in engs):
                    labels_found.add(label)
        except Exception as e:
            print(f"[WARN][api_dashboard] Fallback engine-scores échoué: {e}")

    if not labels_found:
        return []

    ordered = [l for l in ["auth", "web", "ftp", "kernel"] if l in labels_found]
    ordered += sorted(labels_found - set(ordered))

    if format == "rich":
        return [{"id": l, "label": l, "display": _LABEL_DISPLAY.get(l, l), "sources": [l]} for l in ordered]
    return ordered

# ── /api/kpis ─────────────────────────────────────────────────
@router.get("/kpis")
def api_kpis(servers: List[str] = Query(default=[])) -> dict:
    def load_all():
        return _build_kpis(_latest_jsonl(), _load_memory())

    if not servers:
        return _cached("kpis", load_all)

    engines   = _engines_for_servers(servers)
    cache_key = f"kpis_{'_'.join(sorted(servers))}"

    def load_filtered():
        events = _latest_jsonl()
        base   = _build_kpis(events, _load_memory())
        if not engines:
            return base
        if "SSH" not in engines:
            base["ssh_failures"] = None
            base["blocked_ips"]  = None
        pass1  = _get_event(events, "PASS1_COMPLETE")
        by_dom = pass1.get("alarms_by_domain", {})
        active = {eng for eng in engines if int(by_dom.get(eng, 0)) > 0}
        if not active:
            base.update({
                "ssh_failures": 0, "blocked_ips": 0,
                "alert_status": "CLEAR", "health_score": 100.0,
                "unique_attacking_ips": 0, "attack_velocity": 0.0,
                "is_velocity_spike": False,
            })
        return base

    return _cached(cache_key, load_filtered)

# ── Filtre alarmes ─────────────────────────────────────────────
_ENGINE_TO_LABEL: dict[str, str] = {
    "SSH": "auth", "WEB": "web", "FTP": "ftp",
    "KERNEL": "kernel", "SESSION": "kernel",
    "PREDICTION": "kernel", "CORRELATION": "auth",
}

def _filter_alarms_by_servers(all_alarms: list[dict], servers: list[str]) -> list[dict]:
    servers_set = {s.lower() for s in servers}
    result = []
    for a in all_alarms:
        sid = str(a.get("server_id") or "").lower()
        if sid and sid in servers_set:
            result.append(a)
            continue
        engine = str(a.get("engine") or "").upper()
        label  = _ENGINE_TO_LABEL.get(engine, "")
        if label and label in servers_set:
            result.append(a)
    return result

# ── /api/alarms ───────────────────────────────────────────────
@router.get("/alarms")
def api_alarms(servers: List[str] = Query(default=[])) -> list:
    def load_all():
        return _build_alarms(_load_memory())
    if not servers:
        return _cached("alarms", load_all)
    cache_key = f"alarms_{'_'.join(sorted(servers))}"
    def load_filtered():
        return _filter_alarms_by_servers(_build_alarms(_load_memory()), servers)
    return _cached(cache_key, load_filtered)

# ── /api/engine-scores ────────────────────────────────────────
@router.get("/engine-scores")
def api_engine_scores(servers: List[str] = Query(default=[])) -> list:
    def load_all():
        return _build_engine_scores(_latest_jsonl(), _load_memory())
    if not servers:
        return _cached("engine_scores", load_all)
    engines   = _engines_for_servers(servers)
    cache_key = f"engine_scores_{'_'.join(sorted(servers))}"
    def load_filtered():
        all_scores = _build_engine_scores(_latest_jsonl(), _load_memory())
        if not engines:
            return all_scores
        return [s for s in all_scores if s.get("engine", "").upper() in engines]
    return _cached(cache_key, load_filtered)

# ── /api/sessions ─────────────────────────────────────────────
@router.get("/sessions")
def api_sessions() -> list:
    def load():
        mem  = _load_memory()
        sess = mem.get("sessions", [])
        result = []
        for s in reversed(sess[-20:]):
            d = s.get("donnees", {})
            result.append({
                "date":            s.get("date", ""),
                "threat_level":    d.get("agent_threat_level", "NORMAL"),
                "nb_alarms_pass1": d.get("nb_alarmes_pass1", 0),
                "nb_alarms_final": d.get("nb_alarmes_final", 0),
                "pass2_ran":       bool(d.get("pass2_ran", False)),
                "health_score":    _as_float_or_none(d.get("health_score")),
                "ips_suspectes":   d.get("ips_suspectes", []),
                "attack_pattern":  d.get("attack_pattern", ""),
            })
        return result
    return _cached("sessions", load)

# ── /api/decisions ────────────────────────────────────────────
@router.get("/decisions")
def api_decisions() -> list:
    def load():
        return _build_decisions(_latest_jsonl(), _load_memory())
    return _cached("decisions", load)

# ── /api/pipeline/latest ──────────────────────────────────────
@router.get("/pipeline/latest")
def api_pipeline_latest() -> dict:
    def load():
        events = _latest_jsonl()
        return {
            "events":     [e for e in events if isinstance(e, dict)][-150:],
            "log_lines":  _build_log_lines(events)[-60:],
            "step_count": len(events),
        }
    return _cached("pipeline_latest", load)

# ── /api/trust ────────────────────────────────────────────────
@router.get("/trust")
def api_trust() -> dict:
    def load():
        return _build_trust(_latest_jsonl())
    return _cached("trust", load)

# ── /api/gate-history ─────────────────────────────────────────
@router.get("/gate-history")
def api_gate_history() -> list:
    def load():
        return _build_gate_history()
    return _cached("gate_history", load)

# ── /api/data-quality ─────────────────────────────────────────
@router.get("/data-quality")
def api_data_quality() -> dict:
    def load():
        return _build_data_quality(_latest_jsonl())
    return _cached("data_quality", load)

# ── /api/memory ───────────────────────────────────────────────
@router.get("/memory")
def api_memory() -> dict:
    def load():
        return _load_memory()
    return _cached("memory", load)

# ── /api/suspicious-ips ───────────────────────────────────────
@router.get("/suspicious-ips")
def api_suspicious_ips() -> dict:
    def load():
        return {"ips": _load_memory().get("ips_suspectes", [])}
    return _cached("suspicious_ips", load)

# ── /api/logs/stream ──────────────────────────────────────────
@router.get("/logs/stream")
def api_logs_stream() -> dict:
    def load():
        return {"lines": _build_log_lines(_latest_jsonl())[-60:]}
    return _cached("logs", load)

# ── /api/backtest-history ─────────────────────────────────────
@router.get("/backtest-history")
def api_backtest_history() -> list:
    def load():
        return list(reversed(_load_memory().get("backtest_history", [])))
    return _cached("backtest_history", load)

# ── Minimization (buffer temps-réel) ──────────────────────────
_MINIMIZATION_BUFFER: deque = deque(maxlen=20)

def _push_minimization_point(nb_alarmes: int, health_score: float = 100.0) -> None:
    _MINIMIZATION_BUFFER.append({
        "timestamp": datetime.now().strftime("%H:%M:%S"),
        "alarmes":   nb_alarmes,
        "risque":    max(0, round(100 - health_score, 1)),
    })

@router.get("/minimization")
def api_minimization() -> list:
    if _MINIMIZATION_BUFFER:
        return list(_MINIMIZATION_BUFFER)
    mem = _load_memory()
    sessions = mem.get("sessions", [])[-20:]
    series = []
    for s in sessions:
        d = s.get("donnees", {})
        nb  = d.get("nb_alarmes_final", d.get("nb_anomalies", 0))
        hs  = d.get("health_score", 100.0)
        try:
            t = datetime.fromisoformat(s.get("date", "")).strftime("%H:%M")
        except Exception:
            t = "?"
        series.append({
            "timestamp": t,
            "alarmes":   int(nb) if nb is not None else 0,
            "risque":    max(0, round(100 - float(hs or 100), 1)),
        })
    return series
