from __future__ import annotations

import asyncio
import logging
import os
import threading
from collections import deque
from typing import Any, Callable, Awaitable, Optional

logger = logging.getLogger("websocket_broadcast")

# ── Thread‑safe queue with lock ────────────────────────────────────────────
_pending: deque = deque(maxlen=500)
_pending_lock = threading.Lock()

_event_loop: Optional[asyncio.AbstractEventLoop] = None
_broadcast_raw: Optional[Callable[[dict], Awaitable[None]]] = None
_initialized: bool = False
_fallback_warned: bool = False


def init_broadcaster(
    event_loop: asyncio.AbstractEventLoop,
    broadcast_raw_func: Callable[[dict], Awaitable[None]],
) -> None:
    global _event_loop, _broadcast_raw, _initialized
    _event_loop = event_loop
    _broadcast_raw = broadcast_raw_func
    _initialized = True

    async def _drain():
        # Capture pending messages under lock
        with _pending_lock:
            to_send = list(_pending)
            _pending.clear()

        for payload in to_send:
            for attempt in range(2):
                try:
                    if _broadcast_raw:
                        await _broadcast_raw(payload)
                    break
                except Exception as e:
                    logger.warning("Broadcast attempt %d failed: %s", attempt + 1, e)
                    if attempt == 0:
                        await asyncio.sleep(0.05)
                    else:
                        logger.error("Message permanently lost after 2 attempts: %s", payload.get("type", "unknown"))

        logger.info("Drained %d pending messages after broadcaster init", len(to_send))

    asyncio.create_task(_drain())
    logger.info("Broadcaster initialised (queue size before init: %d)", len(_pending))


def _http_fallback_enabled() -> bool:
    return os.getenv("WS_FALLBACK_ENABLED", "true").lower() == "true"


def _http_fallback_base_url() -> str:
    return os.getenv("WS_INTERNAL_BASE_URL", "http://localhost:8000").rstrip("/")


def _http_fallback_payload(payload: dict) -> tuple[str, dict] | None:
    msg_type = str(payload.get("type") or "")
    if msg_type == "alarm":
        return (
            "broadcast-alarm",
            {
                "alarm": payload.get("alarm", {}),
                "stage": payload.get("stage", "pass1"),
                "server_id": payload.get("server_id", "server1"),
            },
        )
    if msg_type == "log":
        return ("broadcast-log", {"line": payload.get("line", "")})
    if msg_type == "metrics":
        return ("broadcast-metrics", payload.get("data", {}))
    if msg_type == "activity":
        return ("broadcast-activity", payload.get("activity", {}))
    return None


def _try_http_fallback(payload: dict) -> bool:
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
        if response.ok:
            return True
        logger.warning(
            "HTTP fallback for %s failed with status %s",
            payload.get("type", "unknown"),
            response.status_code,
        )
    except Exception as exc:
        if not _fallback_warned:
            logger.warning("HTTP fallback unavailable: %s", exc)
            _fallback_warned = True
    return False


def _run_broadcast(payload: dict) -> None:
    if not _initialized or _event_loop is None or _broadcast_raw is None or _event_loop.is_closed():
        if _try_http_fallback(payload):
            return
        with _pending_lock:
            _pending.append(payload)
            logger.debug("Broadcaster not ready, queued message (queue size=%d)", len(_pending))
        return

    asyncio.run_coroutine_threadsafe(_broadcast_raw(payload), _event_loop)


def broadcast_alarm(raw_alarm: dict, stage: str = "pass1", server_id: str = "") -> None:
    _run_broadcast({"type": "alarm", "alarm": raw_alarm, "stage": stage, "server_id": server_id})

def broadcast_log(data: dict) -> None:
    line = str(data.get("message") or data.get("line") or str(data))
    _run_broadcast({"type": "log", "line": line})

def broadcast_metrics(data: dict) -> None:
    _run_broadcast({"type": "metrics", "data": data})

def broadcast_activity(data: dict) -> None:
    _run_broadcast({"type": "activity", "activity": data})
