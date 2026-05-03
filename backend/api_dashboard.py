# api_dashboard.py
# ─────────────────────────────────────────────────────────────
# Router FastAPI — expose /api/* en réutilisant dashboard_api.py
#
# NOUVEAUTÉ : paramètre ?servers= sur /api/kpis et /api/alarms
# Mapping label frontend → engine backend :
#   auth   → SSH
#   web    → WEB
#   ftp    → FTP
#   kernel → KERNEL | SESSION
# Si aucun serveur sélectionné → renvoie tout (comportement par défaut)
# ─────────────────────────────────────────────────────────────

from __future__ import annotations

from typing import List
from fastapi import APIRouter, Query

from dashboard_api import (
    _latest_jsonl, _load_memory,
    _build_kpis, _build_alarms, _build_engine_scores,
    _build_decisions, _build_log_lines, _build_trust,
    _build_data_quality, _build_gate_history,
    _cached,
)

router = APIRouter(prefix="/api", tags=["dashboard"])

# ── Mapping label frontend → moteurs backend ──────────────────
# auth.log/sshd.log → domaine SSH
# access.log/error.log → domaine WEB
# vsftpd.log/xferlog → domaine FTP
# syslog/kern.log/dmesg → domaines KERNEL + SESSION
_LABEL_TO_ENGINES: dict[str, list[str]] = {
    "auth":   ["SSH"],
    "web":    ["WEB"],
    "ftp":    ["FTP"],
    "kernel": ["KERNEL", "SESSION"],
}


def _engines_for_servers(servers: list[str]) -> set[str]:
    """
    Convertit une liste de labels de serveurs (ex: ["auth","web"])
    en ensemble de moteurs backend (ex: {"SSH","WEB"}).
    Si servers est vide → set vide (= pas de filtre).
    """
    engines: set[str] = set()
    for label in servers:
        engines.update(_LABEL_TO_ENGINES.get(label.lower(), []))
    return engines


# ── /api/health ───────────────────────────────────────────────
@router.get("/health")
def api_health() -> dict:
    import glob
    from pathlib import Path
    from datetime import datetime
    from dashboard_api import MEMORY_FILE, OUTPUT_DIR

    latest_files = sorted(glob.glob(str(OUTPUT_DIR / "session_*.jsonl")))
    return {
        "status":              "ok",
        "version":             "2.0",
        "timestamp":           datetime.now().isoformat(),
        "memory_file_exists":  MEMORY_FILE.exists(),
        "output_dir_exists":   OUTPUT_DIR.exists(),
        "latest_session_file": Path(latest_files[-1]).name if latest_files else None,
    }


# ── /api/kpis  (filtre serveurs) ──────────────────────────────
@router.get("/kpis")
def api_kpis(
    servers: List[str] = Query(default=[]),
) -> dict:
    """
    Renvoie les KPIs filtrés par serveur.
    ?servers=auth&servers=web  → KPIs des domaines SSH+WEB uniquement.
    Aucun paramètre             → tous les serveurs.
    """
    def load_all():
        events = _latest_jsonl()
        memory = _load_memory()
        return _build_kpis(events, memory)

    # Sans filtre : version cachée normale
    if not servers:
        return _cached("kpis", load_all)

    # Avec filtre : recalcul ciblé (pas de cache commun pour éviter les collisions)
    engines = _engines_for_servers(servers)
    cache_key = f"kpis_{'_'.join(sorted(servers))}"

    def load_filtered():
        events = _latest_jsonl()
        memory = _load_memory()
        base = _build_kpis(events, memory)

        if not engines:
            return base

        # Filtre ssh_failures (SSH uniquement)
        if "SSH" not in engines:
            base["ssh_failures"] = None

        # Filtre blocked_ips (SSH)
        if "SSH" not in engines:
            base["blocked_ips"] = None

        # Reconstruit attack_pattern selon les domaines actifs
        # (on conserve si au moins un moteur actif, sinon on neutralise)
        active_engines_in_data = set()
        from dashboard_api import _get_event
        pass1 = _get_event(events, "PASS1_COMPLETE")
        by_dom = pass1.get("alarms_by_domain", {})
        for eng in engines:
            if int(by_dom.get(eng, 0)) > 0:
                active_engines_in_data.add(eng)

        if not active_engines_in_data:
            # Aucune alarme dans les serveurs sélectionnés
            base["ssh_failures"]       = 0
            base["blocked_ips"]        = 0
            base["alert_status"]       = "CLEAR"
            base["health_score"]       = 100.0
            base["unique_attacking_ips"] = 0
            base["attack_velocity"]    = 0.0
            base["is_velocity_spike"]  = False

        return base

    return _cached(cache_key, load_filtered)


# ── /api/alarms  (filtre serveurs) ────────────────────────────
@router.get("/alarms")
def api_alarms(
    servers: List[str] = Query(default=[]),
) -> list:
    """
    Renvoie les alarmes filtrées par serveur.
    ?servers=auth → uniquement les alarmes de moteur SSH.
    Aucun paramètre → toutes les alarmes.
    """
    def load_all():
        memory = _load_memory()
        return _build_alarms(memory)

    if not servers:
        return _cached("alarms", load_all)

    engines = _engines_for_servers(servers)
    cache_key = f"alarms_{'_'.join(sorted(servers))}"

    def load_filtered():
        memory = _load_memory()
        all_alarms = _build_alarms(memory)

        if not engines:
            return all_alarms

        # Filtre : garde uniquement les alarmes dont le moteur est dans engines
        filtered = [
            a for a in all_alarms
            if a.get("engine", "").upper() in engines
        ]
        return filtered

    return _cached(cache_key, load_filtered)


# ── /api/engine-scores  (filtre serveurs) ─────────────────────
@router.get("/engine-scores")
def api_engine_scores(
    servers: List[str] = Query(default=[]),
) -> list:
    def load_all():
        events = _latest_jsonl()
        memory = _load_memory()
        return _build_engine_scores(events, memory)

    if not servers:
        return _cached("engine_scores", load_all)

    engines = _engines_for_servers(servers)
    cache_key = f"engine_scores_{'_'.join(sorted(servers))}"

    def load_filtered():
        events = _latest_jsonl()
        memory = _load_memory()
        all_scores = _build_engine_scores(events, memory)
        if not engines:
            return all_scores
        return [s for s in all_scores if s.get("engine", "").upper() in engines]

    return _cached(cache_key, load_filtered)


# ── /api/sessions ─────────────────────────────────────────────
@router.get("/sessions")
def api_sessions() -> list:
    def load():
        from dashboard_api import _as_float_or_none
        mem  = _load_memory()
        sess = mem.get("sessions", [])
        result = []
        for s in reversed(sess[-20:]):
            d = s.get("donnees", {})
            result.append({
                "date":            s.get("date", ""),
                "threat_level":    d.get("agent_threat_level", "NORMAL"),
                "nb_alarms_pass1": int(d.get("nb_alarmes_pass1", d.get("nb_alarmes", 0))),
                "nb_alarms_final": int(d.get("nb_alarmes_final", d.get("nb_alarmes", 0))),
                "pass2_ran":       bool(d.get("pass2_ran", False)),
                "health_score":    _as_float_or_none(d.get("health_score")),
                "ips_suspectes":   d.get("ips_suspectes", []),
                "attack_pattern":  d.get("attack_pattern", "unknown"),
            })
        return result
    return _cached("sessions", load)


# ── /api/pipeline/latest ──────────────────────────────────────
@router.get("/pipeline/latest")
def api_pipeline_latest() -> dict:
    def load():
        events = _latest_jsonl()
        return {
            "events":     events,
            "log_lines":  _build_log_lines(events),
            "step_count": len(events),
        }
    return _cached("pipeline_latest", load)


# ── /api/decisions ────────────────────────────────────────────
@router.get("/decisions")
def api_decisions() -> list:
    def load():
        events = _latest_jsonl()
        memory = _load_memory()
        return _build_decisions(events, memory)
    return _cached("decisions", load)


# ── /api/trust ────────────────────────────────────────────────
@router.get("/trust")
def api_trust() -> dict:
    def load():
        events = _latest_jsonl()
        return _build_trust(events)
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
        events = _latest_jsonl()
        return _build_data_quality(events)
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
        mem = _load_memory()
        return {"ips": mem.get("ips_suspectes", [])}
    return _cached("suspicious_ips", load)


# ── /api/logs/stream ──────────────────────────────────────────
@router.get("/logs/stream")
def api_logs_stream() -> dict:
    def load():
        events = _latest_jsonl()
        return {"lines": _build_log_lines(events)[-60:]}
    return _cached("logs", load)


# ── /api/backtest-history ─────────────────────────────────────
@router.get("/backtest-history")
def api_backtest_history() -> list:
    def load():
        mem = _load_memory()
        return list(reversed(mem.get("backtest_history", [])))
    return _cached("backtest_history", load)

# ── /api/servers ──────────────────────────────────────────────
@router.get("/servers")
def api_servers() -> list[str]:
    """
    Retourne la liste dynamique des serveurs depuis la dernière session.

    Ordre de priorité des sources :
    1. sessions[-1]["donnees"]["serveurs_actifs"]
    2. sessions[-1]["donnees"]["server_ids"]
    3. sessions[-1]["donnees"]["alarmes"][*].server_id
    4. session_*.jsonl → PIPELINE_START.data_sources

    Aucun fallback statique. Retourne [] si aucune donnée disponible.
    """

    memory = _load_memory()
    sessions = memory.get("sessions", [])

    if not sessions:
        return []

    last_session = sessions[-1]
    donnees = last_session.get("donnees", {})

    # ── Source 1 : serveurs_actifs ─────────────────────────────
    servers = donnees.get("serveurs_actifs")
    if isinstance(servers, list) and servers:
        return sorted({str(s) for s in servers if s})

    # ── Source 2 : server_ids ──────────────────────────────────
    servers = donnees.get("server_ids")
    if isinstance(servers, list) and servers:
        return sorted({str(s) for s in servers if s})

    # ── Source 3 : alarmes ─────────────────────────────────────
    alarmes = donnees.get("alarmes", [])
    if isinstance(alarmes, list) and alarmes:
        extracted = {
            str(a.get("server_id") or a.get("Serveur"))
            for a in alarmes
            if isinstance(a, dict) and (a.get("server_id") or a.get("Serveur"))
        }
        if extracted:
            return sorted(extracted)

    # ── Source 4 : JSONL pipeline ──────────────────────────────
    try:
        events = _latest_jsonl()
        pipeline_start = _get_event(events, "PIPELINE_START") or {}
        sources = pipeline_start.get("data_sources", [])
        if isinstance(sources, list) and sources:
            return sorted({str(s) for s in sources if s})
    except Exception:
        pass

    return []