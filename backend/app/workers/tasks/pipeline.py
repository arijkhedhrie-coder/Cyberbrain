from __future__ import annotations

import time
from typing import Any

from billiard.exceptions import SoftTimeLimitExceeded

from app.workers.celery_app import celery_app
from app.workers.logging import get_worker_logger
from app.workers.settings import get_worker_settings

logger = get_worker_logger(__name__)
settings = get_worker_settings()


def _is_retryable_pipeline_exception(exc: Exception) -> bool:
    retryable_names = {
        "ConnectTimeout",
        "ConnectionError",
        "EndpointConnectionError",
        "ReadTimeout",
    }
    return isinstance(exc, (TimeoutError, ConnectionError, OSError)) or exc.__class__.__name__ in retryable_names


@celery_app.task(
    bind=True,
    name="app.workers.tasks.pipeline.run_pipeline",
    soft_time_limit=settings.task_soft_time_limit_seconds,
    time_limit=settings.task_time_limit_seconds,
)
def run_pipeline(self, trigger: str = "manual", requested_by: str = "system") -> dict[str, Any]:
    started_at = time.perf_counter()
    logger.info(
        "Starting pipeline task id=%s trigger=%s requested_by=%s",
        self.request.id,
        trigger,
        requested_by,
    )

    try:
        from app.main import main

        main()
    except SoftTimeLimitExceeded:
        logger.error("Pipeline task soft-timed out id=%s", self.request.id)
        raise
    except Exception as exc:
        if _is_retryable_pipeline_exception(exc) and self.request.retries < settings.pipeline_task_max_retries:
            countdown = min(60, 10 * (2 ** self.request.retries))
            logger.warning(
                "Retrying pipeline task id=%s retry=%s reason=%s",
                self.request.id,
                self.request.retries + 1,
                type(exc).__name__,
            )
            raise self.retry(exc=exc, countdown=countdown)
        logger.exception("Pipeline task failed id=%s", self.request.id)
        raise

    duration_seconds = round(time.perf_counter() - started_at, 2)
    logger.info(
        "Pipeline task completed id=%s duration_seconds=%s",
        self.request.id,
        duration_seconds,
    )
    return {
        "task_id": self.request.id,
        "trigger": trigger,
        "requested_by": requested_by,
        "status": "completed",
        "duration_seconds": duration_seconds,
    }
