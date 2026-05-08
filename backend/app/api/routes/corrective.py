# ─────────────────────────────────────────────────────────────────────────────
# corrective_api.py — Endpoints FastAPI pour l'agent correcteur semi-automatique
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import json
import subprocess
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

corrective_router = APIRouter(prefix="/api/corrective", tags=["corrective-agent"])

_pending_suggestions: dict[str, dict] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Modèles Pydantic
# ─────────────────────────────────────────────────────────────────────────────

class SuggestionPayload(BaseModel):
    anomaly_type:  str
    ip:            str
    severity:      str
    action_type:   str
    command:       Optional[str] = None
    description:   str
    confidence:    float
    mode:          str
    timestamp:     Optional[str] = None


class ValidationDecision(BaseModel):
    suggestion_id:    str
    decision:         str          # "APPROVE" | "REJECT" | "MODIFY"
    modified_command: Optional[str] = None
    admin_note:       Optional[str] = None


class ModeChange(BaseModel):
    new_mode:      str             # "TRAINING" | "SUGGESTION" | "AUTO"
    new_threshold: Optional[float] = None


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/corrective/mode
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.get("/mode")
def get_mode() -> dict:
    try:
        from agents import AGENT_MODE, CONFIDENCE_THRESHOLD_AUTO
    except ImportError:
        AGENT_MODE = "SUGGESTION"
        CONFIDENCE_THRESHOLD_AUTO = 0.85

    return {
        "mode":                 AGENT_MODE,
        "confidence_threshold": CONFIDENCE_THRESHOLD_AUTO,
        "phase_description":    _phase_description(AGENT_MODE),
        "pending_count":        len(_pending_suggestions),
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/corrective/mode
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.post("/mode")
def change_mode(payload: ModeChange) -> dict:
    import os
    valid_modes = ("TRAINING", "SUGGESTION", "AUTO")
    if payload.new_mode not in valid_modes:
        raise HTTPException(400, f"Mode invalide. Valeurs acceptées : {valid_modes}")

    try:
        import agents
        agents.AGENT_MODE = payload.new_mode
        if payload.new_threshold is not None:
            agents.CONFIDENCE_THRESHOLD_AUTO = payload.new_threshold
    except ImportError:
        pass

    os.environ["CORRECTIVE_AGENT_MODE"] = payload.new_mode
    if payload.new_threshold is not None:
        os.environ["CONFIDENCE_THRESHOLD"] = str(payload.new_threshold)

    return {
        "status":    "updated",
        "new_mode":  payload.new_mode,
        "threshold": payload.new_threshold or 0.85,
        "message":   f"Agent correcteur passé en mode {payload.new_mode}.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/corrective/suggestion
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.post("/suggestion")
def store_suggestion(payload: SuggestionPayload) -> dict:
    import uuid
    sid = f"sug-{uuid.uuid4().hex[:8]}"
    _pending_suggestions[sid] = {
        **payload.dict(),
        "suggestion_id": sid,
        "timestamp":     payload.timestamp or datetime.now().isoformat(),
        "status":        "PENDING",
    }
    try:
        from api_auth import _run_broadcast
        _run_broadcast({
            "type":       "suggestion",
            "suggestion": {**payload.dict(), "suggestion_id": sid, "status": "PENDING"},
        })
    except Exception as e:
        print(f"[WS][WARN] broadcast suggestion: {e}")
    return {"suggestion_id": sid, "status": "PENDING"}


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/corrective/suggestions
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.get("/suggestions")
def list_suggestions(status: Optional[str] = None) -> dict:
    items = list(_pending_suggestions.values())
    if status:
        items = [s for s in items if s.get("status") == status.upper()]
    return {
        "count":       len(items),
        "suggestions": sorted(items, key=lambda x: x.get("timestamp", ""), reverse=True),
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/corrective/validate — validation humaine principale
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.post("/validate")
def validate_suggestion(decision: ValidationDecision) -> dict:
    sid        = decision.suggestion_id
    suggestion = _pending_suggestions.get(sid)

    if not suggestion:
        raise HTTPException(404, f"Suggestion '{sid}' introuvable ou déjà traitée.")

    timestamp  = datetime.now().isoformat()
    action_log = {
        "suggestion_id": sid,
        "decision":      decision.decision,
        "admin_note":    decision.admin_note,
        "timestamp":     timestamp,
        "original":      suggestion,
    }

    # ── APPROVE ───────────────────────────────────────────────────────────────
    if decision.decision == "APPROVE":
        command = suggestion.get("command") or ""
        result  = _safe_execute(command, simulation=not _is_linux())
        action_log.update({"executed": True, "command": command,
                           "result": result, "status": "APPROVED_EXECUTED"})
        _pending_suggestions[sid]["status"] = "APPROVED"

        _broadcast_corrective_result(suggestion, result, "EXECUTED")
        # ✅ Apprentissage bonne décision + compteur stats
        learn_from_feedback("APPROVE", suggestion)

        return {
            "status":  "EXECUTED",
            "command": command,
            "result":  result,
            "message": f"✅ Action '{suggestion.get('action_type')}' exécutée avec succès.",
            "log":     action_log,
        }

    # ── REJECT ────────────────────────────────────────────────────────────────
    elif decision.decision == "REJECT":
        action_log.update({"executed": False, "status": "REJECTED"})
        _pending_suggestions[sid]["status"] = "REJECTED"

        _log_training_feedback(suggestion, decision="REJECT", note=decision.admin_note)
        _broadcast_corrective_result(suggestion, "Rejeté par l'administrateur.", "REJECTED")
        # ✅ Apprentissage faux positif + compteur stats
        learn_from_feedback("REJECT", suggestion)

        return {
            "status":  "REJECTED",
            "message": f"❌ Suggestion '{sid}' rejetée. Décision enregistrée pour améliorer l'agent.",
            "log":     action_log,
        }

    # ── MODIFY ────────────────────────────────────────────────────────────────
    elif decision.decision == "MODIFY":
        if not decision.modified_command:
            raise HTTPException(400, "modified_command requis pour MODIFY.")
        if not _is_safe_command(decision.modified_command):
            raise HTTPException(400, "Commande refusée — caractères dangereux détectés.")

        result = _safe_execute(decision.modified_command, simulation=not _is_linux())
        action_log.update({
            "executed":         True,
            "original_command": suggestion.get("command", ""),
            "modified_command": decision.modified_command,
            "result":           result,
            "status":           "MODIFIED_EXECUTED",
        })
        _pending_suggestions[sid]["status"] = "MODIFIED"

        _log_training_feedback(suggestion, decision="MODIFY", modified_cmd=decision.modified_command)
        _broadcast_corrective_result(suggestion, result, "MODIFIED_EXECUTED")
        # ✅ Apprentissage correction admin (MODIFY, pas APPROVE) + commande améliorée + compteur stats
        learn_from_feedback("MODIFY", suggestion, modified_command=decision.modified_command)

        return {
            "status":           "MODIFIED_EXECUTED",
            "modified_command": decision.modified_command,
            "result":           result,
            "message":          "🔧 Commande modifiée exécutée. Apprentissage mis à jour.",
            "log":              action_log,
        }

    else:
        raise HTTPException(400, f"Décision '{decision.decision}' invalide. Valeurs : APPROVE, REJECT, MODIFY.")


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/corrective/knowledge
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.get("/knowledge")
def get_knowledge() -> dict:
    try:
        from agents import KNOWLEDGE_BASE
        return {"count": len(KNOWLEDGE_BASE), "knowledge": KNOWLEDGE_BASE}
    except ImportError:
        return {"count": 0, "knowledge": {}, "error": "agents.py non importé"}


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/corrective/stats — session + mémoire long terme
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.get("/stats")
def get_stats() -> dict:
    all_s = list(_pending_suggestions.values())

    memory_stats = {}
    try:
        from app.ai.agents.memory import (
       charger_memoire, sauvegarder_memoire,
       enregistrer_stat_action, update_knowledge_base,  # ← AJOUTER
   )
        memoire      = charger_memoire()
        action_stats = memoire.get("action_stats", {})
        memory_stats = {
            "corrections_apprises": len(memoire.get("modified_actions", [])),
            "bonnes_actions":        len(memoire.get("good_actions", [])),
            "faux_positifs":         len(memoire.get("bad_actions", [])),
            "success_rates":         {a: get_success_rate(a) for a in action_stats},
        }
    except Exception as e:
        memory_stats = {"error": str(e)}

    return {
        "session": {
            "total":    len(all_s),
            "pending":  sum(1 for s in all_s if s.get("status") == "PENDING"),
            "approved": sum(1 for s in all_s if "APPROVED" in s.get("status", "")),
            "rejected": sum(1 for s in all_s if s.get("status") == "REJECTED"),
            "modified": sum(1 for s in all_s if "MODIFIED" in s.get("status", "")),
            "avg_confidence": (
                round(sum(s.get("confidence", 0) for s in all_s) / len(all_s), 2)
                if all_s else 0
            ),
        },
        "memory": memory_stats,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Helpers internes
# ─────────────────────────────────────────────────────────────────────────────

def _is_linux() -> bool:
    import platform
    return platform.system() == "Linux"


def _is_safe_command(cmd: str) -> bool:
    dangerous = ["rm -rf", "mkfs", "dd if=", "> /dev/sd", ":(){ :|:& };:"]
    return not any(d in cmd for d in dangerous)


def _safe_execute(command: str, simulation: bool = True) -> str:
    if not command:
        return "Aucune commande à exécuter."
    if simulation:
        return f"[SIMULATION] Commande enregistrée : {command}"
    try:
        proc = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=15)
        return (proc.stdout.strip() or proc.stderr.strip() or "Commande exécutée.")[:500]
    except subprocess.TimeoutExpired:
        return "Timeout — commande trop longue."
    except Exception as e:
        return f"Erreur d'exécution : {e}"


def _log_training_feedback(suggestion: dict, decision: str, note: str = None,
                            modified_cmd: str = None) -> None:
    feedback = {
        "timestamp":       datetime.now().isoformat(),
        "anomaly_type":    suggestion.get("anomaly_type"),
        "original_action": suggestion.get("action_type"),
        "decision":        decision,
        "admin_note":      note,
        "modified_cmd":    modified_cmd,
    }
    try:
        with open("training_feedback.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(feedback, ensure_ascii=False) + "\n")
    except Exception:
        pass


from app.ai.agents.memory import charger_memoire, sauvegarder_memoire, enregistrer_stat_action



from app.ai.agents.memory import (
    charger_memoire,
    sauvegarder_memoire,
    enregistrer_stat_action,
    update_knowledge_base,   # ← AJOUT
)


def learn_from_feedback(decision: str, suggestion: dict, modified_command: str = None):
    """
    Apprentissage dynamique depuis décisions admin.
    Alimente memory.py → utilisé par get_best_command() dans agents.py
    et par get_success_rate() pour la condition AUTO mode.

    NOUVEAU : appelle aussi update_knowledge_base() pour alimenter
    dynamic_kb → utilisé par _compute_confidence() pour ajuster la confiance.
    """
    try:
        memoire = charger_memoire()
        anomaly = suggestion.get("anomaly_type", "UNKNOWN")
        ip      = suggestion.get("ip", "N/A")
        action  = suggestion.get("action_type", "UNKNOWN")

        if decision == "REJECT":
            memoire.setdefault("bad_actions", []).append({
                "anomaly_type": anomaly,
                "ip":           ip,
                "action":       action,
                "reason":       "false_positive",
                "date":         datetime.now().isoformat(),
            })
            print(f"[LEARNING] ⚠️  Faux positif → {anomaly} | {ip}")
            enregistrer_stat_action(anomaly, "rejected")

            # ← NOUVEAU : mettre à jour la KB dynamique
            update_knowledge_base(
                type_attack=anomaly,
                action=action,
                success=False,   # REJECT = faux positif = pas un succès
            )

        elif decision == "APPROVE":
            memoire.setdefault("good_actions", []).append({
                "anomaly_type": anomaly,
                "ip":           ip,
                "action":       action,
                "date":         datetime.now().isoformat(),
            })
            print(f"[LEARNING] ✅ Action validée → {action}")
            enregistrer_stat_action(anomaly, "approved")

            # ← NOUVEAU : mettre à jour la KB dynamique
            update_knowledge_base(
                type_attack=anomaly,
                action=action,
                success=True,    # APPROVE = action correcte
            )

            # ← NOUVEAU : ajouter l'IP dans les IPs suspectes confirmées
            if ip and ip not in ("N/A", "multiple", ""):
                ips = memoire.setdefault("ips_suspectes", [])
                if ip not in ips:
                    ips.append(ip)
                    print(f"[LEARNING] 🔴 IP {ip} ajoutée aux IP suspectes confirmées")

        elif decision == "MODIFY":
            if not modified_command:
                return
            memoire.setdefault("modified_actions", []).append({
                "anomaly_type":     anomaly,
                "ip":               ip,
                "original_action":  action,
                "improved_command": modified_command,
                "date":             datetime.now().isoformat(),
            })
            print(f"[LEARNING] 🧠 Action modifiée → apprentissage enrichi (cmd: {modified_command})")
            enregistrer_stat_action(anomaly, "modified")

            # ← NOUVEAU : MODIFY compte comme succès partiel dans la KB
            # (l'admin a pris la peine de corriger → c'était une vraie attaque)
            update_knowledge_base(
                type_attack=anomaly,
                action=modified_command,   # on enregistre la commande CORRIGÉE
                success=True,
            )

        sauvegarder_memoire(memoire)

    except Exception as e:
        print(f"[WARN] learn_from_feedback: {e}")
        
def _broadcast_corrective_result(suggestion: dict, result: str, status: str) -> None:
    try:
        from api_auth import broadcast_alarm
        broadcast_alarm({
            "type":          f"CORRECTIVE_{status}",
            "source_ip":     suggestion.get("ip", "N/A"),
            "severity":      "MED",
            "action":        suggestion.get("action_type", ""),
            "message":       f"[{status}] {suggestion.get('description', '')} → {str(result)[:80]}",
            "human_insight": f"Décision admin : {status}. Confiance initiale : {suggestion.get('confidence', 0):.0%}",
        })
    except Exception as e:
        print(f"[WS][WARN] Broadcast résultat correcteur : {e}")


def _phase_description(mode: str) -> str:
    return {
        "TRAINING":   "Phase 1 — Apprentissage supervisé : l'agent observe et enregistre, aucune action.",
        "SUGGESTION": "Phase 2 — Human-in-the-Loop : l'agent propose, l'admin valide.",
        "AUTO":       "Phase 3 — Automatisation conditionnelle : confiance ≥ seuil ET success_rate ≥ 80 %.",
    }.get(mode, "Mode inconnu.")