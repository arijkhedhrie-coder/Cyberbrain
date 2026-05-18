from __future__ import annotations

import asyncio
import json
import time
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes.auth import router as auth_router
from app.api.routes.dashboard_routes import router as dashboard_router
from app.api.routes.corrective import corrective_router
from app.api.routes.chat import router as chat_router

from collections import deque

# ── Central broadcaster initialisation (will be called later) ────────────────
from app.core.websocket_broadcast import init_broadcaster

ALARMS_STORE: deque = deque(maxlen=500)
ACTIVITIES_STORE: deque = deque(maxlen=500)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="IDPS Dashboard API", version="2.0")

app.include_router(auth_router)
app.include_router(chat_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard_router)
app.include_router(corrective_router)

# ── WebSocket state ───────────────────────────────────────────────────────────
connected_clients: list[WebSocket] = []
_client_filters: dict[WebSocket, dict] = {}
_event_loop: asyncio.AbstractEventLoop | None = None


# ── Broadcast function (must be defined before the startup event) ────────────
async def _broadcast_raw(payload: dict) -> None:
    if not connected_clients:
        return
    is_alarm = payload.get("type") == "alarm"
    alarm_data = payload.get("alarm", {}) if is_alarm else {}
    message = json.dumps(payload, ensure_ascii=False, default=str)
    dead: list[WebSocket] = []
    for client in list(connected_clients):
        try:
            if is_alarm:
                cf = _client_filters.get(client, {"servers": [], "version": 0})
                servers = cf["servers"]
                if servers:
                    eng = str(alarm_data.get("engine") or "").lower()
                    srv = str(alarm_data.get("server_id") or alarm_data.get("server") or "").lower()
                    if not any(s in eng or s in srv for s in servers):
                        continue
                if cf["version"] > 0:
                    await client.send_text(
                        json.dumps({**payload, "version": cf["version"]}, ensure_ascii=False, default=str)
                    )
                    continue
            await client.send_text(message)
        except Exception:
            dead.append(client)
    for c in dead:
        if c in connected_clients:
            connected_clients.remove(c)
        _client_filters.pop(c, None)


def _run_broadcast(payload: dict) -> None:
    if _event_loop and not _event_loop.is_closed():
        asyncio.run_coroutine_threadsafe(_broadcast_raw(payload), _event_loop)


# ── Startup event (runs after the app is fully built) ────────────────────────
@app.on_event("startup")
async def _startup() -> None:
    global _event_loop
    _event_loop = asyncio.get_running_loop()

    # Initialise the central broadcaster with our event loop and raw broadcast function
    init_broadcaster(_event_loop, _broadcast_raw)
    print("[WS] Broadcaster initialised – pending messages will be flushed")

    routes = [r.path for r in app.routes if hasattr(r, "path")]
    print(f"[API] {len(routes)} routes enregistrées : {routes}")


# ── /health ───────────────────────────────────────────────────────────────────
@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "ws_clients": len(connected_clients),
        "ws_endpoint": "ws://localhost:8000/ws/logs",
    }


# ── WebSocket /ws/logs ────────────────────────────────────────────────────────
@app.websocket("/ws/logs")
async def ws_logs(websocket: WebSocket) -> None:
    await websocket.accept()
    connected_clients.append(websocket)
    _client_filters[websocket] = {"servers": [], "version": 0}
    print(f"[WS] connecté — actifs : {len(connected_clients)}")

    # Send history of alarms to new client
    if ALARMS_STORE:
        try:
            recent = list(ALARMS_STORE)[-20:]
            await websocket.send_json({
                "type": "history",
                "alarms": recent,
                "count": len(recent),
            })
        except Exception:
            pass

    if ACTIVITIES_STORE:
        try:
            recent_activities = list(ACTIVITIES_STORE)[-40:]
            await websocket.send_json({
                "type": "activity_history",
                "activities": recent_activities,
                "count": len(recent_activities),
            })
        except Exception:
            pass

    try:
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                try:
                    parsed = json.loads(msg)
                    t = parsed.get("type", "")
                    if t == "ping":
                        await websocket.send_json({"type": "pong"})
                    elif t == "filter":
                        servers = parsed.get("servers", [])
                        version = parsed.get("version", 0)
                        _client_filters[websocket] = {
                            "servers": [s.lower() for s in servers],
                            "version": version,
                        }
                        await websocket.send_json({
                            "type": "filter_ack",
                            "servers": servers,
                            "version": version,
                        })
                except Exception:
                    pass
            except asyncio.TimeoutError:
                try:
                    await websocket.send_json({"type": "heartbeat"})
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in connected_clients:
            connected_clients.remove(websocket)
        _client_filters.pop(websocket, None)
        print(f"[WS] déconnecté — restants : {len(connected_clients)}")


# ── Metrics endpoint ──────────────────────────────────────────────────────────
@app.get("/api/pipeline/metrics")
def get_metrics() -> dict:
    alarms = list(ALARMS_STORE)
    current_alarms = len(alarms)

    critical = sum(1 for a in alarms if a.get("severity") == "CRITICAL")
    high = sum(1 for a in alarms if a.get("severity") == "HIGH")
    medium = sum(1 for a in alarms if a.get("severity") == "MED")
    low = sum(1 for a in alarms if a.get("severity") == "LOW")

    if current_alarms == 0:
        risk = 0
    else:
        risk = int(
            (
                critical * 1.0 +
                high * 0.7 +
                medium * 0.4 +
                low * 0.1
            ) / current_alarms * 100
        )

    return {
        "current_alarms": current_alarms,
        "risk": risk,
        "breakdown": {
            "critical": critical,
            "high": high,
            "medium": medium,
            "low": low,
        }
    }


# ── Helper maps & normalisation (unchanged) ───────────────────────────────────
_SEV_MAP = {
    "CRITIQUE": "CRITICAL", "AVERTISSEMENT": "HIGH",
    "AVERTISSEMENT_MOYEN": "MED",
    "CRITICAL": "CRITICAL", "HIGH": "HIGH", "MED": "MED", "LOW": "LOW",
}
_ACTION_MAP = {
    "BLOCK_24H": "BLOCK_NOW", "BLOCK_NOW": "BLOCK_NOW",
    "PREEMPTIVE_BLOCK": "BLOCK_NOW", "WATCHLIST_30MIN": "WATCHLIST",
    "WATCHLIST": "WATCHLIST", "TRAFFIC_THROTTLE": "WATCHLIST",
    "ESCALATE": "ESCALATE", "MONITOR": "MONITOR",
}
_VALID_ENGINES = {"SSH", "WEB", "FTP", "SESSION", "KERNEL", "PREDICTION", "CORRELATION", "CHAIN"}
_HUMAN = {
    "SSH": "Repeated login failures — brute-force pattern.",
    "WEB": "HTTP path scanning — automated vulnerability scanner.",
    "FTP": "Abnormal file transfer — possible data exfiltration.",
    "SESSION": "Session token reuse — session compromise suspected.",
    "KERNEL": "Kernel error spike — system instability.",
    "PREDICTION": "Pre-attack signals — distributed attack incoming.",
}


def _normalize_alarm(raw: dict, stage: str = "pass1", server_id: str = "") -> dict:
    from datetime import datetime as _dt
    ts = str(raw.get("timestamp") or _dt.now().isoformat())
    try:
        ts = _dt.fromisoformat(ts).strftime("%H:%M:%S")
    except Exception:
        ts = ts[:8]
    t = str(raw.get("type") or "UNKNOWN")
    for em in ("🔴 ", "🟠 ", "🟡 ", "⚠️ ", "✅ "):
        t = t.replace(em, "")
    eng = str(raw.get("engine") or raw.get("domain") or t or "SSH").split("_")[0].upper()
    if eng not in _VALID_ENGINES:
        eng = "SSH"
    sev = _SEV_MAP.get(str(raw.get("severity") or raw.get("severite") or "HIGH").upper(), "MED")
    try:
        score = round(float(raw.get("score") or raw.get("score_final") or 0), 1)
    except Exception:
        score = 0.0
    srv = server_id or str(raw.get("server_id") or raw.get("Serveur") or "server1")
    return {
        "id": str(raw.get("id") or f"ws-{uuid.uuid4().hex[:8]}-{int(time.time())}"),
        "timestamp": ts,
        "type": t.strip(),
        "source_ip": str(raw.get("source_ip") or raw.get("ip") or raw.get("IP_Source") or "N/A"),
        "severity": sev,
        "engine": eng,
        "score": score,
        "message": str(raw.get("message") or "")[:120],
        "human_insight": str(raw.get("human_insight") or _HUMAN.get(eng, "Anomalous activity detected.")),
        "action": _ACTION_MAP.get(str(raw.get("action") or "MONITOR").upper(), "MONITOR"),
        "country": str(raw.get("country") or "Unknown"),
        "failures": int(raw.get("failures") or 0),
        "server_id": srv,
    }


def broadcast_alarm(raw_alarm: dict, stage: str = "pass1", server_id: str = "") -> None:
    try:
        normalized = _normalize_alarm(raw_alarm, stage, server_id=server_id)
        ALARMS_STORE.append(normalized)
        print(f"[ALARMS_STORE] +1 | total={len(ALARMS_STORE)} | {normalized.get('engine')} {normalized.get('severity')}")
        _run_broadcast({"type": "alarm", "alarm": normalized})
    except Exception as e:
        print(f"[WS][WARN] broadcast_alarm: {e}")


@app.get("/api/alarms/live")
def get_live_alarms(limit: int = 100) -> dict:
    alarms = list(ALARMS_STORE)[-limit:]
    return {
        "count": len(alarms),
        "alarms": list(reversed(alarms)),
    }


def broadcast_log(data: dict) -> None:
    try:
        _run_broadcast({"type": "log", "line": str(data.get("message") or data.get("line") or str(data))})
    except Exception as e:
        print(f"[WS][WARN] broadcast_log: {e}")


def broadcast_metrics(metrics: dict) -> None:
    try:
        _run_broadcast({"type": "metrics", "data": metrics})
    except Exception as e:
        print(f"[WS][WARN] broadcast_metrics: {e}")


def _normalize_activity(activity: dict) -> dict:
    normalized = dict(activity or {})
    normalized.setdefault("id", f"act-{uuid.uuid4().hex[:10]}")
    normalized.setdefault("timestamp", time.strftime("%H:%M:%S"))
    normalized.setdefault("stage", "session")
    normalized.setdefault("actor", "System")
    normalized.setdefault("title", normalized.get("event_type") or "Activity")
    normalized.setdefault("detail", "")
    normalized.setdefault("status", "info")
    normalized.setdefault("severity", "INFO")
    return normalized


def broadcast_activity(activity: dict) -> None:
    try:
        normalized = _normalize_activity(activity)
        ACTIVITIES_STORE.append(normalized)
        _run_broadcast({"type": "activity", "activity": normalized})
    except Exception as e:
        print(f"[WS][WARN] broadcast_activity: {e}")


# ── Internal HTTP endpoints for fallback (optional) ───────────────────────────
from pydantic import BaseModel as _BaseModel

class _AlarmBroadcastPayload(_BaseModel):
    alarm: dict
    stage: str = "pass1"
    server_id: str = "server1"


@app.post("/api/internal/broadcast-alarm")
async def internal_broadcast_alarm(payload: _AlarmBroadcastPayload) -> dict:
    broadcast_alarm(payload.alarm, stage=payload.stage, server_id=payload.server_id)
    return {"ok": True, "store_size": len(ALARMS_STORE)}


@app.post("/api/internal/broadcast-log")
async def internal_broadcast_log(data: dict) -> dict:
    broadcast_log(data)
    return {"ok": True}


@app.post("/api/internal/broadcast-metrics")
async def internal_broadcast_metrics(data: dict) -> dict:
    broadcast_metrics(data)
    return {"ok": True}


@app.post("/api/internal/broadcast-activity")
async def internal_broadcast_activity(data: dict) -> dict:
    broadcast_activity(data)
    return {"ok": True, "store_size": len(ACTIVITIES_STORE)}


@app.post("/api/invalidate-cache")
async def invalidate_cache() -> dict:
    try:
        from dashboard_api import _cache
        _cache.clear()
    except Exception:
        pass
    return {"ok": True}
