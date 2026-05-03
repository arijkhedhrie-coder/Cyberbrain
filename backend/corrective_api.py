# ─────────────────────────────────────────────────────────────────────────────
# corrective_api.py — Endpoints FastAPI pour l'agent correcteur semi-automatique
#
# À inclure dans api_auth.py :
#   from corrective_api import corrective_router
#   app.include_router(corrective_router)
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import json
import subprocess
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

corrective_router = APIRouter(prefix="/api/corrective", tags=["corrective-agent"])

# ── In-memory store des suggestions en attente ────────────────────────────────
# En production, remplacer par Redis ou une table DB.
_pending_suggestions: dict[str, dict] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Modèles Pydantic
# ─────────────────────────────────────────────────────────────────────────────

class SuggestionPayload(BaseModel):
    """Reçu du WebSocket ou de l'agent, stocké en attente de validation."""
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
    """Décision de l'administrateur : approuver, rejeter ou modifier."""
    suggestion_id: str
    decision:      str          # "APPROVE" | "REJECT" | "MODIFY"
    modified_command: Optional[str] = None
    admin_note:    Optional[str] = None


class ModeChange(BaseModel):
    """Changement de mode de l'agent correcteur."""
    new_mode:   str             # "TRAINING" | "SUGGESTION" | "AUTO"
    new_threshold: Optional[float] = None


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/corrective/mode — état actuel de l'agent
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.get("/mode")
def get_mode() -> dict:
    """Retourne le mode actuel de l'agent correcteur."""
    try:
        from agents import AGENT_MODE, CONFIDENCE_THRESHOLD_AUTO
    except ImportError:
        AGENT_MODE = "SUGGESTION"
        CONFIDENCE_THRESHOLD_AUTO = 0.85

    return {
        "mode":               AGENT_MODE,
        "confidence_threshold": CONFIDENCE_THRESHOLD_AUTO,
        "phase_description":  _phase_description(AGENT_MODE),
        "pending_count":      len(_pending_suggestions),
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/corrective/mode — changer le mode
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.post("/mode")
def change_mode(payload: ModeChange) -> dict:
    """
    Change le mode de l'agent correcteur à chaud.
    Nécessite de modifier la variable d'environnement CORRECTIVE_AGENT_MODE
    ou de patcher le module agents en mémoire.
    """
    import os
    valid_modes = ("TRAINING", "SUGGESTION", "AUTO")
    if payload.new_mode not in valid_modes:
        raise HTTPException(400, f"Mode invalide. Valeurs acceptées : {valid_modes}")

    # Patch en mémoire (redémarrage persistant via .env)
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
        "status":   "updated",
        "new_mode": payload.new_mode,
        "threshold": payload.new_threshold or 0.85,
        "message":  f"Agent correcteur passé en mode {payload.new_mode}.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/corrective/suggestion — stocker une suggestion (appelé par l'agent)
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.post("/suggestion")
def store_suggestion(payload: SuggestionPayload) -> dict:
    """
    L'agent correcteur (ou le WebSocket broadcast) appelle cet endpoint
    pour enregistrer une suggestion en attente de validation humaine.
    """
    import uuid
    sid = f"sug-{uuid.uuid4().hex[:8]}"
    _pending_suggestions[sid] = {
        **payload.dict(),
        "suggestion_id": sid,
        "timestamp":     payload.timestamp or datetime.now().isoformat(),
        "status":        "PENDING",
    }
    return {"suggestion_id": sid, "status": "PENDING"}


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/corrective/suggestions — lister les suggestions en attente
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.get("/suggestions")
def list_suggestions(status: Optional[str] = None) -> dict:
    """
    Retourne les suggestions en attente de validation.
    Paramètre optionnel : status = PENDING | APPROVED | REJECTED
    """
    items = list(_pending_suggestions.values())
    if status:
        items = [s for s in items if s.get("status") == status.upper()]
    return {
        "count":       len(items),
        "suggestions": sorted(items, key=lambda x: x.get("timestamp", ""), reverse=True),
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/corrective/validate — valider ou rejeter une suggestion
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.post("/validate")
def validate_suggestion(decision: ValidationDecision) -> dict:
    """
    Endpoint principal de validation humaine.

    - APPROVE  → exécute la commande suggérée (mode simulation si Linux non disponible)
    - REJECT   → rejette et log la décision pour amélioration future
    - MODIFY   → exécute une commande modifiée par l'admin
    """
    sid = decision.suggestion_id
    suggestion = _pending_suggestions.get(sid)

    if not suggestion:
        raise HTTPException(404, f"Suggestion '{sid}' introuvable ou déjà traitée.")

    timestamp  = datetime.now().isoformat()
    action_log = {
        "suggestion_id":  sid,
        "decision":       decision.decision,
        "admin_note":     decision.admin_note,
        "timestamp":      timestamp,
        "original":       suggestion,
    }

    # ── APPROVE ───────────────────────────────────────────────────────────────
    if decision.decision == "APPROVE":
        command = suggestion.get("command") or ""
        result  = _safe_execute(command, simulation=not _is_linux())
        action_log["executed"]  = True
        action_log["command"]   = command
        action_log["result"]    = result
        action_log["status"]    = "APPROVED_EXECUTED"
        _pending_suggestions[sid]["status"] = "APPROVED"

        # Broadcast confirmation au dashboard
        _broadcast_corrective_result(suggestion, result, "EXECUTED")

        return {
            "status":  "EXECUTED",
            "command": command,
            "result":  result,
            "message": f"✅ Action '{suggestion.get('action_type')}' exécutée avec succès.",
            "log":     action_log,
        }

    # ── REJECT ────────────────────────────────────────────────────────────────
    elif decision.decision == "REJECT":
        action_log["executed"] = False
        action_log["status"]   = "REJECTED"
        _pending_suggestions[sid]["status"] = "REJECTED"

        # Log pour apprentissage (Phase 1 enrichissement)
        _log_training_feedback(suggestion, decision="REJECT", note=decision.admin_note)
        _broadcast_corrective_result(suggestion, "Rejeté par l'administrateur.", "REJECTED")

        return {
            "status":  "REJECTED",
            "message": f"❌ Suggestion '{sid}' rejetée. Décision enregistrée pour améliorer l'agent.",
            "log":     action_log,
        }

    # ── MODIFY ────────────────────────────────────────────────────────────────
    elif decision.decision == "MODIFY":
        if not decision.modified_command:
            raise HTTPException(400, "modified_command requis pour MODIFY.")

        # Validation basique de sécurité
        if not _is_safe_command(decision.modified_command):
            raise HTTPException(400, "Commande refusée — caractères dangereux détectés.")

        result = _safe_execute(decision.modified_command, simulation=not _is_linux())
        action_log["executed"]         = True
        action_log["original_command"] = suggestion.get("command", "")
        action_log["modified_command"] = decision.modified_command
        action_log["result"]           = result
        action_log["status"]           = "MODIFIED_EXECUTED"
        _pending_suggestions[sid]["status"] = "MODIFIED"

        # Enrichissement base de connaissance
        _log_training_feedback(suggestion, decision="MODIFY", modified_cmd=decision.modified_command)
        _broadcast_corrective_result(suggestion, result, "MODIFIED_EXECUTED")

        return {
            "status":           "MODIFIED_EXECUTED",
            "modified_command": decision.modified_command,
            "result":           result,
            "message":          f"✅ Commande modifiée exécutée. Apprentissage mis à jour.",
            "log":              action_log,
        }

    else:
        raise HTTPException(400, f"Décision '{decision.decision}' invalide. Valeurs : APPROVE, REJECT, MODIFY.")


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/corrective/knowledge — consulter la base de connaissance
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.get("/knowledge")
def get_knowledge() -> dict:
    """Retourne la base de connaissance de l'agent correcteur."""
    try:
        from agents import KNOWLEDGE_BASE
        return {"count": len(KNOWLEDGE_BASE), "knowledge": KNOWLEDGE_BASE}
    except ImportError:
        return {"count": 0, "knowledge": {}, "error": "agents.py non importé"}


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/corrective/stats — statistiques des décisions
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.get("/stats")
def get_stats() -> dict:
    """Statistiques globales des suggestions et validations."""
    all_s = list(_pending_suggestions.values())
    return {
        "total":    len(all_s),
        "pending":  sum(1 for s in all_s if s.get("status") == "PENDING"),
        "approved": sum(1 for s in all_s if "APPROVED" in s.get("status", "")),
        "rejected": sum(1 for s in all_s if s.get("status") == "REJECTED"),
        "modified": sum(1 for s in all_s if "MODIFIED" in s.get("status", "")),
        "avg_confidence": (
            round(sum(s.get("confidence", 0) for s in all_s) / len(all_s), 2)
            if all_s else 0
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Helpers internes
# ─────────────────────────────────────────────────────────────────────────────

def _is_linux() -> bool:
    import platform
    return platform.system() == "Linux"


def _is_safe_command(cmd: str) -> bool:
    """Validation basique — bloque les commandes destructrices."""
    dangerous = ["rm -rf", "mkfs", "dd if=", "> /dev/sd", ":(){ :|:& };:"]
    return not any(d in cmd for d in dangerous)


def _safe_execute(command: str, simulation: bool = True) -> str:
    """
    Exécute une commande système.
    En mode simulation (non-Linux ou env de dev), retourne un résultat fictif.
    """
    if not command:
        return "Aucune commande à exécuter."

    if simulation:
        return f"[SIMULATION] Commande enregistrée : {command}"

    try:
        proc = subprocess.run(
            command, shell=True, capture_output=True, text=True, timeout=15
        )
        output = proc.stdout.strip() or proc.stderr.strip() or "Commande exécutée."
        return output[:500]
    except subprocess.TimeoutExpired:
        return "Timeout — commande trop longue."
    except Exception as e:
        return f"Erreur d'exécution : {e}"


def _log_training_feedback(suggestion: dict, decision: str, note: str = None,
                            modified_cmd: str = None) -> None:
    """Enregistre le retour admin pour enrichir la Phase 1."""
    feedback = {
        "timestamp":      datetime.now().isoformat(),
        "anomaly_type":   suggestion.get("anomaly_type"),
        "original_action": suggestion.get("action_type"),
        "decision":       decision,
        "admin_note":     note,
        "modified_cmd":   modified_cmd,
    }
    # Écriture locale pour audit (S3 si disponible)
    try:
        with open("training_feedback.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(feedback, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _broadcast_corrective_result(suggestion: dict, result: str, status: str) -> None:
    """Notifie le dashboard via WebSocket du résultat de validation."""
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
        "AUTO":       "Phase 3 — Automatisation conditionnelle : exécution si confiance ≥ seuil.",
    }.get(mode, "Mode inconnu.")