from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable

from app.core.event_store import replay_timeline

DEFAULT_EXPORT_CATEGORIES = ("alerts", "trust", "corrective", "fusion")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _selected_categories(categories: Iterable[str] | None) -> list[str]:
    values = [str(category).strip().lower() for category in (categories or []) if str(category).strip()]
    return values or list(DEFAULT_EXPORT_CATEGORIES)


def _parse_timestamp(timestamp: Any) -> datetime | None:
    raw = str(timestamp or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _epoch_seconds(timestamp: Any) -> float:
    parsed = _parse_timestamp(timestamp)
    if parsed is None:
        return 0.0
    return parsed.timestamp()


def _elastic_index_name(record: dict[str, Any], *, index_prefix: str) -> str:
    category = str(record.get("category") or "events").strip().lower() or "events"
    parsed = _parse_timestamp(record.get("timestamp"))
    date_part = parsed.strftime("%Y.%m.%d") if parsed is not None else "unknown"
    return f"{index_prefix}-{category}-{date_part}"


def load_export_events(
    *,
    categories: Iterable[str] | None = None,
    dataset_id: str | None = None,
    after_event_id: str | None = None,
    limit: int = 0,
) -> list[dict[str, Any]]:
    return [
        dict(event)
        for event in replay_timeline(
            categories=_selected_categories(categories),
            dataset_id=dataset_id,
            after_event_id=after_event_id,
            limit=limit,
        )
    ]


def export_json_events(
    *,
    categories: Iterable[str] | None = None,
    dataset_id: str | None = None,
    after_event_id: str | None = None,
    limit: int = 0,
) -> dict[str, Any]:
    selected = _selected_categories(categories)
    events = load_export_events(
        categories=selected,
        dataset_id=dataset_id,
        after_event_id=after_event_id,
        limit=limit,
    )
    return {
        "format": "json",
        "exported_at": _utc_now(),
        "count": len(events),
        "categories": selected,
        "dataset_id": dataset_id,
        "after_event_id": after_event_id,
        "events": events,
    }


def export_elastic_events(
    *,
    categories: Iterable[str] | None = None,
    dataset_id: str | None = None,
    after_event_id: str | None = None,
    limit: int = 0,
    index_prefix: str = "idps-events",
) -> dict[str, Any]:
    selected = _selected_categories(categories)
    events = load_export_events(
        categories=selected,
        dataset_id=dataset_id,
        after_event_id=after_event_id,
        limit=limit,
    )

    documents: list[dict[str, Any]] = []
    for record in events:
        index_name = _elastic_index_name(record, index_prefix=index_prefix)
        documents.append(
            {
                "_index": index_name,
                "index": index_name,
                "@timestamp": str(record.get("timestamp") or ""),
                "event_type": str(record.get("event_type") or ""),
                "event": {
                    "id": str(record.get("event_id") or ""),
                    "kind": "event",
                    "category": str(record.get("category") or ""),
                    "type": [str(record.get("event_type") or "")],
                },
                "dataset_id": str(record.get("dataset_id") or ""),
                "payload": dict(record.get("payload") or {}),
                "metadata": {
                    "source": str(record.get("source") or ""),
                    "tags": list(record.get("tags") or []),
                    "schema_version": record.get("schema_version"),
                    "siem_export_ready": bool(record.get("siem_export_ready", False)),
                },
            }
        )

    return {
        "format": "elastic",
        "exported_at": _utc_now(),
        "count": len(documents),
        "categories": selected,
        "dataset_id": dataset_id,
        "after_event_id": after_event_id,
        "documents": documents,
    }


def export_splunk_events(
    *,
    categories: Iterable[str] | None = None,
    dataset_id: str | None = None,
    after_event_id: str | None = None,
    limit: int = 0,
    default_source: str = "event_store",
    sourcetype_prefix: str = "idps:event",
) -> dict[str, Any]:
    selected = _selected_categories(categories)
    events = load_export_events(
        categories=selected,
        dataset_id=dataset_id,
        after_event_id=after_event_id,
        limit=limit,
    )

    records: list[dict[str, Any]] = []
    for record in events:
        category = str(record.get("category") or "events").strip().lower() or "events"
        records.append(
            {
                "time": _epoch_seconds(record.get("timestamp")),
                "source": str(record.get("source") or default_source),
                "sourcetype": f"{sourcetype_prefix}:{category}",
                "event": {
                    "event_id": str(record.get("event_id") or ""),
                    "category": category,
                    "event_type": str(record.get("event_type") or ""),
                    "timestamp": str(record.get("timestamp") or ""),
                    "dataset_id": str(record.get("dataset_id") or ""),
                    "payload": dict(record.get("payload") or {}),
                    "metadata": {
                        "tags": list(record.get("tags") or []),
                        "schema_version": record.get("schema_version"),
                        "siem_export_ready": bool(record.get("siem_export_ready", False)),
                    },
                },
            }
        )

    return {
        "format": "splunk",
        "exported_at": _utc_now(),
        "count": len(records),
        "categories": selected,
        "dataset_id": dataset_id,
        "after_event_id": after_event_id,
        "records": records,
    }
