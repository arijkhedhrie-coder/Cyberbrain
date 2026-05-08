# api_dashboard.py

# ─────────────────────────────────────────────────────────────

from __future__ import annotations

from typing import List
from fastapi import APIRouter, Query



router = APIRouter(prefix="/api", tags=["dashboard"])

# ── Mapping label frontend → moteurs backend ──────────────────
_LABEL_TO_ENGINES: dict[str, list[str]] = {
    "auth":   ["SSH"],
    "web":    ["WEB"],
    "ftp":    ["FTP"],
    "kernel": ["KERNEL", "SESSION"],
}

# ── Libellés humains par label ────────────────────────────────
_LABEL_DISPLAY: dict[str, str] = {
    "auth":   "SSH Auth",
    "web":    "Web Server",
    "ftp":    "FTP Server",
    "kernel": "Kernel/Sys",
}

# ✅ [FIX-2] Mapping mots-clés S3 → label métier
# ORDRE IMPORTANT : du plus spécifique au plus général
# "sys" supprimé car trop générique (match "system", "session", "analysis")
_S3_KEYWORD_TO_LABEL: list[tuple[str, str]] = [
    # SSH / auth — spécifiques en premier
    ("sshd",     "auth"),
    ("auth",     "auth"),
    ("secure",   "auth"),
    ("ssh",      "auth"),
    # Web — spécifiques en premier
    ("nginx",    "web"),
    ("apache",   "web"),
    ("access",   "web"),
    ("http",     "web"),
    ("web",      "web"),
    # FTP — spécifiques en premier
    ("vsftpd",   "ftp"),
    ("xferlog",  "ftp"),
    ("xfer",     "ftp"),
    ("ftp",      "ftp"),
    # Kernel / system — ✅ FIX: "syslog" et "system" au lieu de "sys"
    ("kern",     "kernel"),
    ("dmesg",    "kernel"),
    ("syslog",   "kernel"),   # ← "syslog" avant "system"
    ("system",   "kernel"),   # ← "system" explicite (pas "sys")
    ("kernel",   "kernel"),
    # ❌ ("sys", "kernel") SUPPRIMÉ — trop générique
    # matchait "session", "analysis", "synology", etc.
]

_VALID_LABELS = set(_LABEL_TO_ENGINES.keys())


def _s3_id_to_label(server_id: str) -> str | None:
    """
    Convertit un ID de fichier S3 (ex: "dataset_auth_2026-03-10_06-32")
    en label métier (ex: "auth").
    Retourne None si aucun label reconnu.
    """
    lower = server_id.lower()
    for keyword, label in _S3_KEYWORD_TO_LABEL:
        if keyword in lower:
            return label
    return None


def _engines_for_servers(servers: list[str]) -> set[str]:
    """
    ✅ [FIX-3] Convertit une liste de serveurs en ensemble de moteurs backend.

    Accepte les deux formats :
    - Labels métier directs : "auth", "web", "ftp", "kernel"
    - IDs S3 timestamp    : "2026-03-10_06-32", "dataset_auth_2026-03-10"

    Log WARN si un serveur n'est pas reconnu.
    Retourne un set vide si servers est vide (= pas de filtre).
    """
    engines: set[str] = set()
    for s in servers:
        label = s.lower()
        if label in _LABEL_TO_ENGINES:
            # Format direct : "auth", "web", etc.
            engines.update(_LABEL_TO_ENGINES[label])
        else:
            # Format S3 : tente de déduire le label métier
            inferred = _s3_id_to_label(s)
            if inferred:
                engines.update(_LABEL_TO_ENGINES[inferred])
            else:
                #  [FIX-3] Log visible au lieu d'ignorer silencieusement
                print(f"[WARN][api_dashboard] Unknown server label: '{s}' — ignoré dans le filtre")
    return engines


# ── /api/health ───────────────────────────────────────────────
@router.get("/health")
def api_health() -> dict:
    import glob
    from pathlib import Path
    from datetime import datetime
    from app.api.routes.dashboard_routes import MEMORY_FILE, OUTPUT_DIR

    latest_files = sorted(glob.glob(str(OUTPUT_DIR / "session_*.jsonl")))
    return {
        "status":              "ok",
        "version":             "2.0",
        "timestamp":           datetime.now().isoformat(),
        "memory_file_exists":  MEMORY_FILE.exists(),
        "output_dir_exists":   OUTPUT_DIR.exists(),
        "latest_session_file": Path(latest_files[-1]).name if latest_files else None,
    }


# ── /api/servers ──────────────────────────────────────────────
@router.get("/servers")
def api_servers(
    format: str = Query(default="list"),   # "list" | "rich"
) -> list:
    """
    Retourne les serveurs actifs avec fallback robuste en 5 étapes.

    ?format=list (défaut) → list[str]  — labels métier pour le filtrage API
    ?format=rich          → list[dict] — structure riche pour l'UI

    Ordre de priorité des sources :
      1. memory["sessions"][-1]["donnees"]["serveurs_actifs"]
      2. memory["sessions"][-1]["donnees"]["server_ids"]
      3. memory["sessions"][-1]["donnees"]["alarmes"][*].server_id
      4. PIPELINE_START.data_sources dans le dernier JSONL
      5. ✅ FALLBACK ENGINE : _build_engine_scores() → engines actifs → labels

    Le fallback engine (étape 5) résout le cas où le pipeline tourne
    mais ne sauvegarde pas encore server_ids (version antérieure du pipeline).
    Tant que des alarmes existent avec engine=SSH/WEB/FTP/KERNEL,
    les serveurs correspondants sont retournés.
    """
    memory   = _load_memory()
    sessions = memory.get("sessions", [])

    raw_ids: list[str] = []

    if sessions:
        last_session = sessions[-1]
        donnees      = last_session.get("donnees", {})

        # Source 1 : serveurs_actifs (labels métier directs)
        s = donnees.get("serveurs_actifs")
        if isinstance(s, list) and s:
            raw_ids = [str(x) for x in s if x]

        # Source 2 : server_ids
        if not raw_ids:
            s = donnees.get("server_ids")
            if isinstance(s, list) and s:
                raw_ids = [str(x) for x in s if x]

        # Source 3 : alarmes → server_id ou Serveur
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

    # Source 4 : PIPELINE_START.data_sources (JSONL)
    if not raw_ids:
        try:
            events = _latest_jsonl()
            from dashboard_routes import _get_event
            pipeline_start = _get_event(events, "PIPELINE_START") or {}
            sources = pipeline_start.get("data_sources", [])
            if isinstance(sources, list) and sources:
                raw_ids = [str(s) for s in sources if s]
        except Exception:
            pass

    # ── Tente de convertir raw_ids en labels métier ───────────
    labels_found: set[str] = set()

    if raw_ids:
        for raw_id in raw_ids:
            if raw_id.lower() in _VALID_LABELS:
                labels_found.add(raw_id.lower())
            else:
                inferred = _s3_id_to_label(raw_id)
                if inferred:
                    labels_found.add(inferred)
                else:
                    print(f"[WARN][api_dashboard] ID non reconnu: '{raw_id}' — ignoré")

    # Source 5 : FALLBACK ALARMES (prioritaire sur engine-scores)
    # Lit depuis long_term_memory.json (toujours disponible si pipeline a tourné).
    # _build_alarms(memory) ne dépend PAS des fichiers JSONL → plus fiable.
    # Chaque alarme expose "engine" (SSH/WEB/FTP/KERNEL) → on déduit le label.
    if not labels_found:
        print("[INFO][api_dashboard] Fallback alarmes-mémoire pour détecter les serveurs")
        _ENGINE_TO_LABEL_LOCAL = {
            "SSH": "auth", "WEB": "web", "FTP": "ftp",
            "KERNEL": "kernel", "SESSION": "kernel",
            "PREDICTION": "kernel", "CORRELATION": "auth",
        }
        try:
            memory3    = _load_memory()
            all_alarms = _build_alarms(memory3)
            for a in all_alarms:
                engine = str(a.get("engine") or "").upper()
                label  = _ENGINE_TO_LABEL_LOCAL.get(engine, "")
                if label:
                    labels_found.add(label)
            if labels_found:
                print(f"[INFO][api_dashboard] Labels déduits depuis alarmes: {labels_found}")
            else:
                print("[WARN][api_dashboard] Aucune alarme exploitable dans la mémoire")
        except Exception as e:
            print(f"[WARN][api_dashboard] Fallback alarmes échoué: {e}")

    # Source 6 : FALLBACK ENGINE-SCORES (dépend des fichiers JSONL)
    # Utilisé uniquement si la Source 5 a échoué.
    if not labels_found:
        print("[INFO][api_dashboard] Fallback engine-scores JSONL")
        try:
            events  = _latest_jsonl()
            memory2 = _load_memory()
            scores  = _build_engine_scores(events, memory2)
            active_engines = {
                str(s.get("engine", "")).upper()
                for s in scores
                if s.get("engine")
            }
            print(f"[INFO][api_dashboard] Engines JSONL détectés: {active_engines}")
            for label, engines in _LABEL_TO_ENGINES.items():
                if any(e in active_engines for e in engines):
                    labels_found.add(label)
        except Exception as e:
            print(f"[WARN][api_dashboard] Fallback engine-scores échoué: {e}")

    if not labels_found:
        print("[WARN][api_dashboard] /api/servers : aucune source n'a fourni de labels → []")
        return []

    # Ordre logique des labels
    ordered_labels = [l for l in ["auth", "web", "ftp", "kernel"] if l in labels_found]
    ordered_labels += sorted(labels_found - set(ordered_labels))

    print(f"[INFO][api_dashboard] /api/servers → {ordered_labels}")

    # Format rich : structure complète pour l'UI
    if format == "rich":
        return [
            {
                "id":      label,
                "label":   label,
                "display": _LABEL_DISPLAY.get(label, label),
                "sources": [label],
            }
            for label in ordered_labels
        ]

    # Format list (défaut) : list[str] de labels métier
    return ordered_labels


# ── /api/kpis  (filtre serveurs) ──────────────────────────────
@router.get("/kpis")
def api_kpis(
    servers: List[str] = Query(default=[]),
) -> dict:
    def load_all():
        events = _latest_jsonl()
        memory = _load_memory()
        return _build_kpis(events, memory)

    if not servers:
        return _cached("kpis", load_all)

    engines = _engines_for_servers(servers)
    cache_key = f"kpis_{'_'.join(sorted(servers))}"

    def load_filtered():
        events = _latest_jsonl()
        memory = _load_memory()
        base   = _build_kpis(events, memory)

        if not engines:
            return base

        if "SSH" not in engines:
            base["ssh_failures"] = None
            base["blocked_ips"]  = None

        active_engines_in_data = set()
        from dashboard_routes import _get_event
        pass1  = _get_event(events, "PASS1_COMPLETE")
        by_dom = pass1.get("alarms_by_domain", {})
        for eng in engines:
            if int(by_dom.get(eng, 0)) > 0:
                active_engines_in_data.add(eng)

        if not active_engines_in_data:
            base["ssh_failures"]        = 0
            base["blocked_ips"]         = 0
            base["alert_status"]        = "CLEAR"
            base["health_score"]        = 100.0
            base["unique_attacking_ips"] = 0
            base["attack_velocity"]     = 0.0
            base["is_velocity_spike"]   = False

        return base

    return _cached(cache_key, load_filtered)


# ── Filtre alarmes à deux niveaux ────────────────────────────
# Niveau 1 (prioritaire) : server_id direct (assigné par le pipeline après fix)
# Niveau 2 (fallback)    : engine → label   (rétrocompatibilité alarmes sans server_id)
_ENGINE_TO_LABEL: dict[str, str] = {
    "SSH":         "auth",
    "WEB":         "web",
    "FTP":         "ftp",
    "KERNEL":      "kernel",
    "SESSION":     "kernel",
    "PREDICTION":  "kernel",
    "CORRELATION": "auth",
}

def _filter_alarms_by_servers(all_alarms: list[dict], servers: list[str]) -> list[dict]:
    """
    Filtre les alarmes sur les serveurs sélectionnés.

    Double logique (couvre pipeline fixé ET alarmes legacy) :
      1. server_id direct : a["server_id"] in servers
      2. engine → label   : _ENGINE_TO_LABEL[a["engine"]] in servers

    En production (après fix BLOC 2 de PATCH_main_py.py), toutes les
    alarmes auront un server_id → le niveau 2 devient redondant mais
    assure la rétrocompatibilité sans casser l'existant.
    """
    servers_set = {s.lower() for s in servers}
    result = []

    for a in all_alarms:
        # Niveau 1 : server_id direct (pipeline fixé)
        sid = str(a.get("server_id") or "").lower()
        if sid and sid in servers_set:
            result.append(a)
            continue

        # Niveau 2 : engine → label (fallback alarmes sans server_id)
        engine = str(a.get("engine") or "").upper()
        label  = _ENGINE_TO_LABEL.get(engine, "")
        if label and label in servers_set:
            result.append(a)

    return result


# ── /api/alarms  (filtre serveurs) ────────────────────────────
@router.get("/alarms")
def api_alarms(
    servers: List[str] = Query(default=[]),
) -> list:
    def load_all():
        memory = _load_memory()
        return _build_alarms(memory)

    if not servers:
        return _cached("alarms", load_all)

    cache_key = f"alarms_{'_'.join(sorted(servers))}"

    def load_filtered():
        memory     = _load_memory()
        all_alarms = _build_alarms(memory)
        # ✅ Filtre à deux niveaux : server_id direct + engine fallback
        return _filter_alarms_by_servers(all_alarms, servers)

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
        events     = _latest_jsonl()
        memory     = _load_memory()
        all_scores = _build_engine_scores(events, memory)
        if not engines:
            return all_scores
        return [s for s in all_scores if s.get("engine", "").upper() in engines]

    return _cached(cache_key, load_filtered)


# ── /api/sessions ─────────────────────────────────────────────
@router.get("/sessions")
def api_sessions() -> list:
    def load():
        from dashboard_routes import _as_float_or_none
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
        events = _latest_jsonl()
        memory = _load_memory()
        return _build_decisions(events, memory)
    return _cached("decisions", load)


# ── /api/pipeline/latest ──────────────────────────────────────
@router.get("/pipeline/latest")
def api_pipeline_latest() -> dict:
    def load():
        events = _latest_jsonl()
        return {
            "events":     [e for e in events if isinstance(e, dict)][-50:],
            "log_lines":  _build_log_lines(events)[-60:],
            "step_count": len(events),
        }
    return _cached("pipeline_latest", load)


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
"""
AJOUT À dashboard_api.py (Flask, port 5000)
===========================================
Endpoint : GET /api/minimization
Retourne une timeseries du nb d'alarmes par session pour construire
la "courbe de minimisation" du risque.

COMMENT L'INTÉGRER :
  1. Coller ce bloc dans dashboard_api.py (après les imports existants)
  2. Redémarrer le Flask

DÉPENDANCES : déjà présentes dans ton projet (json, datetime, Path, Flask)
"""

# ── Import à ajouter si pas encore présent ──────────────────────────────────
from collections import deque
from datetime import datetime
from pathlib import Path
import json

# ── Buffer en mémoire : 20 derniers points temps-réel ───────────────────────
# (remis à zéro au redémarrage du Flask — c'est voulu pour le temps-réel)
_MINIMIZATION_BUFFER: deque = deque(maxlen=20)


def _push_minimization_point(nb_alarmes: int, health_score: float = 100.0) -> None:
    """
    À appeler depuis agents.py (ou main.py) à la fin de chaque pipeline.
    Exemple d'appel depuis agents.py :
        from app.api.routes.dashboard import _push_minimization_point
        _push_minimization_point(nb_alarmes=len(alarmes_final), health_score=metrics_summary["health_score"])
    """
    _MINIMIZATION_BUFFER.append({
        "timestamp": datetime.now().strftime("%H:%M:%S"),
        "alarmes":   nb_alarmes,
        "risque":    max(0, round(100 - health_score, 1)),  # % risque résiduel
    })


def _build_minimization_from_memory() -> list:
    """
    Si le buffer est vide (Flask vient de démarrer),
    reconstitue la courbe depuis long_term_memory.json
    en lisant les 20 dernières sessions.
    """
    PROJECT_ROOT = Path(__file__).resolve().parents[1]
    memory_file  = PROJECT_ROOT / "long_term_memory.json"

    if not memory_file.exists():
        return []

    try:
        with open(memory_file, "r", encoding="utf-8", errors="replace") as f:
            mem = json.load(f)

        sessions = mem.get("sessions", [])[-20:]  # 20 dernières
        series = []

        for s in sessions:
            donnees = s.get("donnees", {})
            nb_alarmes   = donnees.get("nb_alarmes_final", donnees.get("nb_anomalies", 0))
            health_score = donnees.get("health_score", 100.0)
            date_str     = s.get("date", "")[:19].replace("T", " ")  # "2026-03-10 14:23:01"

            # Garde juste HH:MM pour l'affichage
            try:
                t_label = datetime.fromisoformat(s.get("date", "")).strftime("%H:%M")
            except Exception:
                t_label = date_str[-8:-3] if len(date_str) >= 8 else "?"

            series.append({
                "timestamp": t_label,
                "alarmes":   int(nb_alarmes) if nb_alarmes is not None else 0,
                "risque":    max(0, round(100 - float(health_score or 100), 1)),
            })

        return series

    except Exception as e:
        print(f"[MINIMIZATION] Erreur lecture mémoire : {e}")
        return []


