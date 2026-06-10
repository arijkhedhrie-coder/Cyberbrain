from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.services.background_tasks import get_task_dispatcher
from app.services.chat_runtime import (
    build_chat_fallback_response,
    build_chat_prompt,
    call_llm,
    get_dashboard_context,
)
from app.workers.logging import get_worker_logger

router = APIRouter(prefix="/api", tags=["chat"])
logger = get_worker_logger(__name__)


class ChatRequest(BaseModel):
    message: str


def _chat_failure_reason(exc: Exception) -> str:
    if isinstance(exc, TimeoutError):
        return "Le service de file d'attente a depasse le delai de reponse"
    if isinstance(exc, RuntimeError):
        return str(exc)
    return f"{type(exc).__name__}: {exc}"


@router.post("/chat")
async def chat_endpoint(req: ChatRequest, request: Request) -> dict[str, str]:
    context = get_dashboard_context()
    prompt = build_chat_prompt(req.message, context)
    dispatcher = get_task_dispatcher(request.app)

    if dispatcher.settings.enabled:
        try:
            job = await asyncio.to_thread(
                dispatcher.enqueue_chat_response,
                prompt=prompt,
                context=context,
                user_message=req.message,
                fallback_response="",
            )
            result = await asyncio.to_thread(
                dispatcher.wait_for_result,
                job.task_id,
                timeout=dispatcher.settings.chat_result_timeout_seconds,
            )
            if isinstance(result, dict) and result.get("response"):
                return {"response": str(result["response"])}
        except TimeoutError as exc:
            logger.warning("Chat worker timed out; falling back to local execution.")
        except RuntimeError as exc:
            logger.warning("Chat worker unavailable; falling back to local execution: %s", exc)
        except Exception as exc:
            logger.exception("Chat worker execution failed; falling back to local execution.")

    try:
        answer = await asyncio.wait_for(
            asyncio.to_thread(
                call_llm,
                prompt,
                timeout_seconds=dispatcher.settings.chat_local_timeout_seconds,
            ),
            timeout=dispatcher.settings.chat_local_timeout_seconds,
        )
        return {"response": answer}
    except Exception as exc:
        logger.warning("Chat local fallback failed; returning deterministic fallback response.")
        return {
            "response": build_chat_fallback_response(
                context,
                req.message,
                reason=_chat_failure_reason(exc),
            )
        }
