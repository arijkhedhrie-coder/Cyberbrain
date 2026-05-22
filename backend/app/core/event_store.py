from __future__ import annotations

import json
import threading
import uuid
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from app.core.fusion_view import FUSION_DATASET, is_fusion_dataset

PROJECT_ROOT = Path(__file__).resolve().parents[1]
EVENT_STORE_DIR = PROJECT_ROOT / "output" / "event_store"
TIMELINE_FILE = EVENT_STORE_DIR / "timeline.jsonl"

_LOCK = threading.Lock()
_CATEGORY_FILES = {
    "alerts": EVENT_STORE_DIR / "alerts.jsonl",
    "trust": EVENT_STORE_DIR / "trust.jsonl",
    "corrective": EVENT_STORE_DIR / "corrective.jsonl",
    "fusion": EVENT_STORE_DIR / "fusion.jsonl",
}


def _ensure_store() -> None:
    EVENT_STORE_DIR.mkdir(parents=True, exist_ok=True)


def _utc_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _write_jsonl(path: Path, record: dict[str, Any]) -> None:
    line = json.dumps(record, ensure_ascii=False, default=str)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def append_event(
    *,
    category: str,
    event_type: str,
    payload: dict[str, Any],
    dataset_id: str = "",
    source: str = "",
    tags: list[str] | None = None,
) -> dict[str, Any]:
    _ensure_store()
    category_key = category.strip().lower()
    if category_key not in _CATEGORY_FILES:
        raise ValueError(f"Unsupported event category: {category}")

    record = {
        "event_id": f"evt-{uuid.uuid4().hex}",
        "category": category_key,
        "event_type": event_type,
        "timestamp": _utc_now(),
        "dataset_id": str(dataset_id or payload.get("dataset_id") or ""),
        "source": source,
        "tags": list(tags or []),
        "payload": payload,
        "schema_version": 1,
        "siem_export_ready": True,
    }

    with _LOCK:
        _write_jsonl(TIMELINE_FILE, record)
        _write_jsonl(_CATEGORY_FILES[category_key], record)

    return record


def _iter_file(path: Path) -> Iterable[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            rows: list[dict[str, Any]] = []
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict):
                    rows.append(payload)
            return rows
    except OSError:
        return []


def replay_timeline(
    *,
    categories: list[str] | None = None,
    dataset_id: str | None = None,
    after_event_id: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    category_filter = {c.strip().lower() for c in (categories or []) if c}
    selected_dataset = str(dataset_id or "").strip().lower()
    if is_fusion_dataset(dataset_id):
        selected_dataset = FUSION_DATASET.lower()

    events: list[dict[str, Any]] = []
    after_seen = after_event_id in (None, "")
    for record in _iter_file(TIMELINE_FILE):
        if not after_seen:
            if record.get("event_id") == after_event_id:
                after_seen = True
            continue
        if category_filter and str(record.get("category") or "").lower() not in category_filter:
            continue
        if selected_dataset:
            record_dataset = str(record.get("dataset_id") or "").strip().lower()
            if record_dataset != selected_dataset:
                continue
        events.append(record)

    if limit > 0:
        return events[-limit:]
    return events


def tail_category_payloads(
    category: str,
    *,
    dataset_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    events = replay_timeline(categories=[category], dataset_id=dataset_id, limit=limit)
    return [dict(event.get("payload") or {}) for event in events if isinstance(event.get("payload"), dict)]


def build_analytics(
    *,
    categories: list[str] | None = None,
    dataset_id: str | None = None,
    limit: int = 1000,
) -> dict[str, Any]:
    events = replay_timeline(categories=categories, dataset_id=dataset_id, limit=limit)
    by_category: Counter[str] = Counter()
    by_event_type: Counter[str] = Counter()
    by_dataset: Counter[str] = Counter()
    by_severity: Counter[str] = Counter()

    for event in events:
        by_category[str(event.get("category") or "unknown")] += 1
        by_event_type[str(event.get("event_type") or "unknown")] += 1
        by_dataset[str(event.get("dataset_id") or "unknown")] += 1
        payload = event.get("payload") or {}
        if isinstance(payload, dict):
            severity = str(payload.get("severity") or payload.get("confidence_label") or payload.get("status") or "").upper()
            if severity:
                by_severity[severity] += 1

    return {
        "available": True,
        "count": len(events),
        "categories": dict(by_category),
        "event_types": dict(by_event_type),
        "datasets": dict(by_dataset),
        "severity": dict(by_severity),
        "siem_export_ready": True,
        "schema_version": 1,
    }
