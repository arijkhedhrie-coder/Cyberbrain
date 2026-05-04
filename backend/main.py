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
import requests as _req
import boto3
import pandas as pd
from botocore.config import Config as BotoConfig
from dotenv import load_dotenv
from src.crewai_compat import patch_legacy_rag_storage_for_ollama

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
# ─────────────────────────────────────────────────────────────────────────────
try:
    from api_auth import broadcast_alarm, broadcast_log, broadcast_metrics
    from api_auth import _event_loop as _ws_event_loop
    if _ws_event_loop is None or _ws_event_loop.is_closed():
        raise RuntimeError("Event loop non disponible — main.py hors uvicorn")
    WS_ENABLED = True
    LOG.info("[WS] broadcast direct chargé (même processus que uvicorn)")
except Exception as _ws_err:
    WS_ENABLED = False

    def broadcast_alarm(raw_alarm: dict, stage: str = "pass1", server_id: str = "server1") -> None:
        try:
            import requests as _r
            _r.post(
                "http://localhost:8000/api/internal/broadcast-alarm",
                json={"alarm": raw_alarm, "stage": stage, "server_id": server_id},
                timeout=2,
            )
        except Exception:
            pass

    def broadcast_log(data: dict) -> None:
        pass

    def broadcast_metrics(data: dict) -> None:
        try:
            import requests as _r
            _r.post("http://localhost:8000/api/internal/broadcast-metrics", json=data, timeout=2)
        except Exception:
            pass

    LOG.warning("[WS] mode processus séparé — broadcast via HTTP fallback (%s)", _ws_err)

# ─────────────────────────────────────────────────────────────────────────────
# Imports métier
# ─────────────────────────────────────────────────────────────────────────────
from src.metriques import calculer_metriques, get_summary_for_detector, compute_drift_score
from src.upload_s3 import sauvegarder_localement, uploader_vers_s3
from src.agents.memory import sauvegarder_memoire, get_contexte_historique, compute_session_stability
from src.hybrid_config import DynamicConfig
from src.ip_profiler import dedup_logs, build_ip_profiles, data_quality_label, noise_score_weight
from src.performance_engine import compute_trust

_detect_fn = None
_get_agent_inputs_fn = None
_retrain_fn = None

_err_ml: BaseException | None = None
try:
    from src.ml_engine_bridge import detecter_anomalies as _detect_fn
    from src.ml_engine_bridge import get_agent_inputs as _get_agent_inputs_fn
    from src.ml_engine_bridge import reentralner_avec_nouveaux_logs as _retrain_fn
except Exception as e:
    _err_ml = e
    _err_ad: BaseException | None = None
    try:
        from src.anomaly_detection import detecter_anomalies as _detect_fn
        from src.anomaly_detection import reentralner_avec_nouveaux_logs as _retrain_fn

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
            "Impossible de charger la détection: ni `src.ml_engine_bridge` ni `src.anomaly_detection` "
            "n'est importable."
        ) from (_err_ad if _err_ml is None else _err_ml)


# ─────────────────────────────────────────────────────────────────────────────
# ✅ [FIX-MAIN-1] Mapping nom de fichier S3 → label métier
# Synchronisé avec api_dashboard.py (_S3_KEYWORD_TO_LABEL)
# ─────────────────────────────────────────────────────────────────────────────

_FILENAME_TO_LABEL: list[tuple[str, str]] = [
    # SSH / auth — spécifiques en premier
    ("sshd",    "auth"),
    ("auth",    "auth"),
    ("secure",  "auth"),
    ("ssh",     "auth"),
    # Web
    ("nginx",   "web"),
    ("apache",  "web"),
    ("access",  "web"),
    ("http",    "web"),
    ("web",     "web"),
    # FTP
    ("vsftpd",  "ftp"),
    ("xferlog", "ftp"),
    ("xfer",    "ftp"),
    ("ftp",     "ftp"),
    # Kernel / system — "syslog"/"system" explicites, PAS "sys" (trop générique)
    ("kern",    "kernel"),
    ("dmesg",   "kernel"),
    ("syslog",  "kernel"),
    ("system",  "kernel"),
    ("kernel",  "kernel"),
]


def _infer_server_label(filename: str) -> str:
    base = os.path.basename(filename).lower()
    for keyword, label in _FILENAME_TO_LABEL:
        if keyword in base:
            return label
    # Fallback : si "dataset_" générique, on assigne "auth" par défaut
    if "dataset_" in base:
        LOG.warning("[LOAD] Fichier générique '%s' → fallback server_id='auth'", filename)
        return "auth"
    LOG.warning("[LOAD] Fichier non reconnu: '%s' → server_id='unknown'", filename)
    return "unknown"


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
    pattern    = str(metrics_summary.get("attack_pattern", "unknown")).replace("_", " ")
    health     = _as_float(metrics_summary.get("health_score"), 0.0)
    status     = str(metrics_summary.get("alert_status", "UNKNOWN")).upper()
    entropy    = _as_float(metrics_summary.get("ip_entropy"), 0.0)
    unique_ips = _as_int(metrics_summary.get("unique_attacking_ips"), 0)
    velocity   = _as_float(metrics_summary.get("attack_velocity"), 0.0)
    night_ratio   = _as_float(metrics_summary.get("night_ratio"), 0.0)
    ip_principale = str(agent_inputs.get("ip_principale", "N/A") or "N/A")
    nb_anomalies  = _as_int(agent_inputs.get("nb_anomalies"), 0)

    confidence = "high"
    if health >= 99 and status == "HIGH":
        confidence = "very high"
    elif health < 80 or status not in {"HIGH", "MEDIUM"}:
        confidence = "medium"

    automated = velocity >= 100 or (unique_ips <= 5 and entropy <= 1.0)
    if automated:
        line2 = (
            "Likely automated; evidence: "
            f"low IP diversity ({unique_ips}), low entropy ({entropy:.3f}), "
            f"high request volume ({velocity:.1f}), and repeated failures tied to {ip_principale}."
        )
    else:
        line2 = (
            "Possibly human-driven or mixed; evidence is weaker because "
            f"velocity={velocity:.1f}, entropy={entropy:.3f}, and unique_ips={unique_ips} "
            "do not show a clean bot pattern."
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
        f"{risk_ip}, and service or alert-noise degradation from {nb_anomalies} ongoing anomaly signal(s) "
        f"with night_ratio={night_ratio:.3f}."
    )

    return "\n".join([
        f"Main threat: {pattern} with {confidence} confidence (health={health:.1f}%, status={status}).",
        line2,
        line3,
        line4,
    ])


# ─────────────────────────────────────────────────────────────────────────────
# Action corrective sécurisée
# ─────────────────────────────────────────────────────────────────────────────

def _run_safe_corrective_action(
    nb_anomalies: int,
    ip_principale: str,
    alarmes_final: Any,
    outil_correctif: Any,
) -> str:
    alarmes_list = alarmes_final if isinstance(alarmes_final, list) else []
    real_alarmes = [
        a for a in alarmes_list
        if isinstance(a, dict) and a.get("ip", "SYSTEM") != "SYSTEM"
    ]

    has_critical  = any(str(a.get("severite", "")).upper() == "CRITIQUE"      for a in real_alarmes)
    has_any_alarm = len(real_alarmes) > 0

    if nb_anomalies > 0 and _is_usable_ip(ip_principale) and has_critical:
        return outil_correctif._run(
            anomalie_json=f"BLOCAGE IP {ip_principale} brute-force SSH critique"
        )

    if nb_anomalies > 0 and _is_usable_ip(ip_principale) and has_any_alarm:
        return outil_correctif._run(
            anomalie_json=f"WATCHLIST IP {ip_principale} anomalie={nb_anomalies}"
        )

    return outil_correctif._run(anomalie_json="SURVEILLANCE NORMALE - aucune action")


# ─────────────────────────────────────────────────────────────────────────────
# Compatibilité detecter_anomalies (multi-signatures)
# ─────────────────────────────────────────────────────────────────────────────

def _call_detecter_anomalies(df_in: pd.DataFrame, dynamic_config: Any | None):
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
# SessionLogger (stub si absent)
# ─────────────────────────────────────────────────────────────────────────────
try:
    from src.logging_utils import SessionLogger
except Exception:
    class SessionLogger:
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
    from src.agents.agents import (
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
    from src.agents.tasks import (
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

# ── Mapping nom fichier S3 → label métier ────────────────────
_FILENAME_TO_LABEL: list[tuple[str, str]] = [
    ("sshd", "auth"), ("auth", "auth"), ("secure", "auth"), ("ssh", "auth"),
    ("nginx", "web"),  ("apache", "web"), ("access", "web"), ("http", "web"), ("web", "web"),
    ("vsftpd", "ftp"), ("xferlog", "ftp"), ("xfer", "ftp"), ("ftp", "ftp"),
    ("kern", "kernel"), ("dmesg", "kernel"), ("syslog", "kernel"),
    ("system", "kernel"), ("kernel", "kernel"),
]

def _infer_server_label(filename: str) -> str:
    base = os.path.basename(filename).lower()
    for keyword, label in _FILENAME_TO_LABEL:
        if keyword in base:
            return label
    LOG.warning("[LOAD] Fichier non reconnu: '%s' → server_id='unknown'", filename)
    return "unknown"
def load_logs_from_s3(prefix: str = "processed/dataset_") -> pd.DataFrame:
   
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
    resp    = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
    objects = resp.get("Contents", []) or []
    if not objects:
        raise RuntimeError(f"No datasets found in s3://{bucket}/{prefix}")

    frames: list[pd.DataFrame] = []
    for obj in objects:
        key = obj["Key"]
        try:
            body   = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
            df_tmp = pd.read_csv(io.BytesIO(body), on_bad_lines="skip")

     

            server_id_val = _infer_server_label(key)   # "auth"|"web"|"ftp"|"kernel"|"unknown"
            server_name   = os.path.splitext(os.path.basename(key))[0]   # "dataset_auth_2026-03-10_06-32"
            df_tmp["Serveur"]     = server_name      # nom lisible pour les rapports
            df_tmp["server_id"]   = server_id_val    # label métier pour les filtres API

            frames.append(df_tmp)
            LOG.info(
                "S3 OK %s → server_id='%s' rows=%s",
                key, server_id_val, len(df_tmp),
            )
        except Exception as e:
            LOG.warning("S3 SKIP %s: %s: %s", key, type(e).__name__, e)

    if not frames:
        raise RuntimeError("[S3] All dataset loads failed.")

    df = pd.concat(frames, ignore_index=True)
    df = normalize_logs_df(df)

    # Log récapitulatif des server_ids chargés
    if "server_id" in df.columns:
        counts = df["server_id"].value_counts().to_dict()
        LOG.info("S3 merged rows=%s | server_ids: %s", len(df), counts)

    return df


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
        if elapsed < 25:
            time.sleep(25 - elapsed)
        _last[0] = time.time()

        last_exc: BaseException | None = None
        for attempt in range(3):
            try:
                return _orig(self, *args, **kwargs)
            except BaseException as e:
                last_exc = e
                s = str(e).lower()
                if "429" in s or "rate_limit" in s:
                    wait = 30 + attempt * 15
                    LOG.warning("THROTTLE rate_limit (%s/3) sleep=%ss", attempt + 1, wait)
                    time.sleep(wait)
                elif any(k in s for k in ["ssl", "eof", "unexpected_eof", "connecterror", "broken pipe", "reset"]):
                    wait = 15 + attempt * 10
                    LOG.warning("THROTTLE ssl/eof (%s/3) sleep=%ss + new httpx client", attempt + 1, wait)
                    try:
                        litellm.client_session = httpx.Client(verify=True, http2=False, timeout=60.0)
                    except Exception:
                        pass
                    time.sleep(wait)
                else:
                    LOG.warning("THROTTLE other (%s/3): %s: %s", attempt + 1, type(e).__name__, e)
                    time.sleep(8)

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
            verbose=True,
        )
        out = crew.kickoff(inputs=agent_inputs)
        cfg = DynamicConfig.from_json(str(out))
        cfg.issued_by = "orchestrator_agent"
        log.dynamic_config_issued(cfg)
        _circuit_record_success()
        return cfg
    except Exception as e:
        _circuit_record_fail()
        log.warning("dynamic_config", f"{type(e).__name__}: {e} — defaults")
        return DynamicConfig.default()


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    log = SessionLogger()

    try:
        import src.agents.agents as _agents_module
        _agents_module._alarme_declenchee_ce_cycle = False
    except Exception:
        pass

    resultat            = ""
    threshold_snapshots: list[Any] = []
    pass2_ran           = False

    try:
        LOG.info("PIPELINE START")
        broadcast_log({"message": "Pipeline started"})
        df_raw    = load_logs_from_s3()
        raw_count = len(df_raw)
        broadcast_log({"message": f"{raw_count} logs loaded from S3"})

        # ── STREAM logs vers frontend ─────────────────────────────────────────
        for _, row in df_raw.head(20).iterrows():
            broadcast_log({
                "message": (
                    f"[{str(row.get('Service', 'SYS'))}] "
                    f"{str(row.get('IP_Source', ''))} — "
                    f"{str(row.get('Message', ''))[:180]}"
                )
            })

        # ── Deduplication + qualité ───────────────────────────────────────────
        df, noise_ratio   = dedup_logs(df_raw, window_minutes=5)
        deduped_count     = len(df)
        quality_label     = data_quality_label(noise_ratio)
        ml_score_weight   = noise_score_weight(noise_ratio)

        LOG.info(
            "Data quality: %s | raw=%d → deduped=%d | ml_weight=%.2f",
            quality_label, raw_count, deduped_count, ml_score_weight,
        )

        # ✅ [FIX-MAIN-3] Collecte les labels métier uniques depuis le DataFrame
        server_ids_in_df: list[str] = []
        if "server_id" in df.columns:
            server_ids_in_df = sorted({
                str(sid) for sid in df["server_id"].dropna().unique()
                if str(sid).lower() not in ("", "nan", "unknown")
            })
            LOG.info("[SERVER_IDS] Labels métier dans le DataFrame: %s", server_ids_in_df)

        data_sources_raw: list[str] = []
        if "Serveur" in df.columns:
            data_sources_raw = df["Serveur"].unique().tolist()

        log.pipeline_start(
            row_count    = raw_count,
            server_count = int(df["Serveur"].nunique()) if "Serveur" in df.columns else 0,
            data_sources = data_sources_raw,
            deduped_count   = deduped_count,
            noise_ratio     = noise_ratio,
            data_quality    = quality_label,
            ml_score_weight = ml_score_weight,
        )

        # Step 2 — métriques
        erreurs_par_heure, tentatives_par_ip, events_par_service = calculer_metriques(df)
        metrics_summary = get_summary_for_detector(erreurs_par_heure, tentatives_par_ip, df_clean=df)
        log.metrics_computed(metrics_summary)

        drift_info     = compute_drift_score(metrics_summary.get("taux_anomalies", 0.0))
        stability_info = compute_session_stability(n_sessions=3)
        metrics_summary["drift_score"]       = drift_info["drift_score"]
        metrics_summary["drift_label"]       = drift_info["drift_label"]
        metrics_summary["drift_flagged"]     = drift_info["drift_flagged"]
        metrics_summary["stability"]         = stability_info["confidence"]
        metrics_summary["stability_signals"] = stability_info["stable_signals"]

        try:
            from src.forecasting import prevoir_erreurs
            _ = prevoir_erreurs(erreurs_par_heure)
        except Exception as e:
            log.warning("forecast", f"skipped: {type(e).__name__}: {e}")

        ip_profiles = build_ip_profiles(df)
        LOG.info("[PROFILES] Built %d IP profiles", len(ip_profiles))

        import src.ip_profiler as _ip_profiler_mod
        _ip_profiler_mod._current_session_profiles = ip_profiles
        _ip_profiler_mod._current_ml_score_weight  = ml_score_weight

        # Step 3 — PASS 1
        LOG.info("PASS 1 — default thresholds")
        df_ip = build_ip_feature_frame(df)

        _detection_input = df if _detect_fn.__module__.endswith("ml_engine_bridge") else df_ip
        df_annot, anomalies, alarmes_pass1, threshold_snapshots = _call_detecter_anomalies(_detection_input, dynamic_config=None)
        log.pass1_complete(alarmes_pass1, threshold_snapshot=threshold_snapshots[0] if threshold_snapshots else None)

        if isinstance(alarmes_pass1, list):
            for al in alarmes_pass1[:10]:
                srv = str(al.get("server_id") or al.get("Serveur") or "server1")
                broadcast_alarm(al, stage="pass1", server_id=srv)

        broadcast_metrics(metrics_summary)

        # Trust score
        _trust_session_data = {
            **metrics_summary,
            "noise_ratio":     noise_ratio,
            "ml_score_weight": ml_score_weight,
        }
        trust_result = compute_trust(
            session_data        = _trust_session_data,
            alarmes             = alarmes_pass1,
            threshold_snapshots = threshold_snapshots,
        )
        log.trust_computed(trust_result)

        _ip_profiler_mod._current_trust_score = trust_result.get("confidence_in_metrics", 0.5)
        _ip_profiler_mod._current_trust_label = trust_result.get("confidence_label", "UNCERTAIN")

        # Step 4 — agent inputs
        sources_str  = ",".join(data_sources_raw) if data_sources_raw else "unknown"
        agent_inputs = _get_agent_inputs_fn(alarmes_pass1, anomalies)
        agent_inputs.update({
            "serveur_nom": sources_str,
            "date": datetime.now().strftime("%Y%m%d_%H%M%S"),
            "historical_context": get_contexte_historique(),
            **{k: str(v) for k, v in metrics_summary.items()},
            "pass2_ran": "False",
            "dynamic_config_summary": "not yet computed",
            "dynamic_config_reasoning": "not yet computed",
        })
        agent_inputs["alarmes_resumees"] = _sanitize_alarms_for_prompt(
            agent_inputs.get("alarmes_resumees", "[]")
        )

        # Step 5 — orchestrateur
        dynamic_config = _run_dynamic_config(log, agent_inputs)

        # Step 6 — PASS 2
        if not dynamic_config.is_default():
            LOG.info("PASS 2 — agent-adjusted thresholds")
            df_annot, anomalies, alarmes_final, threshold_snapshots = _call_detecter_anomalies(_detection_input, dynamic_config=dynamic_config)
            log.pass2_complete(alarmes_final, alarmes_pass1, threshold_snapshot=threshold_snapshots[-1] if threshold_snapshots else None)
            pass2_ran = True

            if isinstance(alarmes_final, list):
                for al in alarmes_final[:10]:
                    srv = str(al.get("server_id") or al.get("Serveur") or "server1")
                    broadcast_alarm(al, stage="final", server_id=srv)
        else:
            log.dynamic_config_default()
            alarmes_final = alarmes_pass1
            pass2_ran     = False

        # Broadcast final garanti dans tous les cas
        if isinstance(alarmes_final, list):
            for al in alarmes_final[:10]:
                srv = str(al.get("server_id") or al.get("Serveur") or "server1")
                broadcast_alarm(al, stage="final", server_id=srv)

        agent_inputs.update(_get_agent_inputs_fn(alarmes_final, anomalies))
        agent_inputs.update({
            "pass2_ran": str(pass2_ran),
            "dynamic_config_summary": dynamic_config.summary(),
            "dynamic_config_reasoning": (dynamic_config.reasoning or "")[:200],
        })
        agent_inputs["alarmes_resumees"] = _sanitize_alarms_for_prompt(
            agent_inputs.get("alarmes_resumees", "[]")
        )

        parts: list[str] = []

        if not CREWAI_AVAILABLE:
            resultat = f"CrewAI skipped: {_CREWAI_IMPORT_ERR}"
            log.warning("crewai", resultat)
        else:
            nb_anomalies     = int(str(agent_inputs.get("nb_anomalies", "0") or "0"))
            ip_principale    = str(agent_inputs.get("ip_principale", "N/A") or "N/A")
            alarmes_resumees = str(agent_inputs.get("alarmes_resumees", "Aucune") or "Aucune")

            # Crew A — analyse agentique
            t_detection  = creer_tache_detection(nb_anomalies, ip_principale, alarmes_resumees)
            analysis_crew = Crew(
                agents=[collector_agent, analyst_agent, detector_agent],
                tasks=[tache_collecte, tache_analyse, t_detection],
                process=Process.sequential,
                memory=False,
                verbose=True,
            )

            try:
                crew_out = analysis_crew.kickoff(inputs=agent_inputs)
                parts.append(str(crew_out))
                LOG.info("Crew A réussi")
            except Exception as e:
                log.warning("analysis_crew", f"{type(e).__name__}: {e}")
                LOG.info("Crew A échoué → fallback analyse déterministe")
                analysis_text = _build_deterministic_analysis(
                    metrics_summary=metrics_summary,
                    agent_inputs=agent_inputs,
                    alarmes_pass1=alarmes_pass1,
                    alarmes_final=alarmes_final,
                    pass2_ran=pass2_ran,
                    dynamic_config=dynamic_config,
                )
                parts.append(f"[ANALYST_FALLBACK]\n{analysis_text}")

            # Crew B — rapport
            report_crew = Crew(
                agents=[reporter_agent],
                tasks=[tache_rapport],
                process=Process.sequential,
                memory=False,
                verbose=True,
            )
            try:
                report_out = report_crew.kickoff(inputs=agent_inputs)
                parts.append(f"[REPORT_AGENT]\n{report_out}")
            except Exception as e:
                log.warning("report_crew", f"{type(e).__name__}: {e}")
                parts.append(f"[REPORT_AGENT][WARN] {type(e).__name__}: {e}")

            # Outil alarme
            try:
                alarme_result = outil_alarme._run(
                    alarmes_json=_build_alarm_payload(nb_anomalies, ip_principale)
                )
                parts.append(f"[ALARM_TOOL]\n{alarme_result}")
            except Exception as e:
                log.warning("alarm_tool", f"{type(e).__name__}: {e}")
                parts.append(f"[ALARM_TOOL][WARN] {type(e).__name__}: {e}")

            # Action corrective
            try:
                corr = _run_safe_corrective_action(
                    nb_anomalies, ip_principale, alarmes_final, outil_correctif
                )
                parts.append(f"[CORRECTIVE_TOOL]\n{corr}")
            except Exception as e:
                log.warning("corrective_tool", f"{type(e).__name__}: {e}")
                parts.append(f"[CORRECTIVE_TOOL][WARN] {type(e).__name__}: {e}")

            # Rapport S3
            try:
                report_payload = json.dumps({
                    "health":    agent_inputs.get("health_score"),
                    "anomalies": agent_inputs.get("nb_anomalies"),
                    "pattern":   agent_inputs.get("attack_pattern"),
                    "ip":        agent_inputs.get("ip_principale"),
                    "chains":    agent_inputs.get("chain_incidents"),
                    "pass2":     agent_inputs.get("pass2_ran"),
                    "timestamp": agent_inputs.get("date"),
                }, ensure_ascii=False)
                rep = outil_rapport._run(rapport_json=report_payload)
                parts.append(f"[REPORT_TOOL]\n{rep}")
            except Exception as e:
                log.warning("report_tool", f"{type(e).__name__}: {e}")
                parts.append(f"[REPORT_TOOL][WARN] {type(e).__name__}: {e}")

            resultat = "\n\n".join(parts)
            log.agents_complete(resultat)

        # Step 8 — réentraînement + sauvegarde + mémoire
        try:
            _retrain_fn(df_ip)
        except Exception as e:
            log.warning("retrain", f"{type(e).__name__}: {e}")

        try:
            sauvegarder_localement(df, erreurs_par_heure, tentatives_par_ip, events_par_service)
        except Exception as e:
            log.warning("save_local", f"{type(e).__name__}: {e}")

        try:
            uploader_vers_s3()
        except Exception as e:
            log.warning("upload_s3", f"{type(e).__name__}: {e}")

        # ✅ [FIX-MAIN-3 + FIX-MAIN-4] Sauvegarde les labels métier dans la mémoire
        # → /api/servers les retrouve directement sans conversion
        sauvegarder_memoire({
            "ips_suspectes":         _ips_suspectes(df, anomalies, k=5),
            "nb_anomalies":          len(anomalies) if isinstance(anomalies, pd.DataFrame) else int(str(agent_inputs.get("nb_anomalies", "0") or "0")),
            "nb_alarmes_pass1":      len(alarmes_pass1) if hasattr(alarmes_pass1, "__len__") else 0,
            "nb_alarmes_final":      len(alarmes_final) if hasattr(alarmes_final, "__len__") else 0,
            "health_score":          metrics_summary.get("health_score", 100.0),
            "attack_pattern":        metrics_summary.get("attack_pattern", "unknown"),
            "dynamic_config":        dynamic_config.to_json(),
            "agent_threat_level":    getattr(dynamic_config, "threat_level", "NORMAL"),
            "pass2_ran":             pass2_ran,
            "threshold_snapshots":   threshold_snapshots,
            "date":                  agent_inputs.get("date"),
            "alarmes":               alarmes_final,
            "resultat_agents":       str(resultat)[:500],
            "fp_score_session":      trust_result.get("false_positive_rate", 0.0),
            "anomaly_rate":          trust_result.get("noise_ratio", 0.0),
            "taux_anomalies":        round(
                (len(anomalies) / max(len(df_ip), 1))
                if isinstance(anomalies, pd.DataFrame) else 0.0, 4
            ),
            "model_agreement":       trust_result.get("model_agreement", 1.0),
            "drift_score":           trust_result.get("drift_score", 0.0),
            "stability":             trust_result.get("stability", "LOW"),
            "confidence_in_metrics": trust_result.get("confidence_in_metrics", 0.0),
            # ✅ [FIX-MAIN-3] Labels métier dédupliqués (auth/web/ftp/kernel)
            # /api/servers lit "server_ids" en priorité 2 et "serveurs_actifs" en priorité 1
            "server_ids":            server_ids_in_df,           # ["auth","web","ftp"] ✅
            "serveurs_actifs":       server_ids_in_df,           # même chose — priorité 1 dans /api/servers
            # Noms bruts originaux (pour le rapport S3 et les logs)
            "data_sources":          data_sources_raw,           # ["auth_2026-03-10","web_2026-03-10"]
        })

        try:
            _req.post("http://localhost:8000/api/invalidate-cache", timeout=2)
            LOG.info("[CACHE] Cache invalidé après pipeline")
        except Exception:
            pass

        LOG.info("MEMORY ctx=%s", get_contexte_historique())

        log.session_summary(
            alarmes_pass1       = alarmes_pass1,
            alarmes_final       = alarmes_final,
            threshold_snapshots = threshold_snapshots,
            metrics             = metrics_summary,
            dynamic_config      = dynamic_config,
        )

        broadcast_log({"message": f"[PIPELINE DONE] {resultat[:500]}"})
        LOG.info("PIPELINE DONE")
        print(resultat)

    except Exception as exc:
        log.error("main", exc)
        raise
    finally:
        log.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="IDPS Pipeline")
    parser.add_argument("--backtest", action="store_true")
    parser.add_argument("--sessions", type=int, default=3)
    args = parser.parse_args()

    if args.backtest:
        from src.backtester import main_backtest
        main_backtest(n_sessions=args.sessions)
        sys.exit(0)
    else:
        main()
        sys.exit(0)