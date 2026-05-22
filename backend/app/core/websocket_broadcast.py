from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import threading
import time
import uuid
from collections import deque
from typing import Any, Awaitable, Callable, Optional

from app.core.event_store import append_event

logger = logging.getLogger("websocket_broadcast")

_SEV_MAP = {
    "CRITIQUE": "CRITICAL",
    "AVERTISSEMENT": "HIGH",
    "AVERTISSEMENT_MOYEN": "MED",
    "CRITICAL": "CRITICAL",
    "HIGH": "HIGH",
    "MED": "MED",
    "LOW": "LOW",
}
_ACTION_MAP = {
    "BLOCK_24H": "BLOCK_NOW",
    "BLOCK_NOW": "BLOCK_NOW",
    "PREEMPTIVE_BLOCK": "BLOCK_NOW",
    "WATCHLIST_30MIN": "WATCHLIST",
    "WATCHLIST": "WATCHLIST",
    "TRAFFIC_THROTTLE": "WATCHLIST",
    "ESCALATE": "ESCALATE",
    "MONITOR": "MONITOR",
}
_VALID_ENGINES = {"SSH", "WEB", "FTP", "SESSION", "KERNEL", "PREDICTION", "CORRELATION", "CHAIN"}
_HUMAN = {
    "SSH": "Repeated login failures - brute-force pattern.",
    "WEB": "HTTP path scanning - automated vulnerability scanner.",
    "FTP": "Abnormal file transfer - possible data exfiltration.",
    "SESSION": "Session token reuse - session compromise suspected.",
    "KERNEL": "Kernel error spike - system instability.",
    "PREDICTION": "Pre-attack signals - distributed attack incoming.",
}

_pending: deque = deque(maxlen=500)
_pending_lock = threading.Lock()

_event_loop: Optional[asyncio.AbstractEventLoop] = None
_broadcast_raw: Optional[Callable[[dict], Awaitable[None]]] = None
_initialized = False
_fallback_warned = False
_instance_id = f"ws-{uuid.uuid4().hex[:12]}"
_redis_channel = os.getenv("WS_REDIS_CHANNEL", "idps:websocket:broadcast")
_publisher_lock: Optional[asyncio.Lock] = None
_subscriber_task: Optional[asyncio.Task] = None
_redis_connected = False
_last_publish_error_at = 0.0
_last_subscriber_error_at = 0.0
_REDIS_ERROR_LOG_INTERVAL_SECONDS = 30.0


def _redis_enabled() -> bool:
    return os.getenv("WS_REDIS_ENABLED", "true").lower() == "true"


def _redis_url() -> str:
    return os.getenv("WS_REDIS_URL", os.getenv("REDIS_URL", "redis://localhost:6379/0"))


def broadcaster_status() -> dict[str, Any]:
    return {
        "initialized": _initialized,
        "pending": len(_pending),
        "redis_enabled": _redis_enabled(),
        "redis_connected": _redis_connected,
        "channel": _redis_channel,
        "instance_id": _instance_id,
    }


async def _deliver_locally(payload: dict[str, Any]) -> None:
    if _broadcast_raw is None:
        return
    await _broadcast_raw(payload)


async def _publish_to_redis(payload: dict[str, Any]) -> bool:
    global _redis_connected, _last_publish_error_at

    if not _redis_enabled():
        return False

    try:
        from redis.asyncio import from_url
    except Exception as exc:
        logger.debug("Redis client unavailable for websocket pub/sub: %s", exc)
        return False

    if _publisher_lock is None:
        return False

    envelope = json.dumps({"origin": _instance_id, "payload": payload}, ensure_ascii=False, default=str)

    async with _publisher_lock:
        client = None
        try:
            client = from_url(_redis_url(), encoding="utf-8", decode_responses=True)
            await client.publish(_redis_channel, envelope)
            _redis_connected = True
            return True
        except Exception as exc:
            now = time.monotonic()
            if (now - _last_publish_error_at) >= _REDIS_ERROR_LOG_INTERVAL_SECONDS:
                logger.warning("Redis publish failed, falling back to local delivery: %s", exc)
                _last_publish_error_at = now
            _redis_connected = False
            return False
        finally:
            if client is not None:
                try:
                    await client.aclose()
                except Exception:
                    pass


async def _fanout(payload: dict[str, Any]) -> None:
    if await _publish_to_redis(payload):
        await _deliver_locally(payload)
        return

    await _deliver_locally(payload)


async def _subscriber_loop() -> None:
    global _redis_connected, _last_subscriber_error_at

    backoff_seconds = 1.0
    while _initialized and _event_loop is not None and not _event_loop.is_closed():
        if not _redis_enabled():
            return

        client = None
        pubsub = None
        try:
            from redis.asyncio import from_url

            client = from_url(_redis_url(), encoding="utf-8", decode_responses=True)
            pubsub = client.pubsub()
            await pubsub.subscribe(_redis_channel)
            _redis_connected = True
            backoff_seconds = 1.0
            logger.info("Redis websocket subscriber connected on channel=%s", _redis_channel)

            while _initialized and _event_loop is not None and not _event_loop.is_closed():
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if not message or message.get("type") != "message":
                    await asyncio.sleep(0.05)
                    continue

                raw_data = message.get("data")
                if not raw_data:
                    continue

                try:
                    envelope = json.loads(raw_data)
                except json.JSONDecodeError:
                    logger.warning("Invalid websocket pub/sub payload dropped")
                    continue

                origin = str(envelope.get("origin") or "")
                payload = envelope.get("payload")
                if not isinstance(payload, dict):
                    continue
                if origin == _instance_id:
                    continue
                await _deliver_locally(payload)
        except asyncio.CancelledError:
            _redis_connected = False
            return
        except Exception as exc:
            _redis_connected = False
            now = time.monotonic()
            if (now - _last_subscriber_error_at) >= _REDIS_ERROR_LOG_INTERVAL_SECONDS:
                logger.warning("Redis websocket subscriber disconnected: %s", exc)
                _last_subscriber_error_at = now
            await asyncio.sleep(backoff_seconds)
            backoff_seconds = min(backoff_seconds * 2, 10.0)
        finally:
            _redis_connected = False
            if pubsub is not None:
                try:
                    await pubsub.close()
                except Exception:
                    pass
            if client is not None:
                try:
                    await client.aclose()
                except Exception:
                    pass


def init_broadcaster(
    event_loop: asyncio.AbstractEventLoop,
    broadcast_raw_func: Callable[[dict], Awaitable[None]],
) -> None:
    global _event_loop, _broadcast_raw, _initialized, _publisher_lock, _subscriber_task
    _event_loop = event_loop
    _broadcast_raw = broadcast_raw_func
    _initialized = True
    _publisher_lock = asyncio.Lock()

    async def _drain() -> None:
        with _pending_lock:
            to_send = list(_pending)
            _pending.clear()

        for payload in to_send:
            try:
                await _fanout(payload)
            except Exception as exc:
                logger.warning("Pending websocket payload dropped during drain: %s", exc)

        logger.info("Drained %d pending websocket payload(s)", len(to_send))

    event_loop.create_task(_drain())

    if _subscriber_task is None or _subscriber_task.done():
        _subscriber_task = event_loop.create_task(_subscriber_loop())

    logger.info("Broadcaster initialised (queue size before init: %d)", len(_pending))


async def shutdown_broadcaster() -> None:
    global _event_loop, _broadcast_raw, _initialized, _publisher_lock, _subscriber_task, _redis_connected

    _initialized = False
    _redis_connected = False

    if _subscriber_task is not None:
        _subscriber_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _subscriber_task
        _subscriber_task = None

    _publisher_lock = None
    _broadcast_raw = None
    _event_loop = None


def _http_fallback_enabled() -> bool:
    return os.getenv("WS_FALLBACK_ENABLED", "true").lower() == "true"


def _http_fallback_base_url() -> str:
    return os.getenv("WS_INTERNAL_BASE_URL", "http://localhost:8000").rstrip("/")


def _http_fallback_payload(payload: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    msg_type = str(payload.get("type") or "")
    if msg_type == "alarm":
        return (
            "broadcast-alarm",
            {
                "alarm": payload.get("alarm", {}),
                "stage": payload.get("stage", "pass1"),
                "server_id": payload.get("server_id", "server1"),
                "dataset_id": payload.get("dataset_id", ""),
                "event_id": payload.get("event_id", ""),
            },
        )
    if msg_type == "log":
        return (
            "broadcast-log",
            {
                "line": payload.get("line", ""),
                "dataset_id": payload.get("dataset_id", ""),
                "event_id": payload.get("event_id", ""),
            },
        )
    if msg_type == "metrics":
        data = dict(payload.get("data", {}))
        if payload.get("dataset_id") and "dataset_id" not in data:
            data["dataset_id"] = payload.get("dataset_id")
        if payload.get("event_id") and "event_id" not in data:
            data["event_id"] = payload.get("event_id")
        return ("broadcast-metrics", data)
    if msg_type == "activity":
        activity = dict(payload.get("activity", {}))
        if payload.get("dataset_id") and "dataset_id" not in activity:
            activity["dataset_id"] = payload.get("dataset_id")
        if payload.get("event_id") and "event_id" not in activity:
            activity["event_id"] = payload.get("event_id")
        return ("broadcast-activity", activity)
    return None


def _try_http_fallback(payload: dict[str, Any]) -> bool:
    global _fallback_warned

    if not _http_fallback_enabled():
        return False

    endpoint_payload = _http_fallback_payload(payload)
    if endpoint_payload is None:
        return False

    endpoint, body = endpoint_payload
    try:
        import requests

        response = requests.post(
            f"{_http_fallback_base_url()}/api/internal/{endpoint}",
            json=body,
            timeout=1.5,
        )
        return response.ok
    except Exception as exc:
        if not _fallback_warned:
            logger.warning("HTTP websocket fallback unavailable: %s", exc)
            _fallback_warned = True
        return False


def _enqueue_or_send(payload: dict[str, Any]) -> None:
    if not _initialized or _event_loop is None or _broadcast_raw is None or _event_loop.is_closed():
        if _try_http_fallback(payload):
            return
        with _pending_lock:
            _pending.append(payload)
        return

    asyncio.run_coroutine_threadsafe(_fanout(payload), _event_loop)


def _normalize_alarm(
    raw_alarm: dict[str, Any],
    *,
    stage: str = "pass1",
    server_id: str = "",
    dataset_id: str = "",
    event_id: str = "",
) -> dict[str, Any]:
    from datetime import datetime as _dt

    raw = dict(raw_alarm or {})
    ts = str(raw.get("timestamp") or _dt.now().isoformat())
    try:
        ts = _dt.fromisoformat(ts).strftime("%H:%M:%S")
    except Exception:
        ts = ts[:8]

    alarm_type = str(raw.get("type") or "UNKNOWN")
    for token in ("🔴 ", "🟠 ", "🟡 ", "⚠️ ", "✅ "):
        alarm_type = alarm_type.replace(token, "")

    engine = str(raw.get("engine") or raw.get("domain") or alarm_type or "SSH").split("_")[0].upper()
    if engine not in _VALID_ENGINES:
        engine = "SSH"

    severity = _SEV_MAP.get(str(raw.get("severity") or raw.get("severite") or "HIGH").upper(), "MED")
    try:
        score = round(float(raw.get("score") or raw.get("score_final") or 0), 1)
    except Exception:
        score = 0.0

    normalized = {
        **raw,
        "id": str(raw.get("id") or f"ws-{uuid.uuid4().hex[:8]}-{int(time.time())}"),
        "timestamp": ts,
        "type": alarm_type.strip(),
        "source_ip": str(raw.get("source_ip") or raw.get("ip") or raw.get("IP_Source") or "N/A"),
        "severity": severity,
        "engine": engine,
        "score": score,
        "message": str(raw.get("message") or "")[:120],
        "human_insight": str(raw.get("human_insight") or _HUMAN.get(engine, "Anomalous activity detected.")),
        "action": _ACTION_MAP.get(str(raw.get("action") or "MONITOR").upper(), "MONITOR"),
        "country": str(raw.get("country") or "Unknown"),
        "failures": int(raw.get("failures") or 0),
        "server_id": server_id or str(raw.get("server_id") or raw.get("Serveur") or "server1"),
        "dataset_id": str(dataset_id or raw.get("dataset_id") or ""),
        "stage": stage,
        "event_id": str(event_id or raw.get("event_id") or ""),
    }
    return normalized


def _normalize_activity(activity: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(activity or {})
    normalized.setdefault("id", f"act-{uuid.uuid4().hex[:10]}")
    normalized.setdefault("timestamp", time.strftime("%H:%M:%S"))
    normalized.setdefault("stage", "session")
    normalized.setdefault("actor", "System")
    normalized.setdefault("title", normalized.get("event_type") or "Activity")
    normalized.setdefault("detail", "")
    normalized.setdefault("status", "info")
    normalized.setdefault("severity", "INFO")
    normalized.setdefault("dataset_id", str(activity.get("dataset_id") or ""))
    normalized["event_id"] = str(activity.get("event_id") or normalized.get("event_id") or "")
    return normalized


def _store_alert_event(alarm: dict[str, Any], stage: str) -> dict[str, Any]:
    record = append_event(
        category="alerts",
        event_type=f"ALERT_{stage.upper()}",
        payload={
            **alarm,
            "stage": stage,
        },
        dataset_id=str(alarm.get("dataset_id") or ""),
        source="websocket_broadcast",
        tags=["websocket", "alert"],
    )
    alarm["event_id"] = record["event_id"]
    return {"event_id": record["event_id"], "alarm": alarm}


def _activity_category(activity: dict[str, Any]) -> str | None:
    stage = str(activity.get("stage") or "").lower()
    if stage == "corrective":
        return "corrective"
    if stage == "fusion":
        return "fusion"
    return None


def broadcast_payload(payload: dict[str, Any]) -> None:
    _enqueue_or_send(dict(payload or {}))


def broadcast_alarm(
    raw_alarm: dict,
    stage: str = "pass1",
    server_id: str = "",
    dataset_id: str = "",
    *,
    persist: bool = True,
) -> None:
    normalized = _normalize_alarm(
        raw_alarm,
        stage=stage,
        server_id=server_id,
        dataset_id=dataset_id,
    )
    event_id = normalized.get("event_id", "")
    if persist:
        stored = _store_alert_event(normalized, stage)
        event_id = stored["event_id"]
        normalized = stored["alarm"]

    broadcast_payload({
        "type": "alarm",
        "event_id": event_id,
        "alarm": normalized,
        "stage": stage,
        "server_id": normalized.get("server_id", ""),
        "dataset_id": normalized.get("dataset_id", ""),
    })


def broadcast_log(data: dict) -> None:
    line = str(data.get("message") or data.get("line") or str(data))
    broadcast_payload({
        "type": "log",
        "line": line,
        "dataset_id": data.get("dataset_id", ""),
    })


def broadcast_metrics(data: dict) -> None:
    broadcast_payload({
        "type": "metrics",
        "data": data,
        "dataset_id": data.get("dataset_id", ""),
    })


def broadcast_activity(data: dict, *, persist: bool = True) -> None:
    activity = _normalize_activity(data)
    category = _activity_category(activity)
    event_id = activity.get("event_id", "")
    if persist and category is not None:
        record = append_event(
            category=category,
            event_type=str(activity.get("title") or activity.get("event_type") or "ACTIVITY").upper().replace(" ", "_"),
            payload=activity,
            dataset_id=str(activity.get("dataset_id") or ""),
            source="websocket_broadcast",
            tags=["websocket", category],
        )
        event_id = record["event_id"]
        activity["event_id"] = event_id

    broadcast_payload({
        "type": "activity",
        "event_id": event_id,
        "activity": activity,
        "dataset_id": activity.get("dataset_id", ""),
    })
