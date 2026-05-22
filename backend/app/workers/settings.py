from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import urlsplit, urlunsplit


def _as_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _redact_url(url: str) -> str:
    parsed = urlsplit(url)
    if not parsed.password:
        return url

    username = parsed.username or ""
    netloc = parsed.hostname or ""
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    if username:
        netloc = f"{username}:***@{netloc}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))


def _default_redis_url() -> str:
    # Local development should default to localhost; Docker injects service URLs explicitly.
    return "redis://localhost:6379/0"


def _default_worker_pool() -> str:
    # Celery's prefork pool is unstable on native Windows; solo is the safe baseline there.
    return "solo" if os.name == "nt" else "prefork"


@dataclass(frozen=True)
class WorkerSettings:
    enabled: bool
    broker_url: str
    result_backend: str
    default_queue: str
    pipeline_queue: str
    chat_queue: str
    timezone: str
    log_level: str
    result_expires_seconds: int
    task_time_limit_seconds: int
    task_soft_time_limit_seconds: int
    chat_result_timeout_seconds: int
    chat_local_timeout_seconds: int
    chat_task_time_limit_seconds: int
    chat_task_soft_time_limit_seconds: int
    chat_task_max_retries: int
    pipeline_task_max_retries: int
    worker_pool: str
    worker_concurrency: int

    @property
    def safe_broker_url(self) -> str:
        return _redact_url(self.broker_url)

    @property
    def safe_result_backend(self) -> str:
        return _redact_url(self.result_backend)


@lru_cache(maxsize=1)
def get_worker_settings() -> WorkerSettings:
    redis_url = os.getenv("REDIS_URL", _default_redis_url())
    broker_url = os.getenv("CELERY_BROKER_URL", redis_url)
    result_backend = os.getenv("CELERY_RESULT_BACKEND", redis_url)

    return WorkerSettings(
        enabled=_as_bool("TASK_QUEUE_ENABLED", True),
        broker_url=broker_url,
        result_backend=result_backend,
        default_queue=os.getenv("CELERY_DEFAULT_QUEUE", "default"),
        pipeline_queue=os.getenv("CELERY_PIPELINE_QUEUE", "pipeline"),
        chat_queue=os.getenv("CELERY_CHAT_QUEUE", "chat"),
        timezone=os.getenv("CELERY_TIMEZONE", "UTC"),
        log_level=os.getenv("WORKER_LOG_LEVEL", "INFO").upper(),
        result_expires_seconds=_as_int("CELERY_RESULT_EXPIRES_SECONDS", 3600),
        task_time_limit_seconds=_as_int("CELERY_TASK_TIME_LIMIT_SECONDS", 3600),
        task_soft_time_limit_seconds=_as_int("CELERY_TASK_SOFT_TIME_LIMIT_SECONDS", 3300),
        chat_result_timeout_seconds=_as_int("CHAT_RESULT_TIMEOUT_SECONDS", 8),
        chat_local_timeout_seconds=_as_int("CHAT_LOCAL_TIMEOUT_SECONDS", 6),
        chat_task_time_limit_seconds=_as_int("CHAT_TASK_TIME_LIMIT_SECONDS", 20),
        chat_task_soft_time_limit_seconds=_as_int("CHAT_TASK_SOFT_TIME_LIMIT_SECONDS", 15),
        chat_task_max_retries=_as_int("CHAT_TASK_MAX_RETRIES", 2),
        pipeline_task_max_retries=_as_int("PIPELINE_TASK_MAX_RETRIES", 1),
        worker_pool=os.getenv("CELERY_WORKER_POOL", _default_worker_pool()),
        worker_concurrency=_as_int("CELERY_WORKER_CONCURRENCY", 1),
    )
