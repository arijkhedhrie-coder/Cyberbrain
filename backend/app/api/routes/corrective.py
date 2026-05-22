# ─────────────────────────────────────────────────────────────────────────────
# corrective_api.py — Endpoints FastAPI pour l'agent correcteur semi-automatique
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import json
import os
import platform
import re
import subprocess
import tempfile
import threading
from datetime import datetime
from ipaddress import ip_network
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.fusion_view import FUSION_DATASET, is_fusion_dataset
from app.ai.agents.memory import (
    charger_memoire,
    enregistrer_stat_action,
    get_success_rate,
    reset_active_dataset,
    sauvegarder_memoire,
    set_active_dataset,
    update_knowledge_base,
)

corrective_router = APIRouter(prefix="/api/corrective", tags=["corrective-agent"])

_pending_suggestions: dict[str, dict] = {}
_pending_suggestions_lock = threading.Lock()
_BLACKLIST_PATH = "/etc/blacklist.txt"


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _suggestions_store_file() -> Path:
    configured = os.getenv("CORRECTIVE_SUGGESTIONS_FILE")
    if configured:
        return Path(configured)
    return _project_root() / "data" / "corrective_suggestions.json"


def _replace_pending_suggestions(data: dict[str, dict]) -> None:
    _pending_suggestions.clear()
    _pending_suggestions.update(data)


def _load_pending_suggestions() -> None:
    target = _suggestions_store_file()
    if not target.exists():
        _replace_pending_suggestions({})
        return

    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except Exception:
        _replace_pending_suggestions({})
        return

    if isinstance(payload, dict):
        loaded = {
            str(key): value
            for key, value in payload.items()
            if isinstance(value, dict)
        }
    elif isinstance(payload, list):
        loaded = {}
        for item in payload:
            if not isinstance(item, dict):
                continue
            sid = str(item.get("suggestion_id") or "").strip()
            if sid:
                loaded[sid] = item
    else:
        loaded = {}

    _replace_pending_suggestions(loaded)


def _persist_pending_suggestions() -> None:
    target = _suggestions_store_file()
    target.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, delete=False) as handle:
        json.dump(_pending_suggestions, handle, ensure_ascii=False, indent=2)
        tmp_path = Path(handle.name)

    os.replace(tmp_path, target)


def _upsert_pending_suggestion(record: dict[str, Any]) -> None:
    sid = str(record.get("suggestion_id") or "").strip()
    if not sid:
        raise ValueError("suggestion_id manquant")

    with _pending_suggestions_lock:
        _pending_suggestions[sid] = record
        _persist_pending_suggestions()


def _update_pending_suggestion(suggestion_id: str, **changes: Any) -> dict[str, Any]:
    with _pending_suggestions_lock:
        suggestion = _pending_suggestions.get(suggestion_id)
        if not suggestion:
            raise KeyError(suggestion_id)
        suggestion.update(changes)
        _persist_pending_suggestions()
        return dict(suggestion)


def _list_pending_suggestions() -> list[dict[str, Any]]:
    with _pending_suggestions_lock:
        return [dict(item) for item in _pending_suggestions.values()]


def _pending_count() -> int:
    with _pending_suggestions_lock:
        return sum(1 for item in _pending_suggestions.values() if item.get("status") == "PENDING")


def _get_pending_suggestion(suggestion_id: str) -> dict[str, Any] | None:
    with _pending_suggestions_lock:
        suggestion = _pending_suggestions.get(suggestion_id)
        return dict(suggestion) if suggestion else None


def _normalize_command(command: str | None) -> str:
    return re.sub(r"\s+", " ", str(command or "").strip())


def _validate_network(value: str) -> str:
    try:
        network = ip_network(value, strict=False)
    except ValueError as exc:
        raise HTTPException(400, f"Commande refusée — IP/réseau invalide: {value}") from exc

    return str(network.network_address) if network.prefixlen == network.max_prefixlen else str(network)


def _validate_username(value: str) -> str:
    username = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]{0,31}", username):
        raise HTTPException(400, "Commande refusée — utilisateur invalide.")
    return username


def _build_execution_plan(action_type: str, command: str | None) -> dict[str, Any]:
    normalized = _normalize_command(command)

    if action_type in {"INSPECTION_MANUELLE", "RECOMMANDATION_PREVENTIVE"}:
        return {"action_type": action_type, "kind": "noop", "command": normalized}

    if action_type == "BLOCAGE_IP_AWS_SECGROUP":
        match = re.fullmatch(r"iptables -(A|I) INPUT(?: (\d+))? -s (\S+) -j DROP", normalized)
        if not match:
            raise HTTPException(400, "Commande refusée — format iptables non autorisé.")
        flag, position, network = match.groups()
        argv = ["iptables", f"-{flag}", "INPUT"]
        if position:
            argv.append(position)
        argv.extend(["-s", _validate_network(network), "-j", "DROP"])
        return {"action_type": action_type, "kind": "argv", "steps": [argv], "command": normalized}

    if action_type == "BAN_FAIL2BAN":
        match = re.fullmatch(r"fail2ban-client set ([A-Za-z0-9_-]+) banip (\S+)", normalized)
        if not match:
            raise HTTPException(400, "Commande refusée — format Fail2Ban non autorisé.")
        jail, network = match.groups()
        argv = ["fail2ban-client", "set", jail, "banip", _validate_network(network)]
        return {"action_type": action_type, "kind": "argv", "steps": [argv], "command": normalized}

    if action_type == "BLACKLIST_IP":
        match = re.fullmatch(
            r"iptables -A INPUT -s (\S+) -j DROP && echo ['\"]?([^'\"]+)['\"]? >> (\S+)",
            normalized,
        )
        if not match:
            raise HTTPException(400, "Commande refusée — format blacklist non autorisé.")
        blocked_ip, echoed_ip, path = match.groups()
        network = _validate_network(blocked_ip)
        echoed_network = _validate_network(echoed_ip)
        if network != echoed_network or path != _BLACKLIST_PATH:
            raise HTTPException(400, "Commande refusée — la blacklist doit conserver le même IP et chemin.")
        return {
            "action_type": action_type,
            "kind": "composite",
            "command": normalized,
            "steps": [
                {"kind": "argv", "argv": ["iptables", "-A", "INPUT", "-s", network, "-j", "DROP"]},
                {"kind": "append_file", "path": _BLACKLIST_PATH, "value": f"{network}\n"},
            ],
        }

    if action_type == "ALERTE_SYSTEME":
        if normalized != "systemctl status --failed && journalctl -p err -n 50":
            raise HTTPException(400, "Commande refusée — format diagnostic système non autorisé.")
        return {
            "action_type": action_type,
            "kind": "composite",
            "command": normalized,
            "steps": [
                {"kind": "argv", "argv": ["systemctl", "status", "--failed"]},
                {"kind": "argv", "argv": ["journalctl", "-p", "err", "-n", "50"]},
            ],
        }

    if action_type == "LIBERER_MEMOIRE":
        match = re.fullmatch(r"sync && echo ([123]) > /proc/sys/vm/drop_caches", normalized)
        if not match:
            raise HTTPException(400, "Commande refusée — format libération mémoire non autorisé.")
        drop_value = match.group(1)
        return {
            "action_type": action_type,
            "kind": "composite",
            "command": normalized,
            "steps": [
                {"kind": "argv", "argv": ["sync"]},
                {"kind": "write_file", "path": "/proc/sys/vm/drop_caches", "value": drop_value},
            ],
        }

    if action_type == "DESACTIVER_COMPTE":
        match = re.fullmatch(r"usermod -L (\S+)", normalized)
        if not match:
            raise HTTPException(400, "Commande refusée — format verrouillage utilisateur non autorisé.")
        username = _validate_username(match.group(1))
        return {
            "action_type": action_type,
            "kind": "argv",
            "steps": [["usermod", "-L", username]],
            "command": normalized,
        }

    raise HTTPException(400, f"Action '{action_type}' non autorisée pour exécution structurée.")


def _run_structured_subprocess(argv: list[str]) -> str:
    proc = subprocess.run(
        argv,
        shell=False,
        capture_output=True,
        text=True,
        timeout=15,
    )
    return (proc.stdout.strip() or proc.stderr.strip() or "Commande exécutée.")[:500]


def _execute_structured_plan(plan: dict[str, Any], *, simulation: bool) -> str:
    command = str(plan.get("command") or "").strip()
    if plan.get("kind") == "noop":
        return "Aucune commande à exécuter."
    if simulation:
        return f"[SIMULATION] Commande enregistrée : {command}"

    outputs: list[str] = []
    steps = plan.get("steps") or []
    for step in steps:
        if isinstance(step, list):
            outputs.append(_run_structured_subprocess(step))
            continue

        step_kind = step.get("kind")
        if step_kind == "argv":
            outputs.append(_run_structured_subprocess(step["argv"]))
        elif step_kind == "append_file":
            path = Path(step["path"])
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(step["value"])
            outputs.append(f"{path} updated")
        elif step_kind == "write_file":
            Path(step["path"]).write_text(str(step["value"]), encoding="utf-8")
            outputs.append(f"{step['path']} updated")
        else:
            raise HTTPException(400, f"Étape d'exécution inconnue: {step_kind}")

    return " | ".join(filter(None, outputs))[:500] or "Commande exécutée."


def _execute_action_command(action_type: str, command: str | None, *, simulation: bool = True) -> str:
    plan = _build_execution_plan(action_type, command)
    return _execute_structured_plan(plan, simulation=simulation)


def _load_corrective_agents_module():
    from app.ai.agents import agents as corrective_agents

    return corrective_agents


def _assert_local_dataset_scope(dataset_id: Optional[str], operation: str) -> None:
    if is_fusion_dataset(dataset_id) or str(dataset_id or "").strip() == FUSION_DATASET:
        raise HTTPException(
            400,
            f"{operation} is disabled in fusion mode. Switch to a concrete dataset to perform corrective actions.",
        )


_load_pending_suggestions()


# ─────────────────────────────────────────────────────────────────────────────
# Modèles Pydantic
# ─────────────────────────────────────────────────────────────────────────────

class SuggestionPayload(BaseModel):
    anomaly_type:  str
    ip:            str
    severity:      str
    action_type:   str
    dataset_id:    Optional[str] = None
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


class DemoTriggerPayload(BaseModel):
    dataset_id: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/corrective/mode
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.get("/mode")
def get_mode() -> dict:
    try:
        corrective_agents = _load_corrective_agents_module()
        agent_mode = corrective_agents.AGENT_MODE
        confidence_threshold_auto = corrective_agents.CONFIDENCE_THRESHOLD_AUTO
    except ImportError:
        agent_mode = "SUGGESTION"
        confidence_threshold_auto = 0.85

    return {
        "mode":                 agent_mode,
        "confidence_threshold": confidence_threshold_auto,
        "phase_description":    _phase_description(agent_mode),
        "pending_count":        _pending_count(),
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
        corrective_agents = _load_corrective_agents_module()
        corrective_agents.AGENT_MODE = payload.new_mode
        if payload.new_threshold is not None:
            corrective_agents.CONFIDENCE_THRESHOLD_AUTO = payload.new_threshold
    except ImportError:
        pass

    os.environ["CORRECTIVE_AGENT_MODE"] = payload.new_mode
    if payload.new_threshold is not None:
        os.environ["CONFIDENCE_THRESHOLD"] = str(payload.new_threshold)

    _broadcast_activity({
        "id": f"corrective-mode-{datetime.now().timestamp()}",
        "timestamp": datetime.now().isoformat(),
        "stage": "corrective",
        "actor": "Admin",
        "title": "Corrective mode updated",
        "detail": f"Mode switched to {payload.new_mode}.",
        "status": "completed",
        "severity": "INFO",
        "progress": 96,
        "meta": {
            "mode": payload.new_mode,
            "threshold": payload.new_threshold,
        },
    })

    return {
        "status":    "updated",
        "new_mode":  payload.new_mode,
        "threshold": payload.new_threshold or 0.85,
        "message":   f"Agent correcteur passé en mode {payload.new_mode}.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/corrective/demo-trigger
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.post("/demo-trigger")
def trigger_demo_event(payload: DemoTriggerPayload) -> dict:
    dataset_id = str(payload.dataset_id or "").strip()
    if not dataset_id:
        raise HTTPException(400, "dataset_id est requis pour lancer une démo corrective.")

    _assert_local_dataset_scope(dataset_id, "Demo trigger")

    demo_alarm = {
        "timestamp": datetime.now().isoformat(),
        "dataset_id": dataset_id,
        "server_id": dataset_id,
        "source": "demo-trigger",
        "ip": "203.0.113.77",
        "type": "BRUTE-FORCE SSH",
        "feature": "ssh_failures",
        "engine": "SSH",
        "severity": "CRITICAL",
        "severite": "CRITIQUE",
        "message": "Demo anomaly: repeated SSH failures detected from a single source.",
        "count": 18,
    }
    corrective_mode = str(os.getenv("CORRECTIVE_AGENT_MODE", "SUGGESTION") or "SUGGESTION").upper()

    _broadcast_activity({
        "id": f"corrective-demo-{datetime.now().timestamp()}",
        "timestamp": datetime.now().isoformat(),
        "stage": "corrective",
        "actor": "Demo Trigger",
        "title": "Synthetic anomaly injected",
        "detail": f"Demo event submitted for dataset {dataset_id}.",
        "status": "running",
        "severity": "INFO",
        "progress": 42,
        "meta": {
            "dataset_id": dataset_id,
            "ip": demo_alarm["ip"],
            "mode": corrective_mode,
            "type": demo_alarm["type"],
        },
    })

    try:
        from app.core.websocket_broadcast import broadcast_alarm

        broadcast_alarm(
            demo_alarm,
            stage="final",
            server_id=dataset_id,
            dataset_id=dataset_id,
            persist=True,
        )
    except Exception as exc:
        raise HTTPException(500, f"Impossible d'injecter l'alarme de démo: {exc}") from exc

    dataset_token = set_active_dataset(dataset_id)
    try:
        from app.main import _run_safe_corrective_action

        corrective_agents = _load_corrective_agents_module()
        corrective_result = _run_safe_corrective_action(
            nb_anomalies=1,
            ip_principale=demo_alarm["ip"],
            alarmes_final=[demo_alarm],
            outil_correctif=corrective_agents.outil_correctif,
            dataset_id=dataset_id,
        )
    except Exception as exc:
        raise HTTPException(500, f"Impossible d'exécuter la démo corrective: {exc}") from exc
    finally:
        reset_active_dataset(dataset_token)

    _broadcast_activity({
        "id": f"corrective-demo-complete-{datetime.now().timestamp()}",
        "timestamp": datetime.now().isoformat(),
        "stage": "corrective",
        "actor": "Demo Trigger",
        "title": "Synthetic anomaly processed",
        "detail": f"Demo corrective pipeline finished for dataset {dataset_id}.",
        "status": "completed",
        "severity": "INFO",
        "progress": 100,
        "meta": {
            "dataset_id": dataset_id,
            "mode": corrective_mode,
            "result": corrective_result,
        },
    })

    return {
        "status": "triggered",
        "dataset_id": dataset_id,
        "mode": corrective_mode,
        "alarm": demo_alarm,
        "corrective_result": corrective_result,
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/corrective/suggestion
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.post("/suggestion")
def store_suggestion(payload: SuggestionPayload) -> dict:
    import uuid
    _assert_local_dataset_scope(payload.dataset_id, "Suggestion storage")
    sid = f"sug-{uuid.uuid4().hex[:8]}"
    record = {
        **payload.dict(),
        "suggestion_id": sid,
        "timestamp":     payload.timestamp or datetime.now().isoformat(),
        "status":        "PENDING",
    }
    _upsert_pending_suggestion(record)
    try:
        from app.core.websocket_broadcast import broadcast_payload
        broadcast_payload({
            "type":       "suggestion",
            "dataset_id": payload.dataset_id,
            "suggestion": {**payload.dict(), "suggestion_id": sid, "status": "PENDING"},
        })
    except Exception as e:
        print(f"[WS][WARN] broadcast suggestion: {e}")

    _broadcast_activity({
        "id": f"corrective-suggestion-{sid}",
        "timestamp": record["timestamp"],
        "stage": "corrective",
        "actor": "Corrective Agent",
        "title": "Corrective suggestion queued",
        "detail": str(payload.description),
        "status": "pending",
        "severity": str(payload.severity or "HIGH").upper(),
        "progress": 92,
        "meta": {
            "suggestion_id": sid,
            "dataset_id": payload.dataset_id,
            "anomaly_type": payload.anomaly_type,
            "ip": payload.ip,
            "action_type": payload.action_type,
            "confidence": payload.confidence,
            "mode": payload.mode,
            "command": payload.command,
        },
    })
    return {"suggestion_id": sid, "status": "PENDING"}


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/corrective/suggestions
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.get("/suggestions")
def list_suggestions(status: Optional[str] = None, dataset: Optional[str] = None) -> dict:
    if is_fusion_dataset(dataset) or str(dataset or "").strip() == FUSION_DATASET:
        return {"count": 0, "suggestions": []}
    items = _list_pending_suggestions()
    if status:
        items = [s for s in items if s.get("status") == status.upper()]
    if dataset:
        items = [s for s in items if str(s.get("dataset_id") or "") == dataset]
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
    suggestion = _get_pending_suggestion(sid)

    if not suggestion:
        raise HTTPException(404, f"Suggestion '{sid}' introuvable ou déjà traitée.")
    _assert_local_dataset_scope(suggestion.get("dataset_id"), "Suggestion validation")

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
        result  = _execute_action_command(
            str(suggestion.get("action_type") or ""),
            command,
            simulation=not _is_linux(),
        )
        action_log.update({"executed": True, "command": command,
                           "result": result, "status": "APPROVED_EXECUTED"})
        suggestion = _update_pending_suggestion(sid, status="APPROVED")

        _broadcast_corrective_result(suggestion, result, "EXECUTED")
        _broadcast_suggestion_state({
            **suggestion,
            "status": "APPROVED",
            "admin_note": decision.admin_note,
        })
        _broadcast_activity({
            "id": f"corrective-validation-{sid}",
            "timestamp": timestamp,
            "stage": "corrective",
            "actor": "Admin + Corrective Agent",
            "title": "Suggestion approved and executed",
            "detail": f"{suggestion.get('description', '')} -> {str(result)[:140]}",
            "status": "executed",
            "severity": str(suggestion.get("severity") or "HIGH").upper(),
            "progress": 98,
            "meta": {
                "suggestion_id": sid,
                "decision": decision.decision,
                "ip": suggestion.get("ip"),
                "action_type": suggestion.get("action_type"),
                "command": command,
                "confidence": suggestion.get("confidence"),
            },
        })
        # ✅ Apprentissage bonne décision + compteur stats
        learn_from_feedback("APPROVE", suggestion)
        _broadcast_learning_update(suggestion, "APPROVE")

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
        suggestion = _update_pending_suggestion(sid, status="REJECTED")

        _log_training_feedback(suggestion, decision="REJECT", note=decision.admin_note)
        _broadcast_corrective_result(suggestion, "Rejeté par l'administrateur.", "REJECTED")
        _broadcast_suggestion_state({
            **suggestion,
            "status": "REJECTED",
            "admin_note": decision.admin_note,
        })
        _broadcast_activity({
            "id": f"corrective-validation-{sid}",
            "timestamp": timestamp,
            "stage": "corrective",
            "actor": "Admin",
            "title": "Suggestion rejected",
            "detail": decision.admin_note or str(suggestion.get("description", "")),
            "status": "warning",
            "severity": "HIGH",
            "progress": 96,
            "meta": {
                "suggestion_id": sid,
                "decision": decision.decision,
                "ip": suggestion.get("ip"),
                "action_type": suggestion.get("action_type"),
                "confidence": suggestion.get("confidence"),
            },
        })
        # ✅ Apprentissage faux positif + compteur stats
        learn_from_feedback("REJECT", suggestion)
        _broadcast_learning_update(suggestion, "REJECT")

        return {
            "status":  "REJECTED",
            "message": f"❌ Suggestion '{sid}' rejetée. Décision enregistrée pour améliorer l'agent.",
            "log":     action_log,
        }

    # ── MODIFY ────────────────────────────────────────────────────────────────
    elif decision.decision == "MODIFY":
        if not decision.modified_command:
            raise HTTPException(400, "modified_command requis pour MODIFY.")
        result = _execute_action_command(
            str(suggestion.get("action_type") or ""),
            decision.modified_command,
            simulation=not _is_linux(),
        )
        action_log.update({
            "executed":         True,
            "original_command": suggestion.get("command", ""),
            "modified_command": decision.modified_command,
            "result":           result,
            "status":           "MODIFIED_EXECUTED",
        })
        suggestion = _update_pending_suggestion(sid, status="MODIFIED")

        _log_training_feedback(suggestion, decision="MODIFY", modified_cmd=decision.modified_command)
        _broadcast_corrective_result(suggestion, result, "MODIFIED_EXECUTED")
        _broadcast_suggestion_state({
            **suggestion,
            "status": "MODIFIED",
            "command": decision.modified_command,
            "admin_note": decision.admin_note,
        })
        _broadcast_activity({
            "id": f"corrective-validation-{sid}",
            "timestamp": timestamp,
            "stage": "corrective",
            "actor": "Admin + Corrective Agent",
            "title": "Suggestion modified and executed",
            "detail": f"{suggestion.get('description', '')} -> {str(result)[:140]}",
            "status": "executed",
            "severity": str(suggestion.get("severity") or "HIGH").upper(),
            "progress": 98,
            "meta": {
                "suggestion_id": sid,
                "decision": decision.decision,
                "ip": suggestion.get("ip"),
                "action_type": suggestion.get("action_type"),
                "original_command": suggestion.get("command", ""),
                "modified_command": decision.modified_command,
                "confidence": suggestion.get("confidence"),
            },
        })
        # ✅ Apprentissage correction admin (MODIFY, pas APPROVE) + commande améliorée + compteur stats
        learn_from_feedback("MODIFY", suggestion, modified_command=decision.modified_command)
        _broadcast_learning_update(suggestion, "MODIFY", modified_command=decision.modified_command)

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
        corrective_agents = _load_corrective_agents_module()
        return {"count": len(corrective_agents.KNOWLEDGE_BASE), "knowledge": corrective_agents.KNOWLEDGE_BASE}
    except ImportError:
        return {"count": 0, "knowledge": {}, "error": "agents.py non importé"}


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/corrective/stats — session + mémoire long terme
# ─────────────────────────────────────────────────────────────────────────────

@corrective_router.get("/stats")
def get_stats(dataset: Optional[str] = None) -> dict:
    if is_fusion_dataset(dataset) or str(dataset or "").strip() == FUSION_DATASET:
        return {
            "session": {
                "total": 0,
                "pending": 0,
                "approved": 0,
                "rejected": 0,
                "modified": 0,
                "avg_confidence": 0,
            },
            "memory": {
                "analysis_only": True,
                "dataset_id": FUSION_DATASET,
                "reason": "Fusion mode does not keep corrective memory or execution stats.",
            },
        }
    all_s = _list_pending_suggestions()
    if dataset:
        all_s = [s for s in all_s if str(s.get("dataset_id") or "") == dataset]

    memory_stats = {}
    try:
        memoire      = charger_memoire(dataset_id=dataset)
        action_stats = memoire.get("action_stats", {})
        memory_stats = {
            "corrections_apprises": len(memoire.get("modified_actions", [])),
            "bonnes_actions":        len(memoire.get("good_actions", [])),
            "faux_positifs":         len(memoire.get("bad_actions", [])),
            "success_rates":         {a: get_success_rate(a, dataset_id=dataset) for a in action_stats},
            "dataset_id":            dataset,
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
    return platform.system() == "Linux"


def _broadcast_activity(payload: dict) -> None:
    try:
        from app.core.websocket_broadcast import broadcast_activity
        broadcast_activity(payload)
    except Exception as e:
        print(f"[WS][WARN] Broadcast activity corrective: {e}")


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

def learn_from_feedback(decision: str, suggestion: dict, modified_command: str = None):
    """
    Apprentissage dynamique depuis décisions admin.
    Alimente memory.py → utilisé par get_best_command() dans agents.py
    et par get_success_rate() pour la condition AUTO mode.

    NOUVEAU : appelle aussi update_knowledge_base() pour alimenter
    dynamic_kb → utilisé par _compute_confidence() pour ajuster la confiance.
    """
    try:
        dataset_id = suggestion.get("dataset_id")
        _assert_local_dataset_scope(dataset_id, "Corrective learning")
        memoire = charger_memoire(dataset_id=dataset_id)
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
            enregistrer_stat_action(anomaly, "rejected", dataset_id=dataset_id)

            # ← NOUVEAU : mettre à jour la KB dynamique
            update_knowledge_base(
                type_attack=anomaly,
                action=action,
                success=False,   # REJECT = faux positif = pas un succès
                dataset_id=dataset_id,
            )

        elif decision == "APPROVE":
            memoire.setdefault("good_actions", []).append({
                "anomaly_type": anomaly,
                "ip":           ip,
                "action":       action,
                "date":         datetime.now().isoformat(),
            })
            print(f"[LEARNING] ✅ Action validée → {action}")
            enregistrer_stat_action(anomaly, "approved", dataset_id=dataset_id)

            # ← NOUVEAU : mettre à jour la KB dynamique
            update_knowledge_base(
                type_attack=anomaly,
                action=action,
                success=True,    # APPROVE = action correcte
                dataset_id=dataset_id,
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
            enregistrer_stat_action(anomaly, "modified", dataset_id=dataset_id)

            # ← NOUVEAU : MODIFY compte comme succès partiel dans la KB
            # (l'admin a pris la peine de corriger → c'était une vraie attaque)
            update_knowledge_base(
                type_attack=anomaly,
                action=modified_command,   # on enregistre la commande CORRIGÉE
                success=True,
                dataset_id=dataset_id,
            )

        sauvegarder_memoire(memoire, dataset_id=dataset_id)

    except Exception as e:
        print(f"[WARN] learn_from_feedback: {e}")
        
def _broadcast_corrective_result(suggestion: dict, result: str, status: str) -> None:
    try:
        from app.core.websocket_broadcast import broadcast_alarm
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


def _broadcast_suggestion_state(suggestion: dict[str, Any]) -> None:
    try:
        from app.core.websocket_broadcast import broadcast_payload

        broadcast_payload({
            "type": "suggestion",
            "dataset_id": suggestion.get("dataset_id"),
            "suggestion": suggestion,
        })
    except Exception as e:
        print(f"[WS][WARN] Broadcast suggestion state: {e}")


def _broadcast_learning_update(
    suggestion: dict[str, Any],
    decision: str,
    *,
    modified_command: str | None = None,
) -> None:
    learning_detail = {
        "APPROVE": "Decision approved. Success stats and confidence memory updated.",
        "REJECT": "Decision rejected. False-positive memory updated to reduce similar suggestions.",
        "MODIFY": "Modified command learned and stored for future corrective proposals.",
    }.get(decision, "Corrective learning updated.")

    meta: dict[str, Any] = {
        "suggestion_id": suggestion.get("suggestion_id"),
        "dataset_id": suggestion.get("dataset_id"),
        "decision": decision,
        "anomaly_type": suggestion.get("anomaly_type"),
        "action_type": suggestion.get("action_type"),
        "confidence": suggestion.get("confidence"),
    }
    if modified_command:
        meta["modified_command"] = modified_command

    _broadcast_activity({
        "id": f"corrective-learning-{suggestion.get('suggestion_id')}-{datetime.now().timestamp()}",
        "timestamp": datetime.now().isoformat(),
        "dataset_id": suggestion.get("dataset_id"),
        "stage": "corrective",
        "actor": "Corrective Memory",
        "title": "Corrective learning updated",
        "detail": learning_detail,
        "status": "completed",
        "severity": "INFO",
        "progress": 100,
        "meta": meta,
    })


def _phase_description(mode: str) -> str:
    return {
        "TRAINING":   "Phase 1 — Apprentissage supervisé : l'agent observe et enregistre, aucune action.",
        "SUGGESTION": "Phase 2 — Human-in-the-Loop : l'agent propose, l'admin valide.",
        "AUTO":       "Phase 3 — Automatisation conditionnelle : confiance ≥ seuil ET success_rate ≥ 80 %.",
    }.get(mode, "Mode inconnu.")
