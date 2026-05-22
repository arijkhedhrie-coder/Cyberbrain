from __future__ import annotations

from fastapi import FastAPI

from app.workers.dispatcher import EnqueuedTask, TaskDispatcher
from app.workers.logging import configure_worker_logging, get_worker_logger
from app.workers.settings import get_worker_settings

TASK_DISPATCHER_STATE_KEY = "task_dispatcher"

logger = get_worker_logger(__name__)


def bootstrap_task_dispatcher(app: FastAPI) -> TaskDispatcher:
    settings = get_worker_settings()
    configure_worker_logging(settings.log_level)

    dispatcher = TaskDispatcher(settings)
    setattr(app.state, TASK_DISPATCHER_STATE_KEY, dispatcher)
    setattr(app.state, "task_queue_settings", settings)

    logger.info(
        "Task dispatcher ready enabled=%s broker=%s result_backend=%s default_queue=%s pipeline_queue=%s chat_queue=%s",
        settings.enabled,
        settings.safe_broker_url,
        settings.safe_result_backend,
        settings.default_queue,
        settings.pipeline_queue,
        settings.chat_queue,
    )
    return dispatcher


def get_task_dispatcher(app: FastAPI) -> TaskDispatcher:
    dispatcher = getattr(app.state, TASK_DISPATCHER_STATE_KEY, None)
    if dispatcher is None:
        dispatcher = TaskDispatcher()
        setattr(app.state, TASK_DISPATCHER_STATE_KEY, dispatcher)
    return dispatcher


def enqueue_pipeline_run(
    *,
    trigger: str = "manual",
    requested_by: str = "system",
) -> EnqueuedTask | None:
    dispatcher = TaskDispatcher()
    if not dispatcher.settings.enabled:
        logger.warning("Skipping pipeline enqueue because TASK_QUEUE_ENABLED=false")
        return None

    try:
        return dispatcher.enqueue_pipeline_run(trigger=trigger, requested_by=requested_by)
    except Exception:
        logger.exception("Failed to enqueue pipeline task")
        return None
