from __future__ import annotations

from celery import Celery
from celery.signals import after_setup_logger, after_setup_task_logger, worker_process_init

from app.workers.logging import configure_worker_logging
from app.workers.settings import get_worker_settings

settings = get_worker_settings()
configure_worker_logging(settings.log_level)

celery_app = Celery("idps-background")
celery_app.conf.update(
    broker_url=settings.broker_url,
    result_backend=settings.result_backend,
    imports=("app.workers.tasks.pipeline", "app.workers.tasks.chat"),
    task_default_queue=settings.default_queue,
    task_routes={
        "app.workers.tasks.pipeline.run_pipeline": {"queue": settings.pipeline_queue},
        "app.workers.tasks.chat.generate_chat_response": {"queue": settings.chat_queue},
    },
    accept_content=["json"],
    task_serializer="json",
    result_serializer="json",
    task_track_started=True,
    result_expires=settings.result_expires_seconds,
    task_time_limit=settings.task_time_limit_seconds,
    task_soft_time_limit=settings.task_soft_time_limit_seconds,
    timezone=settings.timezone,
    enable_utc=True,
    broker_connection_retry_on_startup=True,
    worker_hijack_root_logger=False,
)


@after_setup_logger.connect
def _configure_celery_root_logger(*_args, **_kwargs) -> None:
    configure_worker_logging(settings.log_level)


@after_setup_task_logger.connect
def _configure_celery_task_logger(*_args, **_kwargs) -> None:
    configure_worker_logging(settings.log_level)


@worker_process_init.connect
def _configure_worker_process(**_kwargs) -> None:
    configure_worker_logging(settings.log_level)
