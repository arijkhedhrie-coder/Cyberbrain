from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core import event_store
from app.core import websocket_broadcast as ws_broadcast
from app.services import auth_service
from app.workers.dispatcher import TaskDispatcher
from app.workers.settings import WorkerSettings


class _FailingRedisClient:
    async def publish(self, *args, **kwargs):
        raise RuntimeError("redis down")

    async def aclose(self) -> None:
        return None


class IntegrationValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)

        self._event_store_dir = event_store.EVENT_STORE_DIR
        self._timeline_file = event_store.TIMELINE_FILE
        self._category_files = dict(event_store._CATEGORY_FILES)

        event_store.EVENT_STORE_DIR = root
        event_store.TIMELINE_FILE = root / "timeline.jsonl"
        event_store._CATEGORY_FILES = {
            "alerts": root / "alerts.jsonl",
            "trust": root / "trust.jsonl",
            "corrective": root / "corrective.jsonl",
            "fusion": root / "fusion.jsonl",
        }

        self._env = patch.dict(
            os.environ,
            {
                "WS_REDIS_ENABLED": "false",
                "WS_FALLBACK_ENABLED": "false",
            },
            clear=False,
        )
        self._env.start()

        auth_service.ALARMS_STORE.clear()
        auth_service.ACTIVITIES_STORE.clear()
        auth_service._RECENT_EVENT_IDS.clear()
        auth_service._RECENT_EVENT_ID_SET.clear()
        auth_service._hydrate_live_stores()

        with ws_broadcast._pending_lock:
            ws_broadcast._pending.clear()
        ws_broadcast._fallback_warned = False
        ws_broadcast._last_publish_error_at = 0.0
        ws_broadcast._last_subscriber_error_at = 0.0

    def tearDown(self) -> None:
        self._env.stop()

        auth_service.ALARMS_STORE.clear()
        auth_service.ACTIVITIES_STORE.clear()
        auth_service._RECENT_EVENT_IDS.clear()
        auth_service._RECENT_EVENT_ID_SET.clear()

        with ws_broadcast._pending_lock:
            ws_broadcast._pending.clear()
        ws_broadcast._fallback_warned = False
        ws_broadcast._last_publish_error_at = 0.0
        ws_broadcast._last_subscriber_error_at = 0.0

        event_store.EVENT_STORE_DIR = self._event_store_dir
        event_store.TIMELINE_FILE = self._timeline_file
        event_store._CATEGORY_FILES = self._category_files
        self._tmp.cleanup()

    @staticmethod
    def _worker_settings() -> WorkerSettings:
        return WorkerSettings(
            enabled=True,
            broker_url="redis://localhost:6379/0",
            result_backend="redis://localhost:6379/0",
            default_queue="default",
            pipeline_queue="pipeline",
            chat_queue="chat",
            timezone="UTC",
            log_level="INFO",
            result_expires_seconds=3600,
            task_time_limit_seconds=3600,
            task_soft_time_limit_seconds=3300,
            chat_result_timeout_seconds=8,
            chat_local_timeout_seconds=6,
            chat_task_time_limit_seconds=20,
            chat_task_soft_time_limit_seconds=15,
            chat_task_max_retries=2,
            pipeline_task_max_retries=1,
            worker_pool="solo",
            worker_concurrency=1,
        )

    @staticmethod
    def _drain_initial_ws_messages(websocket) -> list[dict]:
        return [websocket.receive_json(), websocket.receive_json(), websocket.receive_json()]

    def test_redis_down_scenario_falls_back_without_hanging(self) -> None:
        dispatcher = TaskDispatcher(self._worker_settings())
        with patch.object(TaskDispatcher, "_probe_redis", return_value=False):
            start = time.monotonic()
            with self.assertRaisesRegex(RuntimeError, "broker is unavailable"):
                dispatcher.send_task("app.workers.tasks.pipeline.run_pipeline", queue="pipeline")
            with self.assertRaisesRegex(RuntimeError, "temporarily unavailable"):
                dispatcher.send_task("app.workers.tasks.pipeline.run_pipeline", queue="pipeline")
            self.assertLess(time.monotonic() - start, 0.5)

        with patch.dict(os.environ, {"WS_REDIS_ENABLED": "true"}, clear=False):
            with patch("redis.asyncio.from_url", return_value=_FailingRedisClient()):
                with self.assertLogs("websocket_broadcast", level="WARNING") as captured:
                    with TestClient(auth_service.app) as client:
                        with client.websocket_connect("/ws/logs") as websocket:
                            self._drain_initial_ws_messages(websocket)

                            start = time.monotonic()
                            ws_broadcast.broadcast_alarm(
                                {
                                    "type": "SSH_SCAN",
                                    "severity": "HIGH",
                                    "message": "redis-down-fallback",
                                    "source_ip": "10.0.0.1",
                                },
                                stage="final",
                                server_id="srv-redis",
                                dataset_id="ds-redis-down",
                            )
                            delivered = websocket.receive_json()
                            elapsed = time.monotonic() - start

                    self.assertEqual(delivered["type"], "alarm")
                    self.assertEqual(delivered["alarm"]["message"], "redis-down-fallback")
                    self.assertLess(elapsed, 2.0)
                    self.assertTrue(
                        any("falling back to local delivery" in line for line in captured.output),
                        captured.output,
                    )

    def test_websocket_replay_consistency_across_reconnect(self) -> None:
        with TestClient(auth_service.app):
            ws_broadcast.broadcast_alarm(
                {
                    "type": "SSH_SCAN",
                    "severity": "HIGH",
                    "message": "history-one",
                    "source_ip": "10.0.0.2",
                },
                stage="pass1",
                server_id="srv-replay",
                dataset_id="ds-replay",
            )
            ws_broadcast.broadcast_activity(
                {
                    "dataset_id": "ds-replay",
                    "stage": "corrective",
                    "actor": "Corrective Agent",
                    "title": "Corrective decision produced",
                    "event_type": "CORRECTIVE_TOOL_COMPLETED",
                    "detail": "baseline activity",
                    "status": "completed",
                    "severity": "INFO",
                },
                persist=True,
            )

        initial_events = event_store.replay_timeline(categories=["alerts"], dataset_id="ds-replay", limit=10)
        self.assertEqual(len(initial_events), 1)
        first_event_id = initial_events[0]["event_id"]

        with TestClient(auth_service.app) as client:
            with client.websocket_connect("/ws/logs") as websocket:
                connected, history, activity_history = self._drain_initial_ws_messages(websocket)
                self.assertEqual(connected["type"], "connected")
                self.assertEqual(history["type"], "history")
                self.assertEqual(activity_history["type"], "activity_history")
                self.assertIn("history-one", [item.get("message") for item in history["alarms"]])

            ws_broadcast.broadcast_alarm(
                {
                    "type": "SSH_SCAN",
                    "severity": "HIGH",
                    "message": "history-two",
                    "source_ip": "10.0.0.3",
                },
                stage="final",
                server_id="srv-replay",
                dataset_id="ds-replay",
            )
            second_event_id = event_store.replay_timeline(categories=["alerts"], dataset_id="ds-replay", limit=10)[-1]["event_id"]

            with client.websocket_connect("/ws/logs") as websocket:
                connected, history, activity_history = self._drain_initial_ws_messages(websocket)
                self.assertEqual(connected["type"], "connected")
                self.assertEqual(history["type"], "history")
                self.assertEqual(activity_history["type"], "activity_history")
                self.assertEqual([item.get("message") for item in history["alarms"][:2]], ["history-two", "history-one"])

                websocket.send_json(
                    {
                        "type": "resume",
                        "dataset": "ds-replay",
                        "servers": ["srv-replay"],
                        "last_event_id": first_event_id,
                    }
                )
                replay = websocket.receive_json()
                self.assertEqual(replay["type"], "timeline_replay")
                replay_event_ids = [event["event_id"] for event in replay["events"]]
                self.assertGreaterEqual(replay["count"], 1)
                self.assertIn(second_event_id, replay_event_ids)

                ws_broadcast.broadcast_alarm(
                    {
                        "type": "SSH_SCAN",
                        "severity": "HIGH",
                        "message": "live-three",
                        "source_ip": "10.0.0.4",
                    },
                    stage="final",
                    server_id="srv-replay",
                    dataset_id="ds-replay",
                )
                delivered = websocket.receive_json()
                self.assertEqual(delivered["type"], "alarm")
                self.assertEqual(delivered["alarm"]["message"], "live-three")

    def test_event_deduplication_keeps_one_stored_record(self) -> None:
        alarm_payload = {
            "type": "SSH_SCAN",
            "severity": "HIGH",
            "message": "dedupe-check",
            "source_ip": "10.0.0.5",
        }

        with TestClient(auth_service.app) as client:
            ws_broadcast.broadcast_alarm(
                alarm_payload,
                stage="final",
                server_id="srv-dedupe",
                dataset_id="ds-dedupe",
            )

            stored_before = event_store.replay_timeline(categories=["alerts"], dataset_id="ds-dedupe", limit=20)
            self.assertEqual(len(stored_before), 1)
            stored_event_id = stored_before[0]["event_id"]

            for _ in range(2):
                response = client.post(
                    "/api/internal/broadcast-alarm",
                    json={
                        "alarm": alarm_payload,
                        "stage": "final",
                        "server_id": "srv-dedupe",
                        "dataset_id": "ds-dedupe",
                        "event_id": stored_event_id,
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)

        stored_after = event_store.replay_timeline(categories=["alerts"], dataset_id="ds-dedupe", limit=20)
        self.assertEqual(len(stored_after), 1)
        self.assertEqual(stored_after[0]["event_id"], stored_event_id)


if __name__ == "__main__":
    unittest.main()
