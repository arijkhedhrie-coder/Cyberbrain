from __future__ import annotations

import asyncio
import contextlib
import json
import time
import uuid
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes.auth import router as auth_router
from app.api.routes.dashboard_routes import router as dashboard_router
from app.api.routes.events import router as events_router
from app.api.routes.corrective import corrective_router
from app.api.routes.chat import router as chat_router
from app.core.event_store import replay_timeline, tail_category_payloads
from app.core.fusion_view import is_fusion_dataset
from app.services.background_tasks import bootstrap_task_dispatcher

from collections import deque

# â”€â”€ Central broadcaster initialisation (will be called later) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
from app.core.websocket_broadcast import (
    broadcast_activity as ws_broadcast_activity,
    broadcast_alarm as ws_broadcast_alarm,
    broadcast_log as ws_broadcast_log,
    broadcast_metrics as ws_broadcast_metrics,
    broadcaster_status,
    init_broadcaster,
    shutdown_broadcaster,
)

ALARMS_STORE: deque = deque(maxlen=500)
ACTIVITIES_STORE: deque = deque(maxlen=500)
_RECENT_EVENT_IDS: deque[str] = deque()
_RECENT_EVENT_ID_SET: set[str] = set()
HEARTBEAT_INTERVAL_SECONDS = 15.0

# â”€â”€ App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app = FastAPI(title="IDPS Dashboard API", version="2.0")

app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(events_router)
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

# â”€â”€ WebSocket state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
connected_clients: list[WebSocket] = []
_client_filters: dict[WebSocket, dict] = {}
_event_loop: asyncio.AbstractEventLoop | None = None


def _mark_event_seen(event_id: str) -> bool:
    if not event_id:
        return False
    if event_id in _RECENT_EVENT_ID_SET:
        return True
    if len(_RECENT_EVENT_IDS) >= 1000:
        oldest = _RECENT_EVENT_IDS.popleft()
        _RECENT_EVENT_ID_SET.discard(oldest)
    _RECENT_EVENT_IDS.append(event_id)
    _RECENT_EVENT_ID_SET.add(event_id)
    return False


def _remember_payload(payload: dict[str, Any]) -> None:
    event_id = str(
        payload.get("event_id")
        or payload.get("alarm", {}).get("event_id")
        or payload.get("activity", {}).get("event_id")
        or payload.get("data", {}).get("event_id")
        or ""
    )
    if _mark_event_seen(event_id):
        return

    msg_type = str(payload.get("type") or "")
    if msg_type == "alarm" and isinstance(payload.get("alarm"), dict):
        ALARMS_STORE.append(payload["alarm"])
    elif msg_type == "activity" and isinstance(payload.get("activity"), dict):
        ACTIVITIES_STORE.append(payload["activity"])


def _filter_alarm_records(alarms: list[dict[str, Any]], dataset: str, servers: list[str]) -> list[dict[str, Any]]:
    filtered = list(alarms)
    if dataset and not is_fusion_dataset(dataset):
        dataset_lower = dataset.lower()
        filtered = [
            alarm for alarm in filtered
            if str(alarm.get("dataset_id") or "").lower() == dataset_lower
        ]
    if servers:
        server_set = {str(item).lower() for item in servers}
        filtered = [
            alarm for alarm in filtered
            if str(alarm.get("server_id") or "").lower() in server_set
        ]
    return filtered


def _filter_activity_records(activities: list[dict[str, Any]], dataset: str) -> list[dict[str, Any]]:
    if dataset and not is_fusion_dataset(dataset):
        dataset_lower = dataset.lower()
        return [
            activity for activity in activities
            if str(activity.get("dataset_id") or "").lower() == dataset_lower
        ]
    return activities


def _recent_alert_history(*, dataset: str = "", servers: list[str] | None = None, limit: int = 20) -> list[dict[str, Any]]:
    dataset_filter = None if is_fusion_dataset(dataset) else (dataset or None)
    records = tail_category_payloads("alerts", dataset_id=dataset_filter, limit=max(limit * 5, 50))
    filtered = _filter_alarm_records(records, dataset, servers or [])
    return list(reversed(filtered[-limit:]))


def _recent_activity_history(*, dataset: str = "", limit: int = 40) -> list[dict[str, Any]]:
    dataset_filter = None if is_fusion_dataset(dataset) else (dataset or None)
    corrective = tail_category_payloads("corrective", dataset_id=dataset_filter, limit=max(limit * 3, 60))
    fusion = tail_category_payloads("fusion", dataset_id=dataset_filter, limit=max(limit * 3, 60))
    combined = corrective + fusion
    combined.sort(key=lambda item: str(item.get("timestamp") or item.get("date") or ""))
    filtered = _filter_activity_records(combined, dataset)
    return list(reversed(filtered[-limit:]))


def _hydrate_live_stores() -> None:
    ALARMS_STORE.clear()
    ACTIVITIES_STORE.clear()
    for alarm in tail_category_payloads("alerts", limit=500):
        if isinstance(alarm, dict):
            ALARMS_STORE.append(alarm)
    combined = tail_category_payloads("corrective", limit=250) + tail_category_payloads("fusion", limit=250)
    combined.sort(key=lambda item: str(item.get("timestamp") or item.get("date") or ""))
    for activity in combined[-500:]:
        if isinstance(activity, dict):
            ACTIVITIES_STORE.append(activity)


async def _send_history_snapshot(websocket: WebSocket, *, dataset: str = "", servers: list[str] | None = None) -> None:
    alarms = _recent_alert_history(dataset=dataset, servers=servers or [], limit=20)
    activities = _recent_activity_history(dataset=dataset, limit=40)
    await websocket.send_json({
        "type": "history",
        "alarms": alarms,
        "count": len(alarms),
        "last_event_id": alarms[0].get("event_id") if alarms else None,
    })
    await websocket.send_json({
        "type": "activity_history",
        "activities": activities,
        "count": len(activities),
        "last_event_id": activities[0].get("event_id") if activities else None,
    })


async def _send_replay(
    websocket: WebSocket,
    *,
    dataset: str = "",
    servers: list[str] | None = None,
    after_event_id: str = "",
) -> None:
    if not after_event_id:
        await _send_history_snapshot(websocket, dataset=dataset, servers=servers or [])
        return

    events = replay_timeline(
        categories=["alerts", "trust", "corrective", "fusion"],
        dataset_id=dataset or None,
        after_event_id=after_event_id,
        limit=200,
    )
    if servers:
        server_set = {str(item).lower() for item in servers}
        filtered: list[dict[str, Any]] = []
        for event in events:
            if str(event.get("category") or "") != "alerts":
                filtered.append(event)
                continue
            payload = event.get("payload") or {}
            if str(payload.get("server_id") or "").lower() in server_set:
                filtered.append(event)
        events = filtered

    await websocket.send_json({
        "type": "timeline_replay",
        "events": events,
        "count": len(events),
        "after_event_id": after_event_id,
    })


async def _heartbeat_loop(websocket: WebSocket) -> None:
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
            await websocket.send_json({
                "type": "heartbeat",
                "timestamp": time.strftime("%H:%M:%S"),
            })
    except asyncio.CancelledError:
        return
    except Exception:
        return


# â”€â”€ Broadcast function (must be defined before the startup event) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async def _broadcast_raw(payload: dict) -> None:
    _remember_payload(payload)
    if not connected_clients:
        return
    is_alarm = payload.get("type") == "alarm"
    alarm_data = payload.get("alarm", {}) if is_alarm else {}
    payload_dataset = str(
        payload.get("dataset_id")
        or alarm_data.get("dataset_id")
        or payload.get("activity", {}).get("dataset_id", "")
        or payload.get("data", {}).get("dataset_id", "")
    ).lower()
    message = json.dumps(payload, ensure_ascii=False, default=str)
    dead: list[WebSocket] = []
    for client in list(connected_clients):
        try:
            cf = _client_filters.get(client, {"servers": [], "dataset": "", "version": 0})
            client_dataset = str(cf.get("dataset") or "").lower()
            if client_dataset and not is_fusion_dataset(client_dataset) and payload_dataset and client_dataset != payload_dataset:
                continue
            if is_alarm:
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


# â”€â”€ Startup event (runs after the app is fully built) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.on_event("startup")
async def _startup() -> None:
    global _event_loop
    _event_loop = asyncio.get_running_loop()
    _hydrate_live_stores()

    # Initialise the central broadcaster with our event loop and raw broadcast function
    init_broadcaster(_event_loop, _broadcast_raw)
    print("[WS] Broadcaster initialised â€“ pending messages will be flushed")

    dispatcher = bootstrap_task_dispatcher(app)
    print(
        "[TASKS] Dispatcher initialised "
        f"(enabled={dispatcher.settings.enabled}, broker={dispatcher.settings.safe_broker_url})"
    )

    routes = [r.path for r in app.routes if hasattr(r, "path")]
    print(f"[API] {len(routes)} routes enregistrÃ©es : {routes}")


# â”€â”€ /health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.on_event("shutdown")
async def _shutdown() -> None:
    await shutdown_broadcaster()


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "ws_clients": len(connected_clients),
        "ws_endpoint": "ws://localhost:8000/ws/logs",
        "broadcaster": broadcaster_status(),
    }


# â”€â”€ WebSocket /ws/logs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.websocket("/ws/logs")
async def ws_logs(websocket: WebSocket) -> None:
    await websocket.accept()
    connected_clients.append(websocket)
    _client_filters[websocket] = {"servers": [], "dataset": "", "version": 0}
    print(f"[WS] connectÃ© â€” actifs : {len(connected_clients)}")
    heartbeat_task = asyncio.create_task(_heartbeat_loop(websocket))

    try:
        await websocket.send_json({
            "type": "connected",
            "heartbeat_interval_seconds": HEARTBEAT_INTERVAL_SECONDS,
            "replay_supported": True,
        })
        await _send_history_snapshot(websocket)
    except Exception:
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task
        if websocket in connected_clients:
            connected_clients.remove(websocket)
        _client_filters.pop(websocket, None)
        return

    try:
        while True:
            msg = await websocket.receive_text()
            try:
                parsed = json.loads(msg)
                t = parsed.get("type", "")
                if t == "ping":
                    await websocket.send_json({"type": "pong"})
                elif t == "pong":
                    continue
                elif t == "filter":
                    servers = parsed.get("servers", [])
                    dataset = str(parsed.get("dataset") or "")
                    version = parsed.get("version", 0)
                    last_event_id = str(parsed.get("last_event_id") or "")
                    _client_filters[websocket] = {
                        "servers": [s.lower() for s in servers],
                        "dataset": dataset.lower(),
                        "version": version,
                    }
                    await websocket.send_json({
                        "type": "filter_ack",
                        "servers": servers,
                        "dataset": dataset,
                        "version": version,
                    })
                    if last_event_id:
                        await _send_replay(
                            websocket,
                            dataset=dataset,
                            servers=servers,
                            after_event_id=last_event_id,
                        )
                    else:
                        await _send_history_snapshot(websocket, dataset=dataset, servers=servers)
                elif t == "resume":
                    await _send_replay(
                        websocket,
                        dataset=str(parsed.get("dataset") or ""),
                        servers=parsed.get("servers", []),
                        after_event_id=str(parsed.get("last_event_id") or ""),
                    )
            except asyncio.CancelledError:
                break
            except Exception:
                pass
    except asyncio.CancelledError:
        pass
    except WebSocketDisconnect:
        pass
    finally:
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task
        if websocket in connected_clients:
            connected_clients.remove(websocket)
        _client_filters.pop(websocket, None)
        print(f"[WS] dÃ©connectÃ© â€” restants : {len(connected_clients)}")


# â”€â”€ Metrics endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@app.get("/api/pipeline/metrics")
def get_metrics() -> dict:
    alarms = _recent_alert_history(limit=500)
    if not alarms:
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

@app.get("/api/alarms/live")
def get_live_alarms(limit: int = 100, dataset: str | None = None) -> dict:
    alarms = _recent_alert_history(dataset=str(dataset or ""), limit=limit)
    if not alarms:
        alarms = list(ALARMS_STORE)
        alarms = _filter_alarm_records(alarms, str(dataset or ""), [])
        alarms = list(reversed(alarms[-limit:]))
    return {
        "count": len(alarms),
        "alarms": alarms,
    }


# â”€â”€ Internal HTTP endpoints for fallback (optional) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
from pydantic import BaseModel as _BaseModel

class _AlarmBroadcastPayload(_BaseModel):
    alarm: dict
    stage: str = "pass1"
    server_id: str = "server1"
    dataset_id: str = ""
    event_id: str = ""


@app.post("/api/internal/broadcast-alarm")
async def internal_broadcast_alarm(payload: _AlarmBroadcastPayload) -> dict:
    ws_broadcast_alarm(
        {**payload.alarm, "event_id": payload.event_id},
        stage=payload.stage,
        server_id=payload.server_id,
        dataset_id=payload.dataset_id,
        persist=False,
    )
    return {"ok": True, "store_size": len(ALARMS_STORE)}


@app.post("/api/internal/broadcast-log")
async def internal_broadcast_log(data: dict) -> dict:
    ws_broadcast_log(data)
    return {"ok": True}


@app.post("/api/internal/broadcast-metrics")
async def internal_broadcast_metrics(data: dict) -> dict:
    ws_broadcast_metrics(data)
    return {"ok": True}


@app.post("/api/internal/broadcast-activity")
async def internal_broadcast_activity(data: dict) -> dict:
    ws_broadcast_activity(data, persist=False)
    return {"ok": True, "store_size": len(ACTIVITIES_STORE)}


@app.post("/api/invalidate-cache")
async def invalidate_cache() -> dict:
    try:
        from app.api.routes import dashboard_routes
        dashboard_routes._cache.clear()
    except Exception:
        pass
    return {"ok": True}


