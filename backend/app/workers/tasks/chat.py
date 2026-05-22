from __future__ import annotations

from billiard.exceptions import SoftTimeLimitExceeded

from app.services.chat_runtime import build_chat_fallback_response, call_llm
from app.workers.celery_app import celery_app
from app.workers.logging import get_worker_logger
from app.workers.settings import get_worker_settings

logger = get_worker_logger(__name__)
settings = get_worker_settings()


def _is_retryable_chat_exception(exc: Exception) -> bool:
    return isinstance(exc, (TimeoutError, ConnectionError, OSError))


@celery_app.task(
    bind=True,
    name="app.workers.tasks.chat.generate_chat_response",
    soft_time_limit=settings.chat_task_soft_time_limit_seconds,
    time_limit=settings.chat_task_time_limit_seconds,
)
def generate_chat_response(
    self,
    *,
    prompt: str,
    context: str,
    user_message: str,
    fallback_response: str = "",
) -> dict[str, str]:
    try:
        response = call_llm(
            prompt,
            timeout_seconds=max(1.0, float(settings.chat_task_soft_time_limit_seconds - 1)),
        )
        return {"response": response, "source": "worker"}
    except SoftTimeLimitExceeded:
        logger.warning("Chat task soft-timed out id=%s", self.request.id)
        return {
            "response": fallback_response or build_chat_fallback_response(context, user_message),
            "source": "fallback",
        }
    except Exception as exc:
        if _is_retryable_chat_exception(exc) and self.request.retries < settings.chat_task_max_retries:
            countdown = min(15, 3 * (2 ** self.request.retries))
            logger.warning(
                "Retrying chat task id=%s retry=%s reason=%s",
                self.request.id,
                self.request.retries + 1,
                type(exc).__name__,
            )
            raise self.retry(exc=exc, countdown=countdown)

        logger.warning(
            "Chat task falling back id=%s reason=%s",
            self.request.id,
            type(exc).__name__,
        )
        return {
            "response": fallback_response or build_chat_fallback_response(context, user_message),
            "source": "fallback",
        }
