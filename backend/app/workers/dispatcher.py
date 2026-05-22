from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Any
from urllib.parse import urlsplit

from app.workers.logging import get_worker_logger
from app.workers.settings import WorkerSettings, get_worker_settings

logger = get_worker_logger(__name__)


@dataclass(frozen=True)
class EnqueuedTask:
    task_id: str
    task_name: str
    queue: str


class TaskDispatcher:
    def __init__(self, settings: WorkerSettings | None = None) -> None:
        self.settings = settings or get_worker_settings()
        self._broker_retry_at = 0.0

    def _broker_available(self) -> bool:
        return time.monotonic() >= self._broker_retry_at

    def _trip_broker_cooldown(self, seconds: int = 30) -> None:
        self._broker_retry_at = time.monotonic() + seconds

    @staticmethod
    def _is_redis_url(url: str) -> bool:
        return urlsplit(url).scheme.startswith("redis")

    @staticmethod
    def _probe_redis(url: str) -> bool:
        try:
            from redis import Redis
        except Exception:
            return True

        client = None
        try:
            client = Redis.from_url(
                url,
                socket_connect_timeout=0.5,
                socket_timeout=0.5,
                retry_on_timeout=False,
            )
            client.ping()
            return True
        except Exception:
            return False
        finally:
            if client is not None:
                try:
                    client.close()
                except Exception:
                    pass

    @staticmethod
    def _get_celery_app():
        from app.workers.celery_app import celery_app

        return celery_app

    def send_task(
        self,
        task_name: str,
        *,
        queue: str,
        kwargs: dict[str, Any] | None = None,
    ) -> EnqueuedTask:
        if not self.settings.enabled:
            raise RuntimeError("Task queue is disabled by configuration.")
        if not self._broker_available():
            raise RuntimeError("Task queue is temporarily unavailable.")
        if self._is_redis_url(self.settings.broker_url) and not self._probe_redis(self.settings.broker_url):
            self._trip_broker_cooldown()
            raise RuntimeError("Task queue broker is unavailable.")

        try:
            celery_app = self._get_celery_app()
            result = celery_app.send_task(task_name, kwargs=kwargs or {}, queue=queue)
            logger.info("Queued task name=%s id=%s queue=%s", task_name, result.id, queue)
            return EnqueuedTask(task_id=result.id, task_name=task_name, queue=queue)
        except Exception as exc:
            self._trip_broker_cooldown()
            logger.warning("Task broker unavailable for task=%s queue=%s: %s", task_name, queue, exc)
            raise RuntimeError("Task queue is unavailable.") from exc

    def wait_for_result(self, task_id: str, *, timeout: int) -> Any:
        from celery.exceptions import TimeoutError as CeleryTimeoutError
        from celery.result import AsyncResult

        if self._is_redis_url(self.settings.result_backend) and not self._probe_redis(self.settings.result_backend):
            self._trip_broker_cooldown()
            raise RuntimeError("Task result backend is unavailable.")

        celery_app = self._get_celery_app()
        result = AsyncResult(task_id, app=celery_app)
        try:
            return result.get(timeout=timeout, disable_sync_subtasks=False)
        except CeleryTimeoutError:
            logger.warning("Task result timed out id=%s timeout=%ss", task_id, timeout)
            raise TimeoutError(f"Task {task_id} timed out after {timeout} seconds.")
        except Exception as exc:
            self._trip_broker_cooldown()
            logger.warning("Task result backend unavailable id=%s: %s", task_id, exc)
            raise RuntimeError("Task result backend is unavailable.") from exc

    def enqueue_pipeline_run(
        self,
        *,
        trigger: str = "manual",
        requested_by: str = "system",
    ) -> EnqueuedTask:
        return self.send_task(
            "app.workers.tasks.pipeline.run_pipeline",
            queue=self.settings.pipeline_queue,
            kwargs={
                "trigger": trigger,
                "requested_by": requested_by,
            },
        )

    def enqueue_chat_response(
        self,
        *,
        prompt: str,
        context: str,
        user_message: str,
        fallback_response: str,
    ) -> EnqueuedTask:
        return self.send_task(
            "app.workers.tasks.chat.generate_chat_response",
            queue=self.settings.chat_queue,
            kwargs={
                "prompt": prompt,
                "context": context,
                "user_message": user_message,
                "fallback_response": fallback_response,
            },
        )
