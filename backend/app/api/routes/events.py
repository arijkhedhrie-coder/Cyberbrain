from __future__ import annotations

from typing import Any, List

from fastapi import APIRouter, Query

from app.core.event_store import build_analytics, replay_timeline
from app.core.event_fusion import (
    fusion_risk_score,
    fusion_summary,
    fusion_timeline,
    fusion_top_attackers,
)
from app.core.siem_export import (
    export_elastic_events,
    export_json_events,
    export_splunk_events,
)

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("/timeline")
def api_event_timeline(
    categories: List[str] = Query(default=[]),
    dataset: str | None = Query(default=None),
    after_event_id: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
) -> dict[str, Any]:
    events = replay_timeline(
        categories=categories,
        dataset_id=dataset,
        after_event_id=after_event_id,
        limit=limit,
    )
    return {
        "count": len(events),
        "events": events,
        "after_event_id": after_event_id,
        "siem_export_ready": True,
    }


@router.get("/analytics")
def api_event_analytics(
    categories: List[str] = Query(default=[]),
    dataset: str | None = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=5000),
) -> dict[str, Any]:
    return build_analytics(categories=categories, dataset_id=dataset, limit=limit)


@router.get("/export/json")
def api_event_export_json(
    categories: List[str] = Query(default=[]),
    dataset: str | None = Query(default=None),
    after_event_id: str | None = Query(default=None),
    limit: int = Query(default=0, ge=0, le=10000),
) -> dict[str, Any]:
    return export_json_events(
        categories=categories or None,
        dataset_id=dataset,
        after_event_id=after_event_id,
        limit=limit,
    )


@router.get("/export/elastic")
def api_event_export_elastic(
    categories: List[str] = Query(default=[]),
    dataset: str | None = Query(default=None),
    after_event_id: str | None = Query(default=None),
    limit: int = Query(default=0, ge=0, le=10000),
    index_prefix: str = Query(default="idps-events"),
) -> dict[str, Any]:
    return export_elastic_events(
        categories=categories or None,
        dataset_id=dataset,
        after_event_id=after_event_id,
        limit=limit,
        index_prefix=index_prefix,
    )


@router.get("/export/splunk")
def api_event_export_splunk(
    categories: List[str] = Query(default=[]),
    dataset: str | None = Query(default=None),
    after_event_id: str | None = Query(default=None),
    limit: int = Query(default=0, ge=0, le=10000),
    source: str = Query(default="event_store"),
    sourcetype_prefix: str = Query(default="idps:event"),
) -> dict[str, Any]:
    return export_splunk_events(
        categories=categories or None,
        dataset_id=dataset,
        after_event_id=after_event_id,
        limit=limit,
        default_source=source,
        sourcetype_prefix=sourcetype_prefix,
    )


@router.get("/fusion/summary")
def api_event_fusion_summary(
    dataset: str | None = Query(default=None),
    limit: int = Query(default=0, ge=0, le=20000),
) -> dict[str, Any]:
    return fusion_summary(dataset_id=dataset, limit=limit)


@router.get("/fusion/timeline")
def api_event_fusion_timeline(
    dataset: str | None = Query(default=None),
    limit: int = Query(default=0, ge=0, le=20000),
) -> dict[str, Any]:
    timeline = fusion_timeline(dataset_id=dataset, limit=limit)
    return {
        "available": bool(timeline),
        "count": len(timeline),
        "timeline": timeline,
        "generated_from": "event_store",
        "dataset_id": dataset,
    }


@router.get("/fusion/top-attackers")
def api_event_fusion_top_attackers(
    dataset: str | None = Query(default=None),
    limit: int = Query(default=0, ge=0, le=20000),
    top_n: int = Query(default=10, ge=1, le=100),
) -> dict[str, Any]:
    attackers = fusion_top_attackers(dataset_id=dataset, limit=limit, top_n=top_n)
    return {
        "available": bool(attackers),
        "count": len(attackers),
        "attackers": attackers,
        "generated_from": "event_store",
        "dataset_id": dataset,
    }


@router.get("/fusion/risk-score")
def api_event_fusion_risk_score(
    dataset: str | None = Query(default=None),
    limit: int = Query(default=0, ge=0, le=20000),
) -> dict[str, Any]:
    points = fusion_risk_score(dataset_id=dataset, limit=limit)
    return {
        "available": bool(points),
        "count": len(points),
        "points": points,
        "generated_from": "event_store",
        "dataset_id": dataset,
    }
