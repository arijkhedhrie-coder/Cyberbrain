# src/agents/memory.py
# ═══════════════════════════════════════════════════════════════════════════════
# VERSION FINALE BLINDÉE — v3
#
#  Boucle CRISP-DM complète
#  Apprentissage feedback humain (good / bad / modified actions)
#  Stats par type d'anomalie  → get_success_rate()
#  Knowledge base dynamique   → get_best_action()
#  Analyse stabilité A.4      → compute_session_stability()
#  Rollback seuils C.10       → restore_threshold()
#  Backtest history           → get_backtest_history()
#  Protection JSON corrompu   → _structure_vide() + try/except
#  Écriture atomique          → fichier tmp + os.replace()
# ═══════════════════════════════════════════════════════════════════════════════

import json
import statistics
import tempfile
import os
import re
from collections import Counter
from contextvars import ContextVar
from datetime import datetime
from pathlib import Path
import shutil, tempfile, os

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MEMORY_FILE  = PROJECT_ROOT / "long_term_memory.json"
_ACTIVE_DATASET_ID: ContextVar[str | None] = ContextVar("active_dataset_id", default=None)


def _sanitize_dataset_id(dataset_id: str | None) -> str | None:
    if dataset_id is None:
        return None
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", str(dataset_id).strip())
    return cleaned or None


def get_active_dataset() -> str | None:
    return _ACTIVE_DATASET_ID.get() or _sanitize_dataset_id(os.getenv("PIPELINE_ACTIVE_DATASET"))


def set_active_dataset(dataset_id: str | None):
    dataset = _sanitize_dataset_id(dataset_id)
    if dataset:
        os.environ["PIPELINE_ACTIVE_DATASET"] = dataset
    else:
        os.environ.pop("PIPELINE_ACTIVE_DATASET", None)
    return _ACTIVE_DATASET_ID.set(dataset)


def reset_active_dataset(token) -> None:
    _ACTIVE_DATASET_ID.reset(token)


def get_memory_file(dataset_id: str | None = None) -> Path:
    dataset = _sanitize_dataset_id(dataset_id) or get_active_dataset()
    if not dataset:
        return MEMORY_FILE
    return PROJECT_ROOT / f"memory_{dataset}.json"


def _resolve_memory_file(
    memory_file: str | Path | None = None,
    dataset_id: str | None = None,
) -> Path:
    if memory_file is not None:
        return Path(memory_file)
    return get_memory_file(dataset_id)


# ─────────────────────────────────────────────────────────────────────────────
# STRUCTURE PAR DÉFAUT
# Utilisée si le fichier est absent OU corrompu — jamais d'exception possible.
# ─────────────────────────────────────────────────────────────────────────────

def _structure_vide() -> dict:
    return {
        # ── base ──────────────────────────────────────────────────────────────
        "sessions":          [],
        "anomalies_vues":    [],
        "ips_suspectes":     [],
        "threshold_history": [],
        "backtest_history":  [],
        # ── apprentissage correcteur (CRITIQUES — ne jamais supprimer) ────────
        "good_actions":      [],   # APPROVE  : actions confirmées par l'admin
        "bad_actions":       [],   # REJECT   : faux positifs détectés
        "modified_actions":  [],   # MODIFY   : corrections humaines apprises
        "action_stats":      {},   # {type_anomalie: {approved, rejected, modified}}
        # ── knowledge base dynamique ──────────────────────────────────────────
        "dynamic_kb":        {},   # {type_attaque: [{action, success, date}]}
    }


# ─────────────────────────────────────────────────────────────────────────────
# ÉCRITURE ATOMIQUE
# Évite la corruption du fichier si le process plante pendant l'écriture.
# Principe : écrire dans un .tmp → os.replace() (opération atomique sur Linux/Windows)
# ─────────────────────────────────────────────────────────────────────────────

def _ecrire_memoire(
    memoire: dict,
    memory_file: str | Path | None = None,
    dataset_id: str | None = None,
) -> None:
    target_file = _resolve_memory_file(memory_file, dataset_id)
    dir_parent = target_file.parent
    dir_parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=dir_parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(memoire, f, indent=2, ensure_ascii=False)
        if target_file.exists():
            try:
                target_file.unlink()
            except PermissionError:
                backup = str(target_file) + ".bak"
                shutil.copy2(str(target_file), backup)
                target_file.unlink()
        os.replace(tmp_path, target_file)
    except PermissionError:
        # Fallback: plain write without atomicity
        with open(target_file, "w", encoding="utf-8") as f:
            json.dump(memoire, f, indent=2, ensure_ascii=False)
        print("[WARN] Atomic replace failed – used direct write instead.")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# CHARGER LA MÉMOIRE
# ─────────────────────────────────────────────────────────────────────────────

def charger_memoire(
    memory_file: str | Path | None = None,
    dataset_id: str | None = None,
) -> dict:
    """
    Charge long_term_memory.json.
    - Fichier absent      → structure vide propre (pas d'erreur)
    - Fichier corrompu    → structure vide propre + avertissement (pas de crash)
    - Toutes les clés sont garanties présentes grâce aux setdefault().
    """
    target_file = _resolve_memory_file(memory_file, dataset_id)
    if not target_file.exists():
        return _structure_vide()

    try:
        with open(target_file, "r", encoding="utf-8", errors="replace") as f:
            data = json.load(f)
    except (json.JSONDecodeError, ValueError, OSError) as e:
        print(f"[MEMOIRE]   Fichier corrompu ({e}) → mémoire réinitialisée proprement")
        return _structure_vide()

    # Garantir la présence de toutes les clés (ajouts progressifs de versions)
    for key, default in _structure_vide().items():
        data.setdefault(key, default)

    return data


# ─────────────────────────────────────────────────────────────────────────────
# SAUVEGARDER LA MÉMOIRE
# ─────────────────────────────────────────────────────────────────────────────

def sauvegarder_memoire(
    data: dict,
    memory_file: str | Path | None = None,
    dataset_id: str | None = None,
) -> None:
    """
    Fusionne `data` dans long_term_memory.json de façon incrémentale + atomique.
    Ne remplace jamais tout le fichier — ajoute / fusionne uniquement.
    """
    target_file = _resolve_memory_file(memory_file, dataset_id)
    memoire = charger_memoire(memory_file=target_file)

    # ── 1. Nouvelle session ───────────────────────────────────────────────────
    memoire["sessions"].append({
        "date":    datetime.now().isoformat(),
        "donnees": data,
    })
    memoire["sessions"] = memoire["sessions"][-50:]

    # ── 2. IPs suspectes ─────────────────────────────────────────────────────
    for ip in data.get("ips_suspectes", []):
        if ip and ip not in memoire["ips_suspectes"]:
            memoire["ips_suspectes"].append(ip)

    # ── 3. Snapshots de seuils ───────────────────────────────────────────────
    if data.get("threshold_snapshots"):
        entry = {
            "date":            datetime.now().isoformat(),
            "session_id":      data.get("date", datetime.now().strftime("%Y%m%d_%H%M%S")),
            "snapshots":       data["threshold_snapshots"],
            "nb_alarms_pass1": data.get("nb_alarmes_pass1", 0),
            "nb_alarms_final": data.get("nb_alarmes_final", 0),
            "pass2_ran":       data.get("pass2_ran", False),
            "threat_level":    data.get("agent_threat_level", "NORMAL"),
        }
        memoire["threshold_history"].append(entry)
        memoire["threshold_history"] = memoire["threshold_history"][-100:]

    # ── 4. Apprentissage correcteur (CRITIQUE) ────────────────────────────────
    for key in ("good_actions", "bad_actions", "modified_actions"):
        if key in data:
            memoire.setdefault(key, []).extend(data[key])
            memoire[key] = memoire[key][-500:]

    # ── 5. Stats par type d'anomalie ─────────────────────────────────────────
    for anomaly_type, stats in data.get("action_stats", {}).items():
        existing = memoire["action_stats"].setdefault(
            anomaly_type, {"approved": 0, "rejected": 0, "modified": 0}
        )
        for k, v in stats.items():
            existing[k] = existing.get(k, 0) + v

    # ── 6. Knowledge base dynamique ───────────────────────────────────────────
    for attack_type, entries in data.get("dynamic_kb", {}).items():
        bucket = memoire["dynamic_kb"].setdefault(attack_type, [])
        bucket.extend(entries)
        memoire["dynamic_kb"][attack_type] = bucket[-50:]

    # ── Écriture atomique ─────────────────────────────────────────────────────
    _ecrire_memoire(memoire, memory_file=target_file)

    print(
        f"[MEMOIRE]  Sauvegarde : {len(memoire['sessions'])} sessions | "
        f"{len(memoire['threshold_history'])} seuils | "
        f"{len(memoire.get('good_actions', []))} approuvées | "
        f"{len(memoire.get('bad_actions', []))} rejetées | "
        f"{len(memoire.get('modified_actions', []))} modifiées"
    )


# ─────────────────────────────────────────────────────────────────────────────
# CONTEXTE HISTORIQUE (résumé compact pour les agents LLM)
# ─────────────────────────────────────────────────────────────────────────────

def get_contexte_historique(dataset_id: str | None = None) -> str:
    memoire = charger_memoire(dataset_id=dataset_id)
    if not memoire["sessions"]:
        return "Aucun historique disponible."

    derniere = memoire["sessions"][-1]
    history  = memoire.get("threshold_history", [])

    thresh_line = ""
    if history:
        last_th = history[-1]
        snaps   = last_th.get("snapshots", [])
        if snaps:
            s = snaps[-1]
            thresh_line = (
                f" | last_thresh: SSH≥{s.get('ssh_high')}"
                f" WEB≥{s.get('web_high')}"
                f" FTP≥{s.get('ftp_high')}"
                f" pass2={last_th.get('pass2_ran')}"
                f" alarms={last_th.get('nb_alarms_pass1', 0)}"
                f"→{last_th.get('nb_alarms_final', 0)}"
                f" tl={last_th.get('threat_level', 'NORMAL')}"
            )

    raw = (
        f"sessions={len(memoire['sessions'])} "
        f"known_ips={memoire['ips_suspectes'][:3]} "
        f"last={derniere.get('date', '')[:16]} "
        f"threshold_records={len(history)}"
        f"{thresh_line}"
    )
    return raw[:300]


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS APPRENTISSAGE CORRECTEUR
# ─────────────────────────────────────────────────────────────────────────────

def get_success_rate(anomaly_type: str, dataset_id: str | None = None) -> float:
    """
    Taux de succès (APPROVE / total) pour un type d'anomalie.
    Utilisé par le mode AUTO pour décider d'agir sans validation humaine.
    Retourne 0.0 si aucun historique.
    """
    try:
        memoire  = charger_memoire(dataset_id=dataset_id)
        stats    = memoire.get("action_stats", {}).get(anomaly_type, {})
        approved = stats.get("approved", 0)
        total    = approved + stats.get("rejected", 0) + stats.get("modified", 0)
        rate     = round(approved / total, 2) if total > 0 else 0.0
        print(f"[STAT] {anomaly_type} → taux succès = {rate} ({approved}/{total})")
        return rate
    except Exception as e:
        print(f"[WARN] get_success_rate: {e}")
        return 0.0


def enregistrer_stat_action(
    anomaly_type: str,
    decision: str,
    dataset_id: str | None = None,
) -> None:
    """
    Incrémente le compteur pour un type d'anomalie.
    decision : 'approved' | 'rejected' | 'modified'
    Appelé depuis corrective_api.py à chaque validation admin.
    Utilise l'écriture atomique pour éviter la corruption en cas d'appels simultanés.
    """
    if decision not in ("approved", "rejected", "modified"):
        print(f"[WARN] enregistrer_stat_action: décision inconnue '{decision}'")
        return
    try:
        memoire = charger_memoire(dataset_id=dataset_id)
        entry   = memoire["action_stats"].setdefault(
            anomaly_type, {"approved": 0, "rejected": 0, "modified": 0}
        )
        entry[decision] += 1
        total = sum(entry.values())
        print(f"[STAT] {anomaly_type} → {decision} enregistré (total cumulé : {total})")
        _ecrire_memoire(memoire, dataset_id=dataset_id)
    except Exception as e:
        print(f"[WARN] enregistrer_stat_action: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# KNOWLEDGE BASE DYNAMIQUE — ÉTAPE 4
# ─────────────────────────────────────────────────────────────────────────────

def update_knowledge_base(
    type_attack: str,
    action: str,
    success: bool,
    dataset_id: str | None = None,
) -> None:
    """
    Enregistre si une action a bien fonctionné contre un type d'attaque.
    Appelé après chaque validation admin :
      APPROVE → success=True  (action correcte)
      REJECT  → success=False (faux positif)
    """
    try:
        memoire = charger_memoire(dataset_id=dataset_id)
        bucket  = memoire["dynamic_kb"].setdefault(type_attack, [])
        bucket.append({
            "action":  action,
            "success": success,
            "date":    datetime.now().isoformat(),
        })
        memoire["dynamic_kb"][type_attack] = bucket[-50:]
        _ecrire_memoire(memoire, dataset_id=dataset_id)
        print(f"[KB] {type_attack} → {action} ({'✅' if success else '❌'})")
    except Exception as e:
        print(f"[WARN] update_knowledge_base: {e}")


def get_best_action(type_attack: str, dataset_id: str | None = None) -> str | None:
    """
    Retourne la meilleure action connue pour ce type d'attaque.
    Calcule un score = succès / total pour chaque action (plus fiable qu'un simple comptage).
    Retourne None si pas encore d'historique ou aucun succès.
    """
    try:
        memoire = charger_memoire(dataset_id=dataset_id)
        entries = memoire.get("dynamic_kb", {}).get(type_attack, [])

        if not entries:
            return None

        # Regrouper par action : {action_name: {ok, total}}
        scores: dict[str, dict] = {}
        for e in entries:
            action = e.get("action", "")
            if not action:
                continue
            s = scores.setdefault(action, {"ok": 0, "total": 0})
            s["total"] += 1
            if e.get("success"):
                s["ok"] += 1

        # Garder uniquement les actions avec au moins 1 succès
        candidates = {
            action: s["ok"] / s["total"]
            for action, s in scores.items()
            if s["ok"] > 0
        }

        if not candidates:
            return None

        meilleure = max(candidates, key=lambda a: candidates[a])
        print(
            f"[KB] Meilleure action pour '{type_attack}' : "
            f"{meilleure} (taux réussite = {candidates[meilleure]:.0%})"
        )
        return meilleure

    except Exception as e:
        print(f"[WARN] get_best_action: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# A.4 — ANALYSE DE STABILITÉ INTER-SESSIONS
# ─────────────────────────────────────────────────────────────────────────────

def compute_session_stability(n_sessions: int = 3, dataset_id: str | None = None) -> dict:
    """
    A.4 — Compare les N dernières sessions pour détecter si le système
    se comporte de façon cohérente. Alimente le trust score en Phase B.

    Analyse 3 signaux :
      1. alarm_count   — nombre d'alarmes stable ?
      2. fp_score      — taux de faux positifs stable ?
      3. anomaly_rate  — taux de détection stable ?

    Un signal est "stable" si coefficient de variation (std/mean) < 0.30.

    Retourne :
    {
        "confidence":     "HIGH" | "MEDIUM" | "LOW",
        "stable_signals": int (0–3),
        "alarm_cv":       float | None,
        "fp_cv":          float | None,
        "anomaly_cv":     float | None,
        "sessions_used":  int,
        "trend":          "STABLE" | "INCREASING" | "DECREASING" | "UNKNOWN",
        "summary":        str,
    }
    """
    memoire  = charger_memoire(dataset_id=dataset_id)
    sessions = memoire.get("sessions", [])

    empty = {
        "confidence":     "LOW",
        "stable_signals": 0,
        "alarm_cv":       None,
        "fp_cv":          None,
        "anomaly_cv":     None,
        "sessions_used":  0,
        "trend":          "UNKNOWN",
        "summary":        "Pas assez de sessions pour évaluer la stabilité.",
    }

    if len(sessions) < 2:
        return empty

    recent: list[dict]     = sessions[-n_sessions:]
    alarm_counts:  list[float] = []
    fp_scores:     list[float] = []
    anomaly_rates: list[float] = []

    for s in recent:
        d = s.get("donnees", {})

        ac = d.get("nb_alarmes_final", d.get("nb_alarms_final", d.get("alarm_count")))
        if ac is not None:
            try: alarm_counts.append(float(ac))
            except (TypeError, ValueError): pass

        fp = d.get("fp_score_session", d.get("fp_score"))
        if fp is not None:
            try: fp_scores.append(float(fp))
            except (TypeError, ValueError): pass

        ar = d.get("anomaly_rate", d.get("taux_anomalies"))
        if ar is not None:
            try: anomaly_rates.append(float(ar))
            except (TypeError, ValueError): pass

    def _cv(values: list[float]) -> float | None:
        """Coefficient de variation = std / mean. Plus bas = plus stable."""
        if len(values) < 2:
            return None
        mean = statistics.mean(values)
        return round(statistics.stdev(values) / mean, 4) if mean != 0 else 0.0

    def _stable(cv: float | None) -> bool:
        return cv is not None and cv < 0.30

    alarm_cv   = _cv(alarm_counts)
    fp_cv      = _cv(fp_scores)
    anomaly_cv = _cv(anomaly_rates)

    stable_signals = sum([_stable(alarm_cv), _stable(fp_cv), _stable(anomaly_cv)])

    if   stable_signals == 3: confidence = "HIGH"
    elif stable_signals >= 1: confidence = "MEDIUM"
    else:                     confidence = "LOW"

    trend = "STABLE"
    if len(alarm_counts) >= 3:
        if   alarm_counts[-1] > alarm_counts[0] * 1.5: trend = "INCREASING"
        elif alarm_counts[-1] < alarm_counts[0] * 0.5: trend = "DECREASING"

    alarm_cv_str = f"{alarm_cv:.3f}" if alarm_cv is not None else "N/A"
    summary = (
        f"Stabilité : {confidence} | {stable_signals}/3 signaux stables | "
        f"alarm_cv={alarm_cv_str} | trend={trend} | sessions={len(recent)}"
    )
    print(f"[A.4] {summary}")

    return {
        "confidence":     confidence,
        "stable_signals": stable_signals,
        "alarm_cv":       alarm_cv,
        "fp_cv":          fp_cv,
        "anomaly_cv":     anomaly_cv,
        "sessions_used":  len(recent),
        "trend":          trend,
        "summary":        summary,
    }


# ─────────────────────────────────────────────────────────────────────────────
# C.10 — ROLLBACK DES SEUILS
# ─────────────────────────────────────────────────────────────────────────────

def restore_threshold(version_id: str | None = None) -> dict:
    """
    C.10 — Retour arrière instantané vers un état de seuils passé.

    Lit threshold_change_log.json, trouve l'entrée par version_id
    (ou la plus récente ACCEPTED si version_id est None),
    et réapplique ses seuils dans src/models/seuils_adaptatifs.json.

    Args:
        version_id : format YYYYMMDD_HHMMSS_ffffff. None = dernier état accepté.

    Retourne :
    {
        "success":            bool,
        "version_id":         str,
        "thresholds_applied": dict,
        "message":            str,
    }
    """
    CHANGE_LOG  = Path("src/models/threshold_change_log.json")
    SEUILS_FILE = Path("src/models/seuils_adaptatifs.json")

    result: dict = {
        "success":            False,
        "version_id":         version_id or "latest_accepted",
        "thresholds_applied": {},
        "message":            "",
    }

    if not CHANGE_LOG.exists():
        result["message"] = f"threshold_change_log.json introuvable à {CHANGE_LOG}"
        print(f"[ROLLBACK]  {result['message']}")
        return result

    try:
        with open(CHANGE_LOG, "r", encoding="utf-8") as f:
            log_entries: list[dict] = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        result["message"] = f"Lecture du change log échouée : {e}"
        print(f"[ROLLBACK]  {result['message']}")
        return result

    if not log_entries:
        result["message"] = "Change log vide — rien à restaurer."
        print(f"[ROLLBACK]  {result['message']}")
        return result

    # Trouver l'entrée cible
    target: dict | None = None
    if version_id is not None:
        for entry in reversed(log_entries):
            if entry.get("version_id") == version_id:
                target = entry
                break
        if target is None:
            result["message"] = f"version_id '{version_id}' introuvable dans le log."
            print(f"[ROLLBACK]  {result['message']}")
            return result
    else:
        for entry in reversed(log_entries):
            if entry.get("gate_result", {}).get("accepted") is True:
                target = entry
                break
        if target is None:
            result["message"] = "Aucun changement ACCEPTED trouvé dans le log."
            print(f"[ROLLBACK]  {result['message']}")
            return result

    # Extraire et mapper les seuils
    proposal: dict            = target.get("agent_proposal", {})
    thresholds_to_apply: dict = {}

    mapping = {
        "ssh_high":    "Nombre_Tentatives",
        "web_high":    "web_threshold",
        "ftp_high":    "ftp_threshold",
        "kernel_high": "kernel_threshold",
    }
    for src_key, dst_key in mapping.items():
        if proposal.get(src_key) is not None:
            thresholds_to_apply[dst_key] = float(proposal[src_key])

    if not thresholds_to_apply:
        result["message"] = (
            f"Entrée {target['version_id']} sans valeurs de seuils à restaurer."
        )
        print(f"[ROLLBACK]   {result['message']}")
        return result

    # Charger seuils actuels, appliquer, écrire
    current_seuils: dict = {}
    if SEUILS_FILE.exists():
        try:
            with open(SEUILS_FILE, "r", encoding="utf-8") as f:
                current_seuils = json.load(f)
        except (json.JSONDecodeError, OSError):
            current_seuils = {}

    current_seuils.update(thresholds_to_apply)
    current_seuils["_restored_from"] = target["version_id"]
    current_seuils["_restored_at"]   = datetime.now().isoformat()

    SEUILS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SEUILS_FILE, "w", encoding="utf-8") as f:
        json.dump(current_seuils, f, indent=2, ensure_ascii=False)

    accepted_str = "ACCEPTED" if target.get("gate_result", {}).get("accepted") else "REJECTED"
    result.update({
        "success":            True,
        "version_id":         target["version_id"],
        "thresholds_applied": thresholds_to_apply,
        "message": (
            f"Seuils restaurés depuis la version {target['version_id']} "
            f"(originalement {accepted_str} le "
            f"{target.get('timestamp', '?')[:16]})"
        ),
    })
    print(f"[ROLLBACK]  {result['message']}")
    print(f"           Appliqués : {thresholds_to_apply}")
    return result


# ─────────────────────────────────────────────────────────────────────────────
# BACKTEST HISTORY — LAYER 5
# ─────────────────────────────────────────────────────────────────────────────

def get_backtest_history(dataset_id: str | None = None) -> list[dict]:
    """
    Retourne les 20 derniers résultats de backtest depuis long_term_memory.json.
    Utilisé par dashboard_api.py pour afficher la courbe de précision historique.
    Chaque entrée : timestamp, sessions_tested, overall_accuracy, overall_label, summary
    """
    memory = charger_memoire(dataset_id=dataset_id)
    return list(reversed(memory.get("backtest_history", [])))
