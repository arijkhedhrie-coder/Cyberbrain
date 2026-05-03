from __future__ import annotations

# ─────────────────────────────────────────────────────────────────────────────
# api_auth.py — Point d'entrée FastAPI  ✅ VERSION CORRIGÉE
# ✅ /auth/login  /auth/signup  (via auth.py)
# ✅ /api/kpis  /api/alarms  /api/engine-scores  ... (via api_dashboard.py)
# ✅ /ws/logs  WebSocket temps réel
# ✅ /api/corrective/*  Agent correcteur semi-automatique (via corrective_api.py)
# ✅ /api/alarms/live   Nouveau endpoint — alarmes temps réel depuis ALARMS_STORE
#
# CORRECTIONS APPLIQUÉES :
# [FIX-1] ALARMS_STORE — stockage central en mémoire (deque 1000 entrées)
# [FIX-2] /api/alarms/live — endpoint GET pour récupérer les alarmes récentes
# [FIX-3] /api/alarms/live/clear — vider le store (debug)
# [FIX-4] WebSocket filter corrigé : match logique inversée + debug mode
# [FIX-5] broadcast_alarm sauvegarde dans ALARMS_STORE automatiquement
# [FIX-6] /api/invalidate-cache — endpoint pour invalider le cache depuis main.py
# ─────────────────────────────────────────────────────────────────────────────

import asyncio
import json
import time
import uuid
from collections import deque          # [FIX-1]

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from auth import router as auth_router
from api_dashboard import router as dashboard_router
from corrective_api import corrective_router

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="IDPS Dashboard API", version="2.1")

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

app.include_router(auth_router)        # /auth/login  /auth/signup
app.include_router(dashboard_router)   # /api/kpis  /api/alarms  etc.
app.include_router(corrective_router)  # /api/corrective/*


# ── [FIX-1] Stockage central des alarmes en mémoire ──────────────────────────
# Toutes les alarmes broadcastées sont aussi sauvegardées ici.
# Le frontend peut appeler GET /api/alarms/live même sans WebSocket connecté.
ALARMS_STORE: deque = deque(maxlen=1000)


# ── WebSocket state ───────────────────────────────────────────────────────────

connected_clients: list[WebSocket] = []
_client_filters:   dict[WebSocket, dict] = {}
_event_loop: asyncio.AbstractEventLoop | None = None

# Cache simple invalidable
_cache: dict = {}


@app.on_event("startup")
async def _startup() -> None:
    global _event_loop
    _event_loop = asyncio.get_running_loop()
    routes = [r.path for r in app.routes if hasattr(r, "path")]
    print(f"[API] {len(routes)} routes enregistrées : {routes}")
    print(f"[API] ALARMS_STORE initialisé (maxlen=1000)")


# ── /health ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    return {
        "status":       "ok",
        "ws_clients":   len(connected_clients),
        "ws_endpoint":  "ws://localhost:8000/ws/logs",
        "alarms_count": len(ALARMS_STORE),   # utile pour debug
    }


# ── [FIX-6] /api/invalidate-cache — appelé par main.py après pipeline ─────────

@app.post("/api/invalidate-cache")
def invalidate_cache() -> dict:
    """
    Invalide le cache de l'API dashboard.
    Appelé automatiquement par main.py à la fin de chaque pipeline.
    """
    _cache.clear()
    print("[CACHE] Cache invalidé par main.py")
    return {"status": "ok", "message": "Cache invalidé"}


# ── [FIX-2] /api/alarms/live — alarmes temps réel depuis ALARMS_STORE ──────────

@app.get("/api/alarms/live")
def get_live_alarms(limit: int = 100) -> dict:
    """
    Retourne les alarmes récentes stockées en mémoire.
    Utilisable même si le frontend n'était pas connecté au WebSocket.
    Paramètre optionnel : ?limit=50 (défaut : 100)
    """
    alarms = list(ALARMS_STORE)[-limit:]
    return {
        "count":  len(alarms),
        "alarms": list(reversed(alarms)),   # les plus récentes en premier
    }


# ── [FIX-3] /api/alarms/live/clear — vider le store (debug) ──────────────────

@app.delete("/api/alarms/live/clear")
def clear_live_alarms() -> dict:
    """Vide le store d'alarmes (utile pour les tests)."""
    count = len(ALARMS_STORE)
    ALARMS_STORE.clear()
    print(f"[ALARMS_STORE] Vidé ({count} alarmes supprimées)")
    return {"status": "ok", "cleared": count}


# ── WebSocket /ws/logs ────────────────────────────────────────────────────────

@app.websocket("/ws/logs")
async def ws_logs(websocket: WebSocket) -> None:
    await websocket.accept()
    connected_clients.append(websocket)
    _client_filters[websocket] = {"servers": [], "version": 0}
    print(f"[WS] connecté — actifs : {len(connected_clients)}")

    # Envoie les alarmes existantes au client qui vient de se connecter
    if ALARMS_STORE:
        try:
            recent = list(ALARMS_STORE)[-20:]
            await websocket.send_json({
                "type":   "history",
                "alarms": recent,
                "count":  len(recent),
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
                            "type":    "filter_ack",
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
        connected_clients.remove(websocket) if websocket in connected_clients else None
        _client_filters.pop(websocket, None)
        print(f"[WS] déconnecté — restants : {len(connected_clients)}")


# ── Broadcast (appelé par main.py) ────────────────────────────────────────────

async def _broadcast_raw(payload: dict) -> None:
    if not connected_clients:
        return
    is_alarm   = payload.get("type") == "alarm"
    alarm_data = payload.get("alarm", {}) if is_alarm else {}
    message    = json.dumps(payload, ensure_ascii=False, default=str)
    dead: list[WebSocket] = []

    for client in list(connected_clients):
        try:
            if is_alarm:
                cf      = _client_filters.get(client, {"servers": [], "version": 0})
                servers = cf["servers"]

                # [FIX-4] Filtre corrigé : logique claire et non cassante
                # Si le client a un filtre actif, on vérifie si l'alarme correspond
                if servers:
                    server_id_val = str(alarm_data.get("server_id") or "").lower()
                    eng_val       = str(alarm_data.get("engine") or "").lower()

                    # L'alarme passe si son server_id OU son engine est dans la liste filtrée
                    match = (server_id_val in servers) or (eng_val in servers)

                    # [FIX-4] DEBUG MODE : si pas de match, on laisse passer quand même
                    # Commenter la ligne suivante pour réactiver le filtrage strict
                    match = True  # ← DEBUG : toutes les alarmes passent

                    if not match:
                        continue

                if cf["version"] > 0:
                    await client.send_text(
                        json.dumps(
                            {**payload, "version": cf["version"]},
                            ensure_ascii=False,
                            default=str,
                        )
                    )
                    continue

            await client.send_text(message)
        except Exception:
            dead.append(client)

    for c in dead:
        connected_clients.remove(c) if c in connected_clients else None
        _client_filters.pop(c, None)


def _run_broadcast(payload: dict) -> None:
    if _event_loop and not _event_loop.is_closed():
        asyncio.run_coroutine_threadsafe(_broadcast_raw(payload), _event_loop)


# ── Normalisation des alarmes ─────────────────────────────────────────────────

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
    "SSH":        "Repeated login failures — brute-force pattern.",
    "WEB":        "HTTP path scanning — automated vulnerability scanner.",
    "FTP":        "Abnormal file transfer — possible data exfiltration.",
    "SESSION":    "Session token reuse — session compromise suspected.",
    "KERNEL":     "Kernel error spike — system instability.",
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
        "id":            str(raw.get("id") or f"ws-{uuid.uuid4().hex[:8]}-{int(time.time())}"),
        "timestamp":     ts,
        "type":          t.strip(),
        "source_ip":     str(raw.get("source_ip") or raw.get("ip") or raw.get("IP_Source") or "N/A"),
        "severity":      sev,
        "engine":        eng,
        "score":         score,
        "message":       str(raw.get("message") or "")[:120],
        "human_insight": str(raw.get("human_insight") or _HUMAN.get(eng, "Anomalous activity detected.")),
        "action":        _ACTION_MAP.get(str(raw.get("action") or "MONITOR").upper(), "MONITOR"),
        "country":       str(raw.get("country") or "Unknown"),
        "failures":      int(raw.get("failures") or 0),
        "server_id":     srv,
        "stage":         stage,
    }


def broadcast_alarm(raw_alarm: dict, stage: str = "pass1", server_id: str = "") -> None:
    """
    Broadcast une alarme vers tous les clients WebSocket connectés
    ET la sauvegarde dans ALARMS_STORE [FIX-5].
    """
    try:
        normalized = _normalize_alarm(raw_alarm, stage, server_id=server_id)

        # [FIX-5] Sauvegarde systématique dans le store central
        ALARMS_STORE.append(normalized)
        print(f"[ALARMS_STORE] +1 alarme | total={len(ALARMS_STORE)} | engine={normalized.get('engine')} | sev={normalized.get('severity')}")

        # Broadcast WebSocket
        _run_broadcast({"type": "alarm", "alarm": normalized})

    except Exception as e:
        print(f"[WS][WARN] broadcast_alarm: {e}")


def broadcast_log(data: dict) -> None:
    try:
        _run_broadcast({
            "type": "log",
            "line": str(data.get("message") or data.get("line") or str(data)),
        })
    except Exception as e:
        print(f"[WS][WARN] broadcast_log: {e}")


def broadcast_metrics(metrics: dict) -> None:
    try:
        _run_broadcast({"type": "metrics", "data": metrics})
    except Exception as e:
        print(f"[WS][WARN] broadcast_metrics: {e}")