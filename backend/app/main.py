from __future__ import annotations

import io
import json
import logging
import os
import sys
import time
import inspect
import re as _re
from datetime import datetime
from typing import Any
from app.core.fusion_view import build_fusion_payload
from app.core.pipeline_store import AVAILABLE_DATASETS, LEGACY_MERGED_DATASET, PIPELINE_RESULTS

if __name__ == "__main__" and "--backtest" in sys.argv:
    import argparse

    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    parser = argparse.ArgumentParser(description="IDPS Pipeline")
    parser.add_argument("--backtest", action="store_true")
    parser.add_argument("--sessions", type=int, default=3)
    args, _ = parser.parse_known_args()

    if args.backtest:
        from app.ai.engines.backtester import main_backtest

        main_backtest(n_sessions=args.sessions)
        raise SystemExit(0)

import requests as _req
import boto3
import pandas as pd
from botocore.config import Config as BotoConfig
from dotenv import load_dotenv
from collections import deque
# CORRECTION 1 : chemin complet vers crewai_compat (app/ai/tools/)
from app.ai.tools.crewai_compat import patch_legacy_rag_storage_for_ollama

# ─────────────────────────────────────────────────────────────────────────────
# UTF-8 console (Windows)
# ─────────────────────────────────────────────────────────────────────────────
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────
LOG = logging.getLogger("main")
if not LOG.handlers:
    h = logging.StreamHandler()
    h.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
    LOG.addHandler(h)
LOG.setLevel(logging.INFO)

CREW_VERBOSE = os.getenv("CREWAI_VERBOSE", "false").lower() == "true"
LOW_SEVERITY_CREW_SKIP = os.getenv("LOW_SEVERITY_CREW_SKIP", "true").lower() == "true"
LLM_MIN_DELAY_SECONDS = max(0.0, float(os.getenv("LLM_MIN_DELAY_SECONDS", "3.0")))
LLM_RATE_LIMIT_BACKOFF_SECONDS = max(1.0, float(os.getenv("LLM_RATE_LIMIT_BACKOFF_SECONDS", "6.0")))
LLM_TRANSPORT_BACKOFF_SECONDS = max(1.0, float(os.getenv("LLM_TRANSPORT_BACKOFF_SECONDS", "4.0")))

os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
os.environ.setdefault("LANGCHAIN_TRACING_V2", "false")
os.environ.setdefault("LANGSMITH_TRACING", "false")
os.environ.setdefault("OTEL_LOG_LEVEL", "ERROR")
os.environ.setdefault("LITELLM_VERBOSE", "false")

# ─────────────────────────────────────────────────────────────────────────────
# CrewAI storage
# ─────────────────────────────────────────────────────────────────────────────
if "CREWAI_STORAGE_DIR" not in os.environ:
    os.environ["CREWAI_STORAGE_DIR"] = os.path.join(os.getcwd(), ".crewai")
os.makedirs(os.environ["CREWAI_STORAGE_DIR"], exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# FIX SSL / HTTP2
# ─────────────────────────────────────────────────────────────────────────────
try:
    import httpx
    import litellm

    litellm.client_session = httpx.Client(verify=True, http2=False, timeout=60.0)
    LOG.info("Fix SSL appliqué — HTTP/2 désactivé, timeout=60s")
except Exception as e:
    LOG.warning("Fix SSL non appliqué: %s: %s", type(e).__name__, e)

# ─────────────────────────────────────────────────────────────────────────────
# Patch Chroma/Ollama (best-effort)
# ─────────────────────────────────────────────────────────────────────────────
try:
    from chromadb.utils.embedding_functions.ollama_embedding_function import OllamaEmbeddingFunction
    import crewai.rag.chromadb.config as _chroma_cfg

    def _ollama_ef():
        return OllamaEmbeddingFunction(
            model_name="nomic-embed-text",
            url="http://localhost:11434/api/embeddings",
        )

    _chroma_cfg.ChromaDBConfig._default_embedding_function = staticmethod(_ollama_ef)
    LOG.info("Patch ChromaDB Ollama appliqué")
except Exception as e:
    LOG.warning("Patch ChromaDB ignoré: %s: %s", type(e).__name__, e)

_rag_patch_status, _rag_patch_detail = patch_legacy_rag_storage_for_ollama()
if _rag_patch_status == "applied":
    LOG.info("Patch RAGStorage Ollama appliqué")
elif _rag_patch_status == "skipped":
    LOG.info("Patch RAGStorage ignoré: %s", _rag_patch_detail)
else:
    LOG.warning("Patch RAGStorage ignoré: %s", _rag_patch_detail)

# ─────────────────────────────────────────────────────────────────────────────
# WebSocket bridge
# CORRECTION 2 : api_auth n'existe pas à la racine — les fonctions broadcast
# sont définies dans app/api/routes/auth.py
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# WebSocket bridge
# ─────────────────────────────────────────────────────────────────────────────
try:
    from app.core.websocket_broadcast import broadcast_activity, broadcast_alarm, broadcast_log, broadcast_metrics
    WS_ENABLED = True
    LOG.info("[WS] broadcast functions loaded from central module")
except ImportError as _ws_import_err:
    WS_ENABLED = False
    LOG.warning("[WS] Central broadcast module not available: %s", _ws_import_err)

    # Optional HTTP fallback – disabled by default (set WS_FALLBACK_ENABLED=true to enable)
    FALLBACK_ENABLED = os.getenv("WS_FALLBACK_ENABLED", "false").lower() == "true"

    def _http_post(endpoint: str, data: dict) -> None:
        if not FALLBACK_ENABLED:
            return
        try:
            import requests as _r
            _r.post(f"http://localhost:8000/api/internal/{endpoint}", json=data, timeout=2)
        except Exception as e:
            LOG.warning("[WS] HTTP fallback to %s failed: %s", endpoint, e)

    def broadcast_alarm(
        raw_alarm: dict,
        stage: str = "pass1",
        server_id: str = "server1",
        dataset_id: str = "",
    ) -> None:
        _http_post("broadcast-alarm", {
            "alarm": raw_alarm,
            "stage": stage,
            "server_id": server_id,
            "dataset_id": dataset_id,
        })

    def broadcast_log(data: dict) -> None:
        _http_post("broadcast-log", data)

    def broadcast_metrics(data: dict) -> None:
        _http_post("broadcast-metrics", data)

    def broadcast_activity(data: dict) -> None:
        return

    if FALLBACK_ENABLED:
        LOG.info("[WS] HTTP fallback enabled (endpoints must exist in FastAPI).")
    else:
        LOG.info("[WS] No fallback – broadcasts will be ignored in this process.")
# ─────────────────────────────────────────────────────────────────────────────
# Imports métier
# ─────────────────────────────────────────────────────────────────────────────

# OK — app/services/metriques.py
from app.services.metriques import (
    calculer_metriques,
    get_summary_for_detector,
    compute_drift_score,
    classify_attack_profile,
)
from app.core import event_store

# OK — app/storage/upload_s3.py
from app.storage.upload_s3 import (
    sauvegarder_localement,
    uploader_vers_s3,
)

# OK — app/ai/agents/memory.py
from app.ai.agents.memory import (
    sauvegarder_memoire,
    charger_memoire,
    get_contexte_historique,
    compute_session_stability,
    get_memory_file,
    reset_active_dataset,
    set_active_dataset,
)

# Shared dynamic-config contract between the orchestrator and bridge.
from app.core.config.hybrid_config import DynamicConfig

# CORRECTION 4 : ip_profiler n'est pas à la racine de app/
# → app/services/ip_profiler.py
from app.services.ip_profiler import (
    dedup_logs,
    build_ip_profiles,
    data_quality_label,
    noise_score_weight,
)

# CORRECTION 5 : performance_engine est dans app/ai/engines/
from app.ai.engines.performance_engine import compute_trust

# ─────────────────────────────────────────────────────────────────────────────
# Détection — fallback chaîné
# CORRECTION 6 : ml_engine_bridge et anomaly_detection sont dans leurs
# sous-dossiers respectifs, pas à la racine de app/
# ─────────────────────────────────────────────────────────────────────────────
_detect_fn = None
_get_agent_inputs_fn = None
_retrain_fn = None

_err_ml: BaseException | None = None
try:
    # CORRECTION 6a : ml_engine_bridge → app/ai/engines/
    from app.ai.engines.ml_engine_bridge import detecter_anomalies as _detect_fn
    from app.ai.engines.ml_engine_bridge import get_agent_inputs as _get_agent_inputs_fn
    from app.ai.engines.ml_engine_bridge import reentralner_avec_nouveaux_logs as _retrain_fn
except Exception as e:
    _err_ml = e
    _err_ad: BaseException | None = None
    try:
        # CORRECTION 6b : anomaly_detection → app/ai/agents/
        from app.ai.engines.anomaly_detection import detecter_anomalies as _detect_fn
        from app.ai.engines.anomaly_detection import reentralner_avec_nouveaux_logs as _retrain_fn

        def _get_agent_inputs_fn(alarmes, anomalies):
            return {
                "nb_anomalies": str(len(anomalies) if isinstance(anomalies, pd.DataFrame) else 0),
                "alarmes_resumees": (
                    json.dumps(alarmes[:5], ensure_ascii=False)
                    if isinstance(alarmes, list)
                    else str(alarmes)[:800]
                ),
                "ip_principale": "N/A",
                "chain_incidents": "0",
                "corr_incidents": "0",
            }
    except Exception as e2:
        _err_ad = e2
        LOG.error("Import détection: ml_engine_bridge a échoué: %s: %s", type(_err_ml).__name__, _err_ml)
        LOG.error("Import détection: anomaly_detection a échoué: %s: %s", type(_err_ad).__name__, _err_ad)
        raise ImportError(
            "Impossible de charger la détection: ni `app.ai.engines.ml_engine_bridge` "
            "ni `app.ai.agents.anomaly_detection` n'est importable."
        ) from (_err_ad if _err_ml is None else _err_ml)


# ─────────────────────────────────────────────────────────────────────────────
# Mapping nom de fichier S3 → label métier
# ─────────────────────────────────────────────────────────────────────────────

_FILENAME_TO_LABEL: list[tuple[str, str]] = [
    ("sshd",    "auth"),
    ("auth",    "auth"),
    ("secure",  "auth"),
    ("ssh",     "auth"),
    ("nginx",   "web"),
    ("apache",  "web"),
    ("access",  "web"),
    ("http",    "web"),
    ("web",     "web"),
    ("vsftpd",  "ftp"),
    ("xferlog", "ftp"),
    ("xfer",    "ftp"),
    ("ftp",     "ftp"),
    ("kern",    "kernel"),
    ("dmesg",   "kernel"),
    ("syslog",  "kernel"),
    ("system",  "kernel"),
    ("kernel",  "kernel"),
]


def _infer_dataset_id(filename: str) -> str:
    base = os.path.basename(filename)
    return os.path.splitext(base)[0]


# ─────────────────────────────────────────────────────────────────────────────
# Utilitaires robustes
# ─────────────────────────────────────────────────────────────────────────────

def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _is_usable_ip(ip: Any) -> bool:
    ip_str = str(ip or "").strip()
    if ip_str.lower() in {"", "n/a", "none", "nan", "multiple", "unknown_ip"}:
        return False
    return bool(_re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}", ip_str))


def _alarm_signature(alarmes: Any) -> str:
    if not isinstance(alarmes, list):
        return str(alarmes)
    normalized: list[Any] = []
    for alarme in alarmes:
        if isinstance(alarme, dict):
            normalized.append({k: alarme.get(k) for k in sorted(alarme)})
        else:
            normalized.append(str(alarme))
    return json.dumps(normalized, ensure_ascii=False, sort_keys=True, default=str)


def _build_alarm_payload(nb_anomalies: int, ip_principale: str) -> str:
    if nb_anomalies <= 0:
        return "Aucune alarme critique"
    ip_part = ip_principale if _is_usable_ip(ip_principale) else "unknown_ip"
    return f"ANOMALIE nb={nb_anomalies} ip={ip_part} severite=AVERTISSEMENT"


# ─────────────────────────────────────────────────────────────────────────────
# Sanitisation alarmes → texte lisible (évite erreurs 400 Groq)
# ─────────────────────────────────────────────────────────────────────────────

def _sanitize_alarms_for_prompt(alarmes_resumees: str, max_len: int = 250) -> str:
    try:
        parsed = json.loads(alarmes_resumees)
        if isinstance(parsed, list):
            if not parsed:
                return "aucune alarme"
            lines = []
            for item in parsed[:3]:
                if isinstance(item, dict):
                    ip  = item.get("ip", "N/A")
                    niv = item.get("niveau", item.get("severite", "?"))
                    sc  = round(float(item.get("score_final", item.get("score", 0))), 2)
                    exp = str(item.get("explication", item.get("message", "")))[:120]
                    lines.append(f"IP={ip} niveau={niv} score={sc} cause={exp}")
                else:
                    lines.append(str(item)[:100])
            return " | ".join(lines)
        if isinstance(parsed, dict):
            ip  = parsed.get("ip", "N/A")
            niv = parsed.get("niveau", parsed.get("severite", "?"))
            return f"IP={ip} niveau={niv}"
        return str(parsed)[:max_len]
    except Exception:
        clean = _re.sub(r'["\\\{\}\[\]]', '', str(alarmes_resumees))
        return clean[:max_len]


# ─────────────────────────────────────────────────────────────────────────────
# Analyse déterministe (fallback si Groq échoue)
# ─────────────────────────────────────────────────────────────────────────────

def _build_deterministic_analysis(
    metrics_summary: dict[str, Any],
    agent_inputs: dict[str, Any],
    alarmes_pass1: Any,
    alarmes_final: Any,
    pass2_ran: bool,
    dynamic_config: DynamicConfig,
) -> str:
    pattern = str(metrics_summary.get("attack_pattern", "unknown")).replace("_", " ")
    health = _as_float(metrics_summary.get("health_score"), 0.0)
    status = str(metrics_summary.get("threat_severity") or metrics_summary.get("alert_status", "UNKNOWN")).upper()
    entropy = _as_float(metrics_summary.get("ip_entropy"), 0.0)
    unique_ips = _as_int(metrics_summary.get("unique_attacking_ips"), 0)
    velocity = _as_float(metrics_summary.get("attack_velocity"), 0.0)
    is_spike = str(metrics_summary.get("is_velocity_spike", "")).lower() in {"true", "1"} or bool(metrics_summary.get("is_velocity_spike"))
    night_ratio = _as_float(metrics_summary.get("night_ratio"), 0.0)
    ip_principale = str(agent_inputs.get("ip_principale", "N/A") or "N/A")
    nb_anomalies = _as_int(agent_inputs.get("nb_anomalies"), 0)

    classification = classify_attack_profile(
        attack_velocity=velocity,
        is_velocity_spike=is_spike,
        unique_attacking_ips=unique_ips,
        ip_entropy=entropy,
    )
    origin = str(metrics_summary.get("attack_origin") or classification["attack_origin"]).upper()
    origin_reason = str(metrics_summary.get("attack_origin_reason") or classification["attack_origin_reason"])
    severity_reason = str(metrics_summary.get("threat_severity_reason") or classification["threat_severity_reason"])
    concentration = str(metrics_summary.get("traffic_concentration") or classification["traffic_concentration"]).upper()

    line2 = (
        f"Attack origin: {origin} determined by {origin_reason}; "
        f"observed values velocity={velocity:.1f}, unique_ips={unique_ips}, entropy={entropy:.3f}."
    )

    pass2_changed = _alarm_signature(alarmes_final) != _alarm_signature(alarmes_pass1)
    if pass2_ran:
        if pass2_changed:
            line3 = (
                "Yes; Pass 2 ran and changed detection because the orchestrator adjusted thresholds "
                f"({dynamic_config.summary()})."
            )
        else:
            line3 = (
                "Yes; Pass 2 ran but detection stayed effectively the same after the threshold review."
            )
    else:
        line3 = (
            "No; Pass 2 did not run because the orchestrator kept the default thresholds "
            "and no override was justified."
        )

    risk_ip = ip_principale if _is_usable_ip(ip_principale) else "the same source"
    line4 = (
        "Top next-2h risks: sustained credential abuse from "
        f"{risk_ip}, and {concentration.lower()} follow-on activity causing service or alert-noise degradation "
        f"from {nb_anomalies} anomaly signal(s) with night_ratio={night_ratio:.3f}."
    )

    return "\n".join([
        f"Main threat: {pattern} classified as {status} because {severity_reason}; health={health:.1f}%.",
        line2,
        line3,
        line4,
    ])


def _health_score_from_anomalies(df_anomalies: Any) -> tuple[float, float]:
    if not isinstance(df_anomalies, pd.DataFrame) or df_anomalies.empty:
        return 100.0, 0.0

    if "score_final" not in df_anomalies.columns:
        return 100.0, 0.0

    score_series = pd.to_numeric(df_anomalies["score_final"], errors="coerce")
    if score_series.empty:
        return 100.0, 0.0

    max_score = score_series.max()
    if pd.isna(max_score):
        return 100.0, 0.0

    health_score = max(0.0, min(100.0, 100.0 - (float(max_score) * 100.0)))
    return round(health_score, 2), round(float(max_score), 4)


def _emit_dataset_health_event(
    *,
    dataset_id: str,
    health_score: float,
    max_anomaly_score: float,
    raw_count: int,
    deduped_count: int,
    noise_ratio: float,
) -> None:
    try:
        event_store.append_event(
            category="trust",
            event_type="DATASET_HEALTH",
            payload={
                "health_score": health_score,
                "dataset_id": dataset_id,
                "max_anomaly_score": max_anomaly_score,
                "row_count": raw_count,
                "deduped_count": deduped_count,
                "noise_ratio": noise_ratio,
            },
            dataset_id=dataset_id,
            source="health_monitor",
        )
    except Exception as exc:
        LOG.warning("[HEALTH] Could not append DATASET_HEALTH for %s: %s", dataset_id, exc)


def _trust_gate_fail_closed(
    context: str,
    dataset_id: str | None,
    reason: str,
    *,
    exc: BaseException | None = None,
) -> dict[str, Any]:
    detail = reason if exc is None else f"{reason}: {type(exc).__name__}: {exc}"
    return {
        "allow": False,
        "reason": f"[{context}] fail-closed monitor-only fallback - {detail}",
        "success_rate": 0.0,
        "stability": {},
        "context": context,
        "dataset_id": dataset_id,
        "failed_closed": True,
        "monitor_only": True,
        "allow_threshold_changes": False,
        "allow_retraining": False,
        "allow_adaptation": False,
        "allow_autonomous_escalation": False,
    }


def _resolve_trust_gate(
    context: str,
    dataset_id: str | None = None,
    anomaly_type: str | None = None,
    corrective_mode: str | None = None,
) -> dict[str, Any]:
    try:
        from app.ai.agents.trust_gate import should_adapt
    except Exception as exc:
        return _trust_gate_fail_closed(context, dataset_id, "trust gate import failed", exc=exc)

    try:
        gate = should_adapt(
            context,
            dataset_id=dataset_id,
            anomaly_type=anomaly_type,
            corrective_mode=corrective_mode,
        )
    except Exception as exc:
        return _trust_gate_fail_closed(context, dataset_id, "trust gate execution failed", exc=exc)

    if not isinstance(gate, dict):
        return _trust_gate_fail_closed(context, dataset_id, "trust gate returned a non-dict result")

    result = dict(gate)
    allow = bool(result.get("allow", False))
    result.setdefault("context", context)
    result.setdefault("dataset_id", dataset_id)
    result.setdefault("failed_closed", False)
    result["monitor_only"] = not allow
    result["allow_threshold_changes"] = allow and context == "PASS2"
    result["allow_retraining"] = allow
    result["allow_adaptation"] = allow
    result["allow_autonomous_escalation"] = allow and context == "CORRECTIVE_ACTION"
    return result


def _normalize_corrective_severity(raw: Any) -> str:
    value = str(raw or "").upper()
    if value in {"CRITIQUE", "CRITICAL", "HIGH"}:
        return "CRITIQUE"
    if value in {"INFO", "LOW", "FAIBLE", "NORMAL"}:
        return "INFO"
    return "AVERTISSEMENT"


def _normalize_corrective_type(*values: Any, severity: str = "AVERTISSEMENT") -> str:
    text = " ".join(str(value or "") for value in values).upper()
    if "BRUTE" in text or "SSH" in text or "BLOCAGE" in text:
        return "BRUTE-FORCE SSH"
    if "SCAN" in text or "PORT" in text:
        return "PORT SCAN"
    if "CPU" in text or "SURCHARGE" in text:
        return "SURCHARGE CPU"
    if "MEM" in text or "MEMOIRE" in text or "MEMORY" in text:
        return "PROBLEME MEMOIRE"
    if "USER" in text or "UTILISATEUR" in text:
        return "UTILISATEUR SUSPECT"
    if "WATCHLIST" in text:
        return "WATCHLIST"
    if severity == "CRITIQUE":
        return "BRUTE-FORCE SSH"
    return "WATCHLIST"


def _derive_corrective_anomaly(
    nb_anomalies: int,
    ip_principale: str,
    alarmes_final: Any,
) -> dict[str, Any]:
    alarmes_list = alarmes_final if isinstance(alarmes_final, list) else []
    real_alarmes = [
        alarm
        for alarm in alarmes_list
        if isinstance(alarm, dict) and alarm.get("ip", "SYSTEM") != "SYSTEM"
    ]

    if nb_anomalies <= 0 or not _is_usable_ip(ip_principale) or not real_alarmes:
        return {
            "type": "SURVEILLANCE_NORMALE",
            "ip": ip_principale if _is_usable_ip(ip_principale) else "N/A",
            "severite": "INFO",
            "action": "MONITORING",
            "description": "SURVEILLANCE NORMALE - aucune action",
        }

    critical_alarm = next(
        (
            alarm for alarm in real_alarmes
            if str(alarm.get("severite") or alarm.get("severity") or "").upper() in {"CRITIQUE", "CRITICAL", "HIGH"}
        ),
        None,
    )
    selected_alarm = critical_alarm or real_alarmes[0]
    severity = _normalize_corrective_severity(selected_alarm.get("severite") or selected_alarm.get("severity"))
    raw_ip = str(selected_alarm.get("ip") or ip_principale or "N/A")
    ip_value = raw_ip if _is_usable_ip(raw_ip) else ip_principale

    anomaly_type = _normalize_corrective_type(
        selected_alarm.get("type"),
        selected_alarm.get("feature"),
        selected_alarm.get("engine"),
        selected_alarm.get("message"),
        severity=severity,
    )

    return {
        "type": anomaly_type,
        "ip": ip_value if _is_usable_ip(ip_value) else "N/A",
        "severite": severity,
        "message": str(selected_alarm.get("message") or ""),
        "source_alarm": selected_alarm,
        "nb_anomalies": nb_anomalies,
    }


def _should_skip_analysis_crews(
    metrics_summary: dict[str, Any],
    agent_inputs: dict[str, Any],
    pass2_ran: bool,
) -> bool:
    if not LOW_SEVERITY_CREW_SKIP:
        return False
    severity = str(metrics_summary.get("threat_severity") or metrics_summary.get("alert_status", "NORMAL")).upper()
    nb_anomalies = _as_int(agent_inputs.get("nb_anomalies"), 0)
    return severity == "NORMAL" and nb_anomalies == 0 and not pass2_ran


# ─────────────────────────────────────────────────────────────────────────────
# Action corrective sécurisée
# CORRECTION 7 : suppression de l'import redondant/mal indenté de memory
# à l'intérieur de la fonction — il est déjà importé en tête de fichier.
# should_adapt est importé via le try/except du bloc Trust Gate en tête de main()
# ─────────────────────────────────────────────────────────────────────────────

def _run_safe_corrective_action(
    nb_anomalies: int,
    ip_principale: str,
    alarmes_final: Any,
    outil_correctif: Any,
    dataset_id: str | None = None,
) -> str:
    corrective_anomaly = _derive_corrective_anomaly(nb_anomalies, ip_principale, alarmes_final)
    anomaly_type = str(corrective_anomaly.get("type") or "").upper()
    corrective_mode = str(os.getenv("CORRECTIVE_AGENT_MODE", "SUGGESTION") or "SUGGESTION").upper()

    # ── Trust Gate CORRECTIVE_ACTION ─────────────────────────────────────────
    try:
        from app.ai.agents.trust_gate import should_adapt  # OK — app/ai/agents/trust_gate.py
        gate = _resolve_trust_gate(
            "CORRECTIVE_ACTION",
            dataset_id=dataset_id,
            anomaly_type=anomaly_type,
            corrective_mode=corrective_mode,
        )
        if not gate["allow"]:
            LOG.warning("[TRUST_GATE][CORRECTIVE] Bloqué : %s", gate["reason"])
            return f"[TRUST_GATE BLOCKED][MONITOR_ONLY] {gate['reason']}"
        LOG.info("[TRUST_GATE][CORRECTIVE] Autorisé : %s", gate["reason"])
    except Exception as e:
        LOG.warning("[TRUST_GATE] corrective fallback failed closed: %s", e)
        return f"[TRUST_GATE BLOCKED][MONITOR_ONLY] [CORRECTIVE_ACTION] fail-closed monitor-only fallback - {type(e).__name__}: {e}"
    # ── Fin Trust Gate ────────────────────────────────────────────────────────
    return outil_correctif._run(
        anomalie_json=json.dumps(corrective_anomaly, ensure_ascii=False)
    )


# ─────────────────────────────────────────────────────────────────────────────
# Compatibilité detecter_anomalies (multi-signatures)
# ─────────────────────────────────────────────────────────────────────────────

def _call_detecter_anomalies(
    df_in: pd.DataFrame,
    dynamic_config: Any | None,
    normalized_df: pd.DataFrame | None = None,
    prediction_cache: dict[str, Any] | None = None,
):
    fn = _detect_fn
    try:
        sig = inspect.signature(fn)
    except Exception:
        return fn(df_in)

    params = sig.parameters
    bound  = sig.bind_partial()

    df_keys  = ("df", "df_clean", "df_multi", "df_logs", "dataframe", "df_par_ip")
    bound_df = False
    for k in df_keys:
        if k in params:
            bound.arguments[k] = df_in
            bound_df = True
            break

    if not bound_df:
        positional = [
            name for name, p in params.items()
            if p.kind in (
                inspect.Parameter.POSITIONAL_ONLY,
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
            )
        ]
        if positional and positional[0] == "self":
            positional = positional[1:]
        if positional:
            bound.arguments[positional[0]] = df_in
            bound_df = True

    if not bound_df:
        return fn(df_in)

    dc_keys  = ["dynamic_config", "dynamic", "dyn_cfg", "cfg", "config", "agent_config", "hybrid_config"]
    dc_param = next((k for k in dc_keys if k in params), None)

    if dynamic_config is not None and dc_param is None:
        LOG.warning(
            "PASS2: `detecter_anomalies` n'accepte pas de dynamic config (signature=%s) — "
            "Pass2 ignoré côté détecteur (alarmes = Pass1).",
            str(sig),
        )

    if dc_param is not None and dynamic_config is not None:
        bound.arguments[dc_param] = dynamic_config

    if normalized_df is not None:
        for key in ("normalized_df", "df_norm", "normalized"):
            if key in params:
                bound.arguments[key] = normalized_df
                break

    if prediction_cache is not None:
        for key in ("prediction_cache", "prediction", "prediction_result"):
            if key in params:
                bound.arguments[key] = prediction_cache
                break

    try:
        res = fn(*bound.args, **bound.kwargs)
    except TypeError:
        if dynamic_config is None:
            res = fn(df_in)
        else:
            LOG.warning("Detect: bind failed; fallback positional df only. sig=%s", str(sig))
            res = fn(df_in)

    if not isinstance(res, tuple):
        res = (res,)

    if len(res) == 4:
        return res
    elif len(res) == 3:
        return (*res, [])
    elif len(res) == 2:
        df_a, alarms = res
        return df_a, pd.DataFrame(), alarms, []
    else:
        raise ValueError(
            f"detecter_anomalies a retourné {len(res)} valeurs — attendu 2, 3 ou 4."
        )


# ─────────────────────────────────────────────────────────────────────────────
# SessionLogger
# CORRECTION 8 : logging_utils est dans app/core/ (visible dans les captures)
# ─────────────────────────────────────────────────────────────────────────────
try:
    from app.core.logging_utils import SessionLogger
except Exception:
    class SessionLogger:
        def _emit(self, event_type: str, payload: dict): LOG.info("%s %s", event_type, payload)
        def pipeline_start(self, **kwargs): LOG.info("pipeline_start %s", kwargs)
        def metrics_computed(self, summary): LOG.info("metrics_computed %s", summary)
        def pass1_complete(self, alarmes, **kwargs): LOG.info("pass1_complete alarms=%s", len(alarmes) if hasattr(alarmes, "__len__") else "n/a")
        def trust_computed(self, trust): LOG.info("trust_computed conf=%.3f label=%s", trust.get("confidence_in_metrics", 0), trust.get("confidence_label", "?"))
        def pass2_complete(self, alarmes_final, alarmes_pass1, **kwargs): LOG.info("pass2_complete final=%s pass1=%s", len(alarmes_final), len(alarmes_pass1))
        def dynamic_config_default(self): LOG.info("dynamic_config_default")
        def dynamic_config_issued(self, cfg):
            try: LOG.info("dynamic_config_issued %s", cfg.summary())
            except Exception: LOG.info("dynamic_config_issued %s", str(cfg))
        def agents_complete(self, txt: str): LOG.info("agents_complete len=%s", len(txt or ""))
        def warning(self, where: str, msg: str): LOG.warning("[%s] %s", where, msg)
        def error(self, where: str, exc: BaseException): LOG.exception("[%s] %s", where, exc)
        def session_summary(self, **kwargs): LOG.info("session_summary keys=%s", list(kwargs.keys()))
        def close(self): return


# ─────────────────────────────────────────────────────────────────────────────
# CrewAI imports
# ─────────────────────────────────────────────────────────────────────────────
try:
    from crewai import Crew, Process
    CREWAI_AVAILABLE = True
    _CREWAI_IMPORT_ERR = None
except Exception as e:
    CREWAI_AVAILABLE = False
    _CREWAI_IMPORT_ERR = e

if CREWAI_AVAILABLE:
    # OK — app/ai/agents/agents.py
    from app.ai.agents.agents import (
        collector_agent,
        analyst_agent,
        detector_agent,
        reporter_agent,
        orchestrator_agent,
        outil_alarme,
        outil_correctif,
        outil_rapport,
        llm as groq_llm,
    )
    # OK — app/ai/agents/tasks.py
    from app.ai.agents.tasks import (
        tache_collecte,
        tache_analyse,
        tache_dynamic_config,
        tache_rapport,
        creer_tache_detection,
        creer_tache_correction,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Normalisation
# ─────────────────────────────────────────────────────────────────────────────

def _map_etat_from_row(row: pd.Series) -> str:
    if "Etat" in row.index and pd.notna(row.get("Etat")) and str(row["Etat"]).strip():
        return str(row["Etat"])
    if "statut" in row.index and pd.notna(row.get("statut")):
        v = str(row["statut"]).lower()
        if any(k in v for k in ["error", "failed", "critical", "denied", "refused", "failure"]):
            return "Error"
        if any(k in v for k in ["warning", "warn", "timeout"]):
            return "Warning"
        return "Info"
    if "severite" in row.index and pd.notna(row.get("severite")):
        v = str(row["severite"]).lower()
        if v in ["critical", "error", "high"]:
            return "Error"
        if v in ["warning", "medium"]:
            return "Warning"
        return "Info"
    msg = str(row.get("Message", row.get("detail", ""))).lower()
    if any(k in msg for k in ["error", "failed", "critical", "denied", "refused", "failure"]):
        return "Error"
    if any(k in msg for k in ["warning", "warn", "timeout"]):
        return "Warning"
    return "Info"


def normalize_logs_df(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    if "Date" not in df.columns:
        for col in ("timestamp", "DateTime"):
            if col in df.columns:
                df["Date"] = pd.to_datetime(df[col], errors="coerce")
                break
        else:
            df["Date"] = pd.Timestamp.now()
    else:
        df["Date"] = pd.to_datetime(df["Date"], errors="coerce")

    invalid_dates = int(df["Date"].isna().sum())
    if invalid_dates:
        total_rows = len(df)
        if invalid_dates == total_rows:
            fallback_end = pd.Timestamp.now().floor("s")
            df["Date"] = pd.date_range(end=fallback_end, periods=total_rows, freq="s")
            LOG.warning(
                "normalize_logs_df: %s/%s dates invalid; replaced with synthetic sequential timestamps",
                invalid_dates, total_rows,
            )
        else:
            df["Date"] = df["Date"].ffill().bfill()
            remaining_invalid = int(df["Date"].isna().sum())
            if remaining_invalid:
                df["Date"] = df["Date"].fillna(pd.Timestamp.now().floor("s"))
            LOG.warning(
                "normalize_logs_df: %s/%s dates invalid; filled from neighboring valid timestamps",
                invalid_dates, total_rows,
            )

    if "IP_Source" not in df.columns:
        df["IP_Source"] = df.get("source_ip", None)
    if "Service" not in df.columns:
        df["Service"] = df.get("source_log", df.get("type_event", "unknown"))
    if "Message" not in df.columns:
        df["Message"] = df.get("detail", "").astype(str)
    df["Etat"] = df.apply(_map_etat_from_row, axis=1)
    return df


def build_ip_feature_frame(df_logs: pd.DataFrame) -> pd.DataFrame:
    if "IP_Source" not in df_logs.columns:
        raise ValueError("Colonne IP_Source absente — impossible d'agréger par IP.")
    df = df_logs[df_logs["IP_Source"].notna()].copy()
    if df.empty:
        return pd.DataFrame(columns=["IP_Source", "Nombre_Tentatives", "Nombre_Erreurs", "nb_warnings", "Date"])
    if "Etat" not in df.columns:
        df["Etat"] = "Info"
    df["Date"] = pd.to_datetime(df.get("Date"), errors="coerce")
    g = df.groupby("IP_Source", dropna=True)
    out = g.agg(
        Nombre_Tentatives=("Etat", "size"),
        Nombre_Erreurs=("Etat", lambda s: int((s == "Error").sum())),
        nb_warnings=("Etat", lambda s: int((s == "Warning").sum())),
        Date=("Date", "max"),
    ).reset_index()
    out["Nombre_Tentatives"] = out[["Nombre_Tentatives", "Nombre_Erreurs"]].max(axis=1).astype(int)
    return out.sort_values(["Nombre_Erreurs", "Nombre_Tentatives"], ascending=False).reset_index(drop=True)


def load_logs_from_s3(prefix: str = "processed/dataset_") -> dict[str, pd.DataFrame]:
    bucket = os.environ.get("S3_BUCKET_NAME", "")
    region = os.environ.get("AWS_REGION", "us-east-1")

    if not bucket:
        raise RuntimeError("Missing S3_BUCKET_NAME")

    boto_cfg = BotoConfig(
        retries={"max_attempts": 8, "mode": "adaptive"},
        connect_timeout=int(os.getenv("AWS_S3_CONNECT_TIMEOUT", "10")),
        read_timeout=int(os.getenv("AWS_S3_READ_TIMEOUT", "300")),
        max_pool_connections=32,
        proxies={},
    )

    s3 = boto3.client(
        "s3",
        region_name=region,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        config=boto_cfg,
    )

    resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
    objects = resp.get("Contents", []) or []

    if not objects:
        raise RuntimeError(f"No datasets found in s3://{bucket}/{prefix}")

    datasets: dict[str, pd.DataFrame] = {}

    for obj in objects:
        key = obj["Key"]

        try:
            body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()

            df_tmp = pd.read_csv(
                io.BytesIO(body),
                on_bad_lines="skip"
            )

            # Dataset unique ID
            server_name = os.path.splitext(
                os.path.basename(key)
            )[0]

            server_id_val = server_name

            # Inject metadata
            df_tmp["Serveur"] = server_name
            df_tmp["server_id"] = server_id_val

            # Normalize independently
            df_tmp = normalize_logs_df(df_tmp)

            # Store independently
            datasets[server_id_val] = df_tmp

            LOG.info(
                "S3 OK %s → dataset='%s' rows=%s",
                key,
                server_id_val,
                len(df_tmp)
            )

        except Exception as e:
            LOG.warning(
                "S3 SKIP %s: %s: %s",
                key,
                type(e).__name__,
                e
            )

    if not datasets:
        raise RuntimeError("[S3] All dataset loads failed.")

    LOG.info(
        "S3 datasets loaded: %s",
        list(datasets.keys())
    )

    return datasets


# ─────────────────────────────────────────────────────────────────────────────
# Circuit breaker LLM
# ─────────────────────────────────────────────────────────────────────────────
_llm_circuit: dict[str, Any] = {
    "fails":      0,
    "open_until": 0.0,
    "max_fails":  3,
    "cooldown":   300,
}


def _circuit_record_fail() -> None:
    _llm_circuit["fails"] += 1
    if _llm_circuit["fails"] >= _llm_circuit["max_fails"]:
        _llm_circuit["open_until"] = time.time() + _llm_circuit["cooldown"]
        LOG.warning(
            "[CIRCUIT] LLM circuit ouvert — %s échecs consécutifs. Pause de %ss.",
            _llm_circuit["fails"], _llm_circuit["cooldown"],
        )


def _circuit_record_success() -> None:
    _llm_circuit["fails"]      = 0
    _llm_circuit["open_until"] = 0.0


def _circuit_is_open() -> bool:
    if _llm_circuit["open_until"] == 0.0:
        return False
    if time.time() < _llm_circuit["open_until"]:
        remaining = int(_llm_circuit["open_until"] - time.time())
        LOG.warning("[CIRCUIT] LLM circuit ouvert — fallback automatique (%ss restants)", remaining)
        return True
    LOG.info("[CIRCUIT] LLM circuit demi-ouvert — tentative de réouverture")
    _llm_circuit["open_until"] = 0.0
    _llm_circuit["fails"]      = 0
    return False


def _ips_suspectes(df: pd.DataFrame, anomalies: Any, k: int = 5) -> list[str]:
    ips: list[str] = []
    if isinstance(anomalies, pd.DataFrame) and (not anomalies.empty) and "source_ip" in anomalies.columns:
        ips.extend(anomalies["source_ip"].dropna().astype(str).head(k).tolist())
    if len(ips) < k and "IP_Source" in df.columns:
        tmp = df[df["IP_Source"].notna()].copy()
        if not tmp.empty:
            scores = (
                tmp.groupby("IP_Source")["Etat"]
                .apply(lambda s: int((s == "Error").sum()))
                .sort_values(ascending=False)
            )
            for ip in scores.head(k).index.astype(str).tolist():
                if ip not in ips:
                    ips.append(ip)
                if len(ips) >= k:
                    break
    return ips[:k]


def _install_llm_throttle() -> None:
    if not CREWAI_AVAILABLE:
        return
    if getattr(groq_llm, "_throttle_installed", False):
        return

    _last = [0.0]
    _orig = groq_llm.__class__.call

    def _throttled_call(self, *args, **kwargs):
        elapsed = time.time() - _last[0]
        if elapsed < LLM_MIN_DELAY_SECONDS:
            time.sleep(LLM_MIN_DELAY_SECONDS - elapsed)
        _last[0] = time.time()

        last_exc: BaseException | None = None
        for attempt in range(3):
            try:
                return _orig(self, *args, **kwargs)
            except BaseException as e:
                last_exc = e
                s = str(e).lower()
                if "429" in s or "rate_limit" in s:
                    wait = LLM_RATE_LIMIT_BACKOFF_SECONDS + attempt * LLM_RATE_LIMIT_BACKOFF_SECONDS
                    LOG.warning("THROTTLE rate_limit (%s/3) sleep=%ss", attempt + 1, wait)
                    time.sleep(wait)
                elif any(k in s for k in ["ssl", "eof", "unexpected_eof", "connecterror", "broken pipe", "reset"]):
                    wait = LLM_TRANSPORT_BACKOFF_SECONDS + attempt * LLM_TRANSPORT_BACKOFF_SECONDS
                    LOG.warning("THROTTLE ssl/eof (%s/3) sleep=%ss + new httpx client", attempt + 1, wait)
                    try:
                        litellm.client_session = httpx.Client(verify=True, http2=False, timeout=60.0)
                    except Exception:
                        pass
                    time.sleep(wait)
                else:
                    LOG.warning("THROTTLE other (%s/3): %s: %s", attempt + 1, type(e).__name__, e)
                    time.sleep(2 + attempt * 2)

        if last_exc is None:
            raise RuntimeError("LLM call failed after retries, but no exception was captured.")
        raise last_exc

    import types
    groq_llm.call = types.MethodType(_throttled_call, groq_llm)
    groq_llm._throttle_installed = True


def _run_dynamic_config(log: SessionLogger, agent_inputs: dict) -> DynamicConfig:
    if not CREWAI_AVAILABLE:
        log.warning("crewai", f"CrewAI indisponible: {_CREWAI_IMPORT_ERR}")
        return DynamicConfig.default()

    if _circuit_is_open():
        return DynamicConfig.default()

    _install_llm_throttle()

    LOG.info("HYBRID Step 5 — Orchestrator → DynamicConfig")
    try:
        crew = Crew(
            agents=[orchestrator_agent],
            tasks=[tache_dynamic_config],
            process=Process.sequential,
            memory=False,
            verbose=CREW_VERBOSE,
        )
        out = crew.kickoff(inputs=agent_inputs)

        # Step 1: extract a dict from the crew output
        if isinstance(out, dict):
            config_dict = out
        else:
            raw = str(out).strip()
            # Remove possible markdown code fences
            import re
            if raw.startswith("```json"):
                raw = re.sub(r"^```json\s*", "", raw)
                raw = re.sub(r"\s*```$", "", raw)
            # Find the first { and last }
            start = raw.find("{")
            end = raw.rfind("}")
            if start != -1 and end != -1 and end > start:
                json_str = raw[start:end+1]
                config_dict = json.loads(json_str)
            else:
                raise ValueError(f"No JSON object found in output: {raw[:200]}")
        
        # Step 2: ensure required fields exist
        defaults = DynamicConfig.default()
        for key in ["ssh_high_risk_threshold", "ssh_med_risk_threshold",
                    "web_high_risk_threshold", "web_med_risk_threshold",
                    "ftp_high_risk_threshold", "ftp_med_risk_threshold",
                    "kernel_high_risk_threshold", "session_high_risk_threshold",
                    "session_med_risk_threshold", "correlation_window_min",
                    "escalate_ips", "suppress_ips", "rerun_engines",
                    "threat_level", "reasoning", "confidence"]:
            if key not in config_dict:
                config_dict[key] = getattr(defaults, key, None)

        # Step 3: create a DynamicConfig instance from the dict
        # Use the class's constructor or a factory method.
        # If .from_dict exists, use it; otherwise, create manually.
        if hasattr(DynamicConfig, "from_dict"):
            cfg = DynamicConfig.from_dict(config_dict)
        else:
            # Fallback: instantiate and update attributes
            cfg = DynamicConfig.default()
            for k, v in config_dict.items():
                if hasattr(cfg, k):
                    setattr(cfg, k, v)
        cfg.issued_by = "orchestrator_agent"
        
        log.dynamic_config_issued(cfg)
        _circuit_record_success()
        return cfg

    except Exception as e:
        _circuit_record_fail()
        log.warning("dynamic_config", f"{type(e).__name__}: {e} — defaults")
        return DynamicConfig.default()

PREDICTION_HISTORY: dict[str, deque] = {}


def _prediction_risk_level(prediction_score: int) -> str:
    if prediction_score >= 70:
        return "CRITICAL"
    if prediction_score >= 40:
        return "HIGH"
    if prediction_score >= 20:
        return "MEDIUM"
    return "LOW"


def _prediction_confidence_label(confidence: float | None) -> str:
    if confidence is None:
        return ""
    if confidence >= 0.75:
        return "HIGH"
    if confidence >= 0.50:
        return "MEDIUM"
    return "LOW"


def _normalize_alarm_severity(value: object) -> str:
    sev = str(value or "").upper().strip()
    if sev == "CRITIQUE":
        return "CRITICAL"
    if sev == "AVERTISSEMENT":
        return "HIGH"
    if sev == "AVERTISSEMENT_MOYEN":
        return "MED"
    return sev


def _top_alarm_from_alarms(alarmes: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not alarmes:
        return None

    severity_rank = {"CRITICAL": 4, "HIGH": 3, "MED": 2, "LOW": 1, "INFO": 0}

    def _alarm_key(alarm: dict[str, Any]) -> tuple[int, float, str]:
        severity = _normalize_alarm_severity(alarm.get("severity") or alarm.get("severite"))
        score = float(alarm.get("score") or alarm.get("score_final") or alarm.get("weighted_risk_score") or 0.0)
        timestamp = str(alarm.get("timestamp") or "")
        return severity_rank.get(severity, 0), score, timestamp

    ordered = [alarm for alarm in alarmes if isinstance(alarm, dict)]
    if not ordered:
        return None
    ordered.sort(key=_alarm_key, reverse=True)
    top = ordered[0]
    ip = str(top.get("ip") or top.get("source_ip") or top.get("server_id") or "")
    return {
        "message": str(top.get("message") or ""),
        "ip": ip,
        "risk": _normalize_alarm_severity(top.get("severity") or top.get("severite") or top.get("niveau")),
    }


def _failure_total_for_ip(alarmes: list[dict[str, Any]], ip: str) -> int | None:
    if not ip:
        return None
    total = 0
    matched = False
    for alarm in alarmes:
        if not isinstance(alarm, dict):
            continue
        candidate_ip = str(alarm.get("ip") or alarm.get("source_ip") or alarm.get("server_id") or "")
        if candidate_ip != ip:
            continue
        matched = True
        try:
            total += int(float(alarm.get("failures", 0) or 0))
        except (TypeError, ValueError):
            continue
    return total if matched else None


def _model_agreement_label(value: float | None) -> str:
    if value is None:
        return ""
    if value >= 0.75:
        return "HIGH"
    if value >= 0.50:
        return "MEDIUM"
    return "LOW"


def _current_thresholds_from_snapshots(threshold_snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    if not threshold_snapshots:
        return {}
    snapshot = threshold_snapshots[-1] if len(threshold_snapshots) > 1 else threshold_snapshots[0]
    if not isinstance(snapshot, dict):
        return {}
    return {
        "pass": snapshot.get("pass"),
        "issued_by": snapshot.get("issued_by"),
        "ssh_high": snapshot.get("ssh_high"),
        "ssh_med": snapshot.get("ssh_med"),
        "web_high": snapshot.get("web_high"),
        "web_med": snapshot.get("web_med"),
        "ftp_high": snapshot.get("ftp_high"),
        "ftp_med": snapshot.get("ftp_med"),
        "kernel_high": snapshot.get("kernel_high"),
        "session_high": snapshot.get("session_high"),
        "session_med": snapshot.get("session_med"),
        "correlation_window_min": snapshot.get("corr_window", snapshot.get("correlation_window_min")),
        "threat_level": snapshot.get("threat_level"),
        "confidence": snapshot.get("confidence"),
    }


def _normalize_prediction_history_entry(entry: dict[str, Any]) -> dict[str, Any]:
    score = int(entry.get("score", entry.get("prediction_score", 0)) or 0)
    flags = entry.get("flags", entry.get("prediction_flags", [])) or []
    return {
        "timestamp": str(entry.get("timestamp") or entry.get("date") or datetime.now().isoformat()),
        "score": score,
        "confidence": entry.get("confidence", entry.get("prediction_confidence")),
        "flags": list(flags),
        "risk_level": str(entry.get("risk_level", _prediction_risk_level(score))),
        "analysis_mode": str(entry.get("analysis_mode", "")),
        "predicted_events": list(entry.get("predicted_events", []) or []),
        "predicted_outcomes": list(entry.get("predicted_outcomes", []) or []),
        "message": str(entry.get("message", "")),
        "explanations": list(entry.get("explanations", []) or []),
        "timeline_characteristics": entry.get("timeline_characteristics", {}) if isinstance(entry.get("timeline_characteristics", {}), dict) else {},
        "signal_summary": entry.get("signal_summary", {}) if isinstance(entry.get("signal_summary", {}), dict) else {},
    }


def _build_prediction_history_entry(
    prediction: dict[str, Any],
    signal_analysis: dict[str, Any],
    explanations: list[str],
) -> dict[str, Any]:
    score = int(prediction.get("prediction_score", 0) or 0)
    return {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "score": score,
        "confidence": prediction.get("confidence"),
        "flags": list(prediction.get("flags", []) or []),
        "predicted_events": list(prediction.get("predicted_events", []) or []),
        "predicted_outcomes": list(prediction.get("predicted_outcomes", []) or []),
        "analysis_mode": str(prediction.get("analysis_mode", "")),
        "risk_level": _prediction_risk_level(score),
        "message": str(prediction.get("message", "Prevision calculee")),
        "explanations": list(explanations or []),
        "timeline_characteristics": prediction.get("timeline_characteristics", {})
        if isinstance(prediction.get("timeline_characteristics", {}), dict)
        else {},
        "signal_summary": {
            "ssh_failures_trend": signal_analysis.get("failures", {}).get("trend_ratio", 1.0),
            "unique_ips_trend": signal_analysis.get("unique_ips", {}).get("trend_ratio", 1.0),
            "username_diversity": signal_analysis.get("usernames", {}).get("last", 0),
            "ftp_activity": signal_analysis.get("ftp_events", {}).get("last", 0),
            "kernel_errors": signal_analysis.get("kernel_errors", {}).get("last", 0),
        },
    }


def _seed_prediction_history(dataset_id: str) -> deque:
    history = deque(maxlen=60)
    try:
        memory_snapshot = charger_memoire(dataset_id=dataset_id)
        for entry in memory_snapshot.get("forecast_history", [])[-60:]:
            if isinstance(entry, dict):
                history.append(_normalize_prediction_history_entry(entry))
    except Exception as e:
        LOG.warning("[PREDICTION_HISTORY] Seed failed for %s: %s", dataset_id, e)
    return history


def _prediction_history(dataset_id: str) -> deque:
    history = PREDICTION_HISTORY.get(dataset_id)
    if history is None:
        history = _seed_prediction_history(dataset_id)
        PREDICTION_HISTORY[dataset_id] = history
    return history


def _read_jsonl_events(path: str | os.PathLike[str]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
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
    except Exception as e:
        LOG.warning("Could not read JSONL events from %s: %s", path, e)
    return events


def _build_engine_scores_from_thresholds(
    alarmes_final: list[dict[str, Any]],
    threshold_snapshots: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_domain: dict[str, int] = {}
    for alarm in alarmes_final:
        engine = str(alarm.get("engine") or alarm.get("domain") or "OTHER").upper()
        by_domain[engine] = by_domain.get(engine, 0) + 1

    pass1_snap = threshold_snapshots[0] if threshold_snapshots else {}
    pass2_snap = threshold_snapshots[-1] if threshold_snapshots else pass1_snap

    engines = ["SSH", "WEB", "FTP", "KERNEL", "SESSION"]
    scores: list[dict[str, Any]] = []
    for engine in engines:
        eng_lower = engine.lower()
        count = int(by_domain.get(engine, 0))
        pass1_threshold = pass1_snap.get(f"{eng_lower}_high", 50)
        pass2_threshold = pass2_snap.get(f"{eng_lower}_high", pass1_threshold)
        scores.append({
            "engine": engine,
            "alarms": count,
            "score": min(100, count * 5),
            "pass1": pass1_threshold,
            "pass2": pass2_threshold,
            "status": "ALARM" if count > pass1_threshold else "CLEAR",
            "rerun_p2": bool(pass2_snap.get("rerun_engines")),
        })
    return scores


def _build_prediction_payload(
    prediction: dict[str, Any],
    signal_analysis: dict[str, Any],
    explanations: list[str],
    history: deque,
) -> dict[str, Any]:
    prediction_score = int(prediction.get("prediction_score", 0) or 0)
    flags = list(prediction.get("flags", []) or [])
    risk_level = "LOW"
    if prediction_score >= 70:
        risk_level = "CRITICAL"
    elif prediction_score >= 40:
        risk_level = "HIGH"
    elif prediction_score >= 20:
        risk_level = "MEDIUM"

    prevention_suggestions: list[str] = []
    if "BOTNET_WARMUP" in flags:
        prevention_suggestions.append("Augmenter la surveillance des IPs multiples")
    if "SPRAY_PHASE" in flags:
        prevention_suggestions.append("Activer le rate limiting sur SSH")
    if "CRASH_COMING" in flags:
        prevention_suggestions.append("Verifier la charge systeme et redemarrer si necessaire")
    if "DATA_EXFIL_START" in flags:
        prevention_suggestions.append("Bloquer les transferts FTP suspects")

    return {
        "available": True,
        "prediction_score": prediction_score,
        "confidence": prediction.get("confidence"),
        "flags": flags,
        "predicted_events": list(prediction.get("predicted_events", []) or []),
        "predicted_outcomes": list(prediction.get("predicted_outcomes", []) or []),
        "message": str(prediction.get("message", "Prevision calculee")),
        "analysis_mode": str(prediction.get("analysis_mode", "")),
        "timeline_characteristics": prediction.get("timeline_characteristics", {}),
        "risk_evolution": [{"time": h["timestamp"], "risk": h["score"], "failures": 0} for h in list(history)],
        "behavioral_analysis": {
            "ssh_failures_trend": signal_analysis.get("failures", {}).get("trend_ratio", 1.0),
            "unique_ips_trend": signal_analysis.get("unique_ips", {}).get("trend_ratio", 1.0),
            "username_diversity": signal_analysis.get("usernames", {}).get("last", 0),
            "ftp_activity": signal_analysis.get("ftp_events", {}).get("last", 0),
            "kernel_errors": signal_analysis.get("kernel_errors", {}).get("last", 0),
        },
        "prevention_suggestions": prevention_suggestions,
        "risk_level": risk_level,
        "signal_analysis": signal_analysis,
        "explanations": explanations,
        "history": list(history),
    }


def _summarize_sessions(memory_data: dict[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for session in reversed(memory_data.get("sessions", [])[-20:]):
        donnees = session.get("donnees", {})
        result.append({
            "date": session.get("date", ""),
            "threat_level": donnees.get("agent_threat_level", "NORMAL"),
            "nb_alarms_pass1": donnees.get("nb_alarmes_pass1", 0),
            "nb_alarms_final": donnees.get("nb_alarmes_final", 0),
            "pass2_ran": bool(donnees.get("pass2_ran", False)),
            "health_score": donnees.get("health_score"),
            "ips_suspectes": donnees.get("ips_suspectes", []),
            "attack_pattern": donnees.get("attack_pattern", ""),
        })
    return result


def _aggregate_pipeline_results(dataset_results: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return build_fusion_payload(dataset_results)
# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    current_log: SessionLogger | None = None

    try:
        import app.ai.agents.agents as _agents_module
        _agents_module._alarme_declenchee_ce_cycle = False
    except Exception:
        pass

    PIPELINE_RESULTS.clear()
    AVAILABLE_DATASETS.clear()
    PREDICTION_HISTORY.clear()
    set_active_dataset(None)

    try:
        LOG.info("PIPELINE START")
        broadcast_log({"message": "Pipeline started"})

        LOG.info("Per-dataset mode enabled - global adaptive threshold mixing disabled")

        datasets = load_logs_from_s3()
        AVAILABLE_DATASETS.extend(list(datasets.keys()))
        LOG.info("Loaded %d datasets: %s", len(datasets), list(datasets.keys()))
        broadcast_log({"message": f"{len(datasets)} datasets loaded from S3"})

        dataset_payloads: dict[str, dict[str, Any]] = {}

        for dataset_id, df_raw in datasets.items():
            dataset_token = set_active_dataset(dataset_id)
            current_log = SessionLogger(output_dir=os.path.join("output", dataset_id), dataset_id=dataset_id)

            try:
                LOG.info(f"\n{'='*60}\nPROCESSING DATASET: {dataset_id}\n{'='*60}")
                broadcast_log({"message": f"Processing dataset: {dataset_id}", "dataset_id": dataset_id})

                df, noise_ratio = dedup_logs(df_raw, window_minutes=5)
                raw_count = len(df_raw)
                deduped_count = len(df)
                quality_label = data_quality_label(noise_ratio)
                ml_score_weight = noise_score_weight(noise_ratio)

                LOG.info(
                    "Data quality: %s | raw=%d -> deduped=%d | ml_weight=%.2f",
                    quality_label, raw_count, deduped_count, ml_score_weight,
                )

                server_ids_in_df: list[str] = []
                if "server_id" in df.columns:
                    server_ids_in_df = sorted({
                        str(sid) for sid in df["server_id"].dropna().unique()
                        if str(sid).lower() not in ("", "nan", "unknown")
                    })
                    LOG.info("[SERVER_IDS] Labels metier dans le DataFrame: %s", server_ids_in_df)

                data_sources_raw: list[str] = []
                if "Serveur" in df.columns:
                    data_sources_raw = [str(x) for x in df["Serveur"].dropna().unique().tolist()]

                current_log.pipeline_start(
                    row_count=raw_count,
                    server_count=int(df["Serveur"].nunique()) if "Serveur" in df.columns else 0,
                    data_sources=data_sources_raw,
                    deduped_count=deduped_count,
                    noise_ratio=noise_ratio,
                    data_quality=quality_label,
                    ml_score_weight=ml_score_weight,
                )

                erreurs_par_heure, tentatives_par_ip, events_par_service = calculer_metriques(df)
                metrics_summary = get_summary_for_detector(erreurs_par_heure, tentatives_par_ip, df_clean=df)
                metrics_summary.update({
                    "dataset_id": dataset_id,
                    "row_count": raw_count,
                    "deduped_count": deduped_count,
                    "data_quality": quality_label,
                    "noise_ratio": noise_ratio,
                    "data_sources": data_sources_raw,
                })

                df_norm: pd.DataFrame | None = None
                try:
                    from app.core.adapter import normalize

                    df_norm = normalize(df, verbose=False)
                except Exception as e:
                    current_log.warning("normalize", f"skipped: {type(e).__name__}: {e}")

                try:
                    from app.ai.engines.prediction_engine import run_prediction_engine

                    prediction = run_prediction_engine(df_norm) if df_norm is not None else {
                        "prediction_score": 0,
                        "flags": [],
                        "predicted_events": [],
                        "signals": {},
                    }
                    signals = prediction.get("signals", {})
                    signal_analysis = {
                        "failures": signals.get("failures", {}),
                        "unique_ips": signals.get("unique_ips", {}),
                        "usernames": signals.get("usernames", {}),
                        "ftp_events": signals.get("ftp_events", {}),
                        "kernel_errors": signals.get("kernel_errors", {}),
                    }
                    explanations = []
                    if signals.get("failures", {}).get("burst_ratio", 0) >= 2:
                        explanations.append("SSH authentication failures increasing abnormally")
                    if signals.get("unique_ips", {}).get("trend_ratio", 0) >= 1.25:
                        explanations.append("Multiple distributed IPs detected - potential botnet warmup")
                    if signals.get("usernames", {}).get("burst_ratio", 0) >= 2:
                        explanations.append("Username diversity spike observed - spray phase likely")
                    if signals.get("ftp_events", {}).get("burst_ratio", 0) >= 2:
                        explanations.append("FTP retrieval behavior abnormal - possible data exfiltration")
                    if signals.get("kernel_errors", {}).get("trend_ratio", 0) >= 1.25:
                        explanations.append("Kernel instability increasing - system crash risk elevated")
                except Exception as e:
                    current_log.warning("prediction", f"skipped: {type(e).__name__}: {e}")
                    prediction = {"prediction_score": 0, "flags": [], "predicted_events": [], "signals": {}}
                    signal_analysis = {}
                    explanations = []

                history = _prediction_history(dataset_id)
                forecast_history_entry = _build_prediction_history_entry(
                    prediction,
                    signal_analysis,
                    explanations,
                )
                history.append(forecast_history_entry)
                prediction_payload = _build_prediction_payload(prediction, signal_analysis, explanations, history)
                prediction_payload["dataset_id"] = dataset_id
                current_log._emit("PREDICTION_COMPUTED", {
                    "prediction_score": prediction_payload["prediction_score"],
                    "flags": prediction_payload["flags"],
                    "predicted_events": prediction_payload["predicted_events"],
                    "message": prediction_payload["message"],
                    "analysis_mode": prediction_payload.get("analysis_mode", ""),
                    "timeline_characteristics": prediction_payload.get("timeline_characteristics", {}),
                    "signal_analysis": prediction_payload["signal_analysis"],
                    "explanations": prediction_payload["explanations"],
                    "history": prediction_payload["history"],
                })

                drift_info = compute_drift_score(
                    metrics_summary.get("taux_anomalies", 0.0),
                    memory_file=str(get_memory_file(dataset_id)),
                )
                stability_info = compute_session_stability(n_sessions=3, dataset_id=dataset_id)
                metrics_summary["drift_score"] = drift_info["drift_score"]
                metrics_summary["drift_label"] = drift_info["drift_label"]
                metrics_summary["drift_flagged"] = drift_info["drift_flagged"]
                metrics_summary["stability"] = stability_info["confidence"]
                metrics_summary["stability_signals"] = stability_info["stable_signals"]

                try:
                    from app.services.forecasting import prevoir_erreurs
                    _ = prevoir_erreurs(erreurs_par_heure)
                except Exception as e:
                    current_log.warning("forecast", f"skipped: {type(e).__name__}: {e}")

                ip_profiles = build_ip_profiles(df)
                LOG.info("[PROFILES] Built %d IP profiles", len(ip_profiles))

                import app.services.ip_profiler as _ip_profiler_mod
                _ip_profiler_mod._current_session_profiles = ip_profiles
                _ip_profiler_mod._current_ml_score_weight = ml_score_weight

                LOG.info("PASS 1 - default thresholds")
                df_ip = build_ip_feature_frame(df)
                detection_input = df if _detect_fn.__module__.endswith("ml_engine_bridge") else df_ip
                df_annot, anomalies, alarmes_pass1, threshold_snapshots = _call_detecter_anomalies(
                    detection_input,
                    dynamic_config=None,
                    normalized_df=df_norm,
                    prediction_cache=prediction,
                )
                health_score, max_anomaly_score = _health_score_from_anomalies(anomalies)
                metrics_summary["health_score"] = health_score
                current_log.metrics_computed(metrics_summary)
                current_log.pass1_complete(
                    alarmes_pass1,
                    threshold_snapshot=threshold_snapshots[0] if threshold_snapshots else None,
                )

                if isinstance(alarmes_pass1, list):
                    for al in alarmes_pass1[:10]:
                        srv = str(al.get("server_id") or al.get("Serveur") or dataset_id)
                        broadcast_alarm(al, stage="pass1", server_id=srv, dataset_id=dataset_id)

                broadcast_metrics({**metrics_summary, "dataset_id": dataset_id})

                trust_session_data = {
                    **metrics_summary,
                    "noise_ratio": noise_ratio,
                    "ml_score_weight": ml_score_weight,
                }
                trust_result = compute_trust(
                    session_data=trust_session_data,
                    alarmes=alarmes_pass1,
                    threshold_snapshots=threshold_snapshots,
                )
                trust_result["dataset_id"] = dataset_id
                current_log.trust_computed(trust_result)

                _ip_profiler_mod._current_trust_score = trust_result.get("confidence_in_metrics", 0.5)
                _ip_profiler_mod._current_trust_label = trust_result.get("confidence_label", "UNCERTAIN")

                sources_str = ",".join(data_sources_raw) if data_sources_raw else "unknown"
                agent_inputs = _get_agent_inputs_fn(alarmes_pass1, anomalies)
                agent_inputs.update({
                    "serveur_nom": sources_str,
                    "date": datetime.now().strftime("%Y%m%d_%H%M%S"),
                    "historical_context": get_contexte_historique(dataset_id=dataset_id),
                    "dataset_id": dataset_id,
                    **{k: str(v) for k, v in metrics_summary.items()},
                    "pass2_ran": "False",
                    "dynamic_config_summary": "not yet computed",
                    "dynamic_config_reasoning": "not yet computed",
                })
                agent_inputs["alarmes_resumees"] = _sanitize_alarms_for_prompt(
                    agent_inputs.get("alarmes_resumees", "[]")
                )

                gate_pass2 = _resolve_trust_gate("PASS2", dataset_id=dataset_id)
                trust_gate_failed_closed = bool(gate_pass2.get("failed_closed", False))
                if not gate_pass2["allow"]:
                    LOG.warning("[TRUST_GATE][PASS2] Bloqué : %s", gate_pass2["reason"])
                    LOG.warning("[TRUST_GATE][PASS2] -> PASS 2 annulé")
                    dynamic_config = DynamicConfig.default()
                else:
                    LOG.info("[TRUST_GATE][PASS2] Autorisé : %s", gate_pass2["reason"])
                    dynamic_config = _run_dynamic_config(current_log, agent_inputs)

                if not dynamic_config.is_default():
                    LOG.info("PASS 2 - agent-adjusted thresholds")
                    df_annot, anomalies, alarmes_final, threshold_snapshots = _call_detecter_anomalies(
                        detection_input,
                        dynamic_config=dynamic_config,
                        normalized_df=df_norm,
                        prediction_cache=prediction,
                    )
                    current_log.pass2_complete(
                        alarmes_final,
                        alarmes_pass1,
                        threshold_snapshot=threshold_snapshots[-1] if threshold_snapshots else None,
                    )
                    pass2_ran = True
                else:
                    current_log.dynamic_config_default()
                    alarmes_final = alarmes_pass1
                    pass2_ran = False

                if isinstance(alarmes_final, list):
                    for al in alarmes_final[:10]:
                        srv = str(al.get("server_id") or al.get("Serveur") or dataset_id)
                        broadcast_alarm(al, stage="final", server_id=srv, dataset_id=dataset_id)

                agent_inputs.update(_get_agent_inputs_fn(alarmes_final, anomalies))
                health_score, max_anomaly_score = _health_score_from_anomalies(anomalies)
                metrics_summary["health_score"] = health_score
                _emit_dataset_health_event(
                    dataset_id=dataset_id,
                    health_score=health_score,
                    max_anomaly_score=max_anomaly_score,
                    raw_count=raw_count,
                    deduped_count=deduped_count,
                    noise_ratio=noise_ratio,
                )
                agent_inputs.update({
                    "pass2_ran": str(pass2_ran),
                    "dynamic_config_summary": (
                        dynamic_config.summary()
                        if gate_pass2["allow"]
                        else (
                            f"monitor-only fail-closed: {gate_pass2['reason']}"
                            if gate_pass2.get("failed_closed")
                            else f"pass2 blocked: {gate_pass2['reason']}"
                        )
                    ),
                    "dynamic_config_reasoning": (
                        (dynamic_config.reasoning or "")[:200]
                        if gate_pass2["allow"]
                        else gate_pass2["reason"][:200]
                    ),
                })
                agent_inputs["alarmes_resumees"] = _sanitize_alarms_for_prompt(
                    agent_inputs.get("alarmes_resumees", "[]")
                )

                parts = []
                if not CREWAI_AVAILABLE:
                    resultat = f"CrewAI skipped: {_CREWAI_IMPORT_ERR}"
                    current_log.warning("crewai", resultat)
                else:
                    nb_anomalies = int(str(agent_inputs.get("nb_anomalies", "0") or "0"))
                    ip_principale = str(agent_inputs.get("ip_principale", "N/A") or "N/A")
                    alarmes_resumees = str(agent_inputs.get("alarmes_resumees", "Aucune") or "Aucune")

                    if _should_skip_analysis_crews(metrics_summary, agent_inputs, pass2_ran):
                        current_log._emit("ANALYSIS_CREW_SKIPPED", {
                            "reason": "low severity",
                            "threat_severity": metrics_summary.get("threat_severity", "NORMAL"),
                            "nb_anomalies": nb_anomalies,
                        })
                        analysis_text = _build_deterministic_analysis(
                            metrics_summary,
                            agent_inputs,
                            alarmes_pass1,
                            alarmes_final,
                            pass2_ran,
                            dynamic_config,
                        )
                        parts.append(f"[ANALYST_FALLBACK]\n{analysis_text}")
                    else:
                        t_detection = creer_tache_detection(nb_anomalies, ip_principale, alarmes_resumees)
                        analysis_crew = Crew(
                            agents=[collector_agent, analyst_agent, detector_agent],
                            tasks=[tache_collecte, tache_analyse, t_detection],
                            process=Process.sequential,
                            memory=False,
                            verbose=CREW_VERBOSE,
                        )
                        try:
                            current_log._emit("ANALYSIS_CREW_STARTED", {
                                "agents": ["Collecteur", "Analyste", "Detecteur"],
                                "nb_anomalies": nb_anomalies,
                                "ip_principale": ip_principale,
                            })
                            crew_out = analysis_crew.kickoff(inputs=agent_inputs)
                            current_log._emit("ANALYSIS_CREW_COMPLETED", {
                                "agents": ["Collecteur", "Analyste", "Detecteur"],
                                "result_excerpt": str(crew_out)[:300],
                            })
                            parts.append(str(crew_out))
                            LOG.info("Crew A reussi")
                        except Exception as e:
                            current_log.warning("analysis_crew", f"{type(e).__name__}: {e}")
                            analysis_text = _build_deterministic_analysis(
                                metrics_summary,
                                agent_inputs,
                                alarmes_pass1,
                                alarmes_final,
                                pass2_ran,
                                dynamic_config,
                            )
                            parts.append(f"[ANALYST_FALLBACK]\n{analysis_text}")

                    report_crew = Crew(
                        agents=[reporter_agent],
                        tasks=[tache_rapport],
                        process=Process.sequential,
                        memory=False,
                        verbose=CREW_VERBOSE,
                    )
                    try:
                        current_log._emit("REPORT_CREW_STARTED", {"agents": ["Rapporteur"], "pass2_ran": pass2_ran})
                        report_out = report_crew.kickoff(inputs=agent_inputs)
                        current_log._emit("REPORT_CREW_COMPLETED", {"agents": ["Rapporteur"], "result_excerpt": str(report_out)[:300]})
                        parts.append(f"[REPORT_AGENT]\n{report_out}")
                    except Exception as e:
                        current_log.warning("report_crew", f"{type(e).__name__}: {e}")
                        parts.append(f"[REPORT_AGENT][WARN] {type(e).__name__}: {e}")

                    try:
                        alarme_result = outil_alarme._run(alarmes_json=_build_alarm_payload(nb_anomalies, ip_principale))
                        parts.append(f"[ALARM_TOOL]\n{alarme_result}")
                    except Exception as e:
                        current_log.warning("alarm_tool", f"{type(e).__name__}: {e}")
                        parts.append(f"[ALARM_TOOL][WARN] {type(e).__name__}: {e}")

                    try:
                        current_log._emit("CORRECTIVE_TOOL_STARTED", {"nb_anomalies": nb_anomalies, "ip_principale": ip_principale})
                        corr = _run_safe_corrective_action(
                            nb_anomalies,
                            ip_principale,
                            alarmes_final,
                            outil_correctif,
                            dataset_id=dataset_id,
                        )
                        parts.append(f"[CORRECTIVE_TOOL]\n{corr}")
                        current_log._emit("CORRECTIVE_TOOL_COMPLETED", {"title": "Corrective action", "result_excerpt": str(corr)[:300]})
                    except Exception as e:
                        current_log.warning("corrective_tool", f"{type(e).__name__}: {e}")
                        parts.append(f"[CORRECTIVE_TOOL][WARN] {type(e).__name__}: {e}")

                    try:
                        report_payload = json.dumps({
                            "health": agent_inputs.get("health_score"),
                            "anomalies": agent_inputs.get("nb_anomalies"),
                            "pattern": agent_inputs.get("attack_pattern"),
                            "ip": agent_inputs.get("ip_principale"),
                            "chains": agent_inputs.get("chain_incidents"),
                            "pass2": agent_inputs.get("pass2_ran"),
                            "timestamp": agent_inputs.get("date"),
                            "dataset_id": dataset_id,
                        }, ensure_ascii=False)
                        rep = outil_rapport._run(rapport_json=report_payload)
                        parts.append(f"[REPORT_TOOL]\n{rep}")
                    except Exception as e:
                        current_log.warning("report_tool", f"{type(e).__name__}: {e}")
                        parts.append(f"[REPORT_TOOL][WARN] {type(e).__name__}: {e}")

                    resultat = "\n\n".join(parts)
                    current_log.agents_complete(resultat)

                if trust_gate_failed_closed:
                    current_log._emit("RETRAIN_SKIPPED", {
                        "reason": gate_pass2["reason"],
                        "mode": "MONITOR_ONLY",
                    })
                else:
                    try:
                        _retrain_fn(df_ip)
                    except Exception as e:
                        current_log.warning("retrain", f"{type(e).__name__}: {e}")

                suspicious_ips = _ips_suspectes(df, anomalies)
                engine_scores = _build_engine_scores_from_thresholds(alarmes_final, threshold_snapshots)

                current_log.session_summary(
                    alarmes_pass1,
                    alarmes_final,
                    threshold_snapshots,
                    metrics=metrics_summary,
                    dynamic_config=dynamic_config,
                )

                memory_payload = {
                    **metrics_summary,
                    "dataset_id": dataset_id,
                    "server_ids": server_ids_in_df or [dataset_id],
                    "serveurs_actifs": server_ids_in_df or [dataset_id],
                    "data_sources": data_sources_raw,
                    "alarmes": alarmes_final,
                    "ips_suspectes": suspicious_ips,
                    "nb_alarmes_pass1": len(alarmes_pass1),
                    "nb_alarmes_final": len(alarmes_final),
                    "pass2_ran": pass2_ran,
                    "threshold_snapshots": threshold_snapshots,
                    "agent_threat_level": dynamic_config.threat_level if not dynamic_config.is_default() else metrics_summary.get("alert_status", "NORMAL"),
                    "agent_reasoning": (dynamic_config.reasoning or "")[:200],
                    "agent_config_summary": dynamic_config.summary(),
                    "prediction_score": prediction_payload["prediction_score"],
                    "prediction_flags": prediction_payload["flags"],
                    "forecast_history_entry": forecast_history_entry,
                }
                sauvegarder_memoire(memory_payload, dataset_id=dataset_id)
                memory_snapshot = charger_memoire(dataset_id=dataset_id)

                events = _read_jsonl_events(current_log.output_path)
                decisions = [
                    e for e in events
                    if isinstance(e, dict) and e.get("event_type") in (
                        "DYNAMIC_CONFIG_DEFAULT",
                        "DYNAMIC_CONFIG_ISSUED",
                        "AGENTS_COMPLETE",
                    )
                ][-20:]
                log_lines = [
                    f"[{e.get('timestamp', '')}] {e.get('message') or e.get('msg') or e.get('event_type', '')}"
                    for e in events
                    if isinstance(e, dict)
                ][-60:]
                sessions = _summarize_sessions(memory_snapshot)

                dataset_payload = {
                    "available": True,
                    "dataset_id": dataset_id,
                    "metrics": metrics_summary,
                    "kpis": metrics_summary,
                    "alarms": alarmes_final,
                    "alarmes": alarmes_final,
                    "trust": trust_result,
                    "prediction": prediction_payload,
                    "engine_scores": engine_scores,
                    "decisions": decisions,
                    "sessions": sessions,
                    "log_lines": log_lines,
                    "events": events[-150:],
                    "memory": memory_snapshot,
                    "memory_file": str(get_memory_file(dataset_id)),
                    "output_file": current_log.output_path,
                    "data_quality": {
                        "raw_rows": raw_count,
                        "dedup_rows": deduped_count,
                        "noise_pct": noise_ratio,
                        "ml_weight": ml_score_weight,
                        "data_sources": data_sources_raw,
                    },
                    "backtest_history": list(reversed(memory_snapshot.get("backtest_history", []))),
                    "server_ids": server_ids_in_df or [dataset_id],
                    "data_sources": data_sources_raw,
                    "minimization": [{
                        "timestamp": datetime.now().strftime("%H:%M:%S"),
                        "alarmes": len(alarmes_final),
                        "risque": max(0, round(100 - float(metrics_summary.get("health_score", 100) or 100), 1)),
                    }],
                }
                PIPELINE_RESULTS[dataset_id] = dataset_payload
                dataset_payloads[dataset_id] = dataset_payload
                LOG.info("Stored results for dataset: %s", dataset_id)

            except Exception as exc:
                if current_log:
                    current_log.error(dataset_id, exc)
                raise
            finally:
                if current_log:
                    current_log.close()
                    current_log = None
                reset_active_dataset(dataset_token)

        PIPELINE_RESULTS[LEGACY_MERGED_DATASET] = _aggregate_pipeline_results(dataset_payloads)
        try:
            broadcast_activity({
                "dataset_id": LEGACY_MERGED_DATASET,
                "stage": "fusion",
                "actor": "Fusion Engine",
                "title": "Fusion output ready",
                "detail": f"Read-only overlay built across {len(dataset_payloads)} dataset(s).",
                "status": "completed",
                "severity": "INFO",
                "event_type": "FUSION_OUTPUT_READY",
                "datasets": list(dataset_payloads.keys()),
                "fusion": PIPELINE_RESULTS[LEGACY_MERGED_DATASET].get("fusion", {}),
                "global_kpis": PIPELINE_RESULTS[LEGACY_MERGED_DATASET].get("fusion", {}).get("global_kpis", {}),
                "analysis_only": True,
                "meta": {
                    "datasets": list(dataset_payloads.keys()),
                    "analysis_only": True,
                },
            })
        except Exception:
            pass
        LOG.info("All datasets processed. Per-dataset results and fusion overlay stored in PIPELINE_RESULTS.")

        try:
            _req.post("http://localhost:8000/api/invalidate-cache", timeout=2)
            LOG.info("[CACHE] Cache invalide apres pipeline")
        except Exception:
            pass

        if AVAILABLE_DATASETS:
            LOG.info("MEMORY ctx=%s", get_contexte_historique(dataset_id=AVAILABLE_DATASETS[0]))

        broadcast_log({"message": "PIPELINE DONE (all datasets)"})
        LOG.info("PIPELINE DONE")

    except Exception as exc:
        if current_log:
            current_log.error("main", exc)
        raise
    finally:
        set_active_dataset(None)
        LOG.info("[META] Global meta-learning skipped to preserve per-dataset isolation")
        if current_log:
            current_log.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="IDPS Pipeline")
    parser.add_argument("--backtest", action="store_true")
    parser.add_argument("--sessions", type=int, default=3)
    args = parser.parse_args()

    if args.backtest:
        # CORRECTION 13 : backtester est dans app/ai/engines/
        from app.ai.engines.backtester import main_backtest
        main_backtest(n_sessions=args.sessions)
        sys.exit(0)
    else:
        main()
        sys.exit(0)
