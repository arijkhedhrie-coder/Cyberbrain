from __future__ import annotations

import logging
import os

_LOG_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"


def configure_worker_logging(level: str | None = None) -> None:
    resolved_level = (level or os.getenv("WORKER_LOG_LEVEL") or "INFO").upper()
    root_logger = logging.getLogger()
    root_logger.setLevel(resolved_level)

    for handler in root_logger.handlers:
        if getattr(handler, "_idps_worker_logging", False):
            handler.setLevel(resolved_level)
            return

    handler = logging.StreamHandler()
    handler._idps_worker_logging = True  # type: ignore[attr-defined]
    handler.setLevel(resolved_level)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    root_logger.addHandler(handler)


def get_worker_logger(name: str) -> logging.Logger:
    configure_worker_logging()
    return logging.getLogger(name)
