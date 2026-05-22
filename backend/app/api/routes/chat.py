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


@router.post("/chat")
async def chat_endpoint(req: ChatRequest, request: Request) -> dict[str, str]:
    context = get_dashboard_context()
    prompt = build_chat_prompt(req.message, context)
    fallback_response = build_chat_fallback_response(context, req.message)
    dispatcher = get_task_dispatcher(request.app)

    if dispatcher.settings.enabled:
        try:
            job = await asyncio.to_thread(
                dispatcher.enqueue_chat_response,
                prompt=prompt,
                context=context,
                user_message=req.message,
                fallback_response=fallback_response,
            )
            result = await asyncio.to_thread(
                dispatcher.wait_for_result,
                job.task_id,
                timeout=dispatcher.settings.chat_result_timeout_seconds,
            )
            if isinstance(result, dict) and result.get("response"):
                return {"response": str(result["response"])}
        except TimeoutError:
            logger.warning("Chat worker timed out; falling back to local execution.")
            pass
        except RuntimeError as exc:
            logger.warning("Chat worker unavailable; falling back to local execution: %s", exc)
            pass
        except Exception:
            logger.exception("Chat worker execution failed; falling back to local execution.")
            pass

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
    except Exception:
        logger.warning("Chat local fallback failed; returning deterministic fallback response.")
        return {"response": fallback_response}
