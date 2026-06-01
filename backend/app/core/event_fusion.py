from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import re
from typing import Any

from app.core.event_store import replay_timeline
from app.core.fusion_view import is_fusion_dataset

_INVALID_IPS = {"", "N/A", "NONE", "NAN", "MULTIPLE", "SYSTEM", "GLOBAL", "UNKNOWN"}
_SEVERITY_SCORES = {
    "CRITICAL": 100.0,
    "CRITIQUE": 100.0,
    "HIGH": 75.0,
    "AVERTISSEMENT": 75.0,
    "MED": 45.0,
    "MEDIUM": 45.0,
    "LOW": 20.0,
    "INFO": 10.0,
}
_STAGE_RANK = {
    "final": 3,
    "fusion": 2,
    "pass2": 2,
    "pass1": 1,
}
_ATTACK_CATEGORIES = ["alerts", "trust", "corrective", "fusion"]
_CLUSTER_WINDOW_MINUTES = 15
_RECURRENCE_GAP_MINUTES = 60


@dataclass(frozen=True)
class AttackEvent:
    logical_id: str
    event_id: str
    timestamp: datetime
    category: str
    event_type: str
    dataset_id: str
    ip: str
    engine: str
    behavior_key: str
    behavior_label: str
    severity: str
    severity_score: float
    score: float
    stage: str
    message: str


@dataclass(frozen=True)
class SupportEvent:
    logical_id: str
    event_id: str
    timestamp: datetime
    category: str
    event_type: str
    dataset_id: str


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_text(value: Any) -> str:
    text = str(value or "").strip().upper()
    if not text:
        return ""
    text = re.sub(r"[^A-Z0-9]+", "_", text)
    return re.sub(r"_+", "_", text).strip("_")


def _severity_label(payload: dict[str, Any]) -> str:
    return str(payload.get("severity") or payload.get("severite") or "INFO").upper()


def _severity_score(payload: dict[str, Any]) -> float:
    return _SEVERITY_SCORES.get(_severity_label(payload), 0.0)


def _event_score(payload: dict[str, Any]) -> float:
    return max(
        _as_float(payload.get("score"), 0.0),
        _as_float(payload.get("score_final"), 0.0),
    )


def _parse_iso(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _parse_record_timestamp(record: dict[str, Any]) -> datetime | None:
    payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
    payload_timestamp = str(payload.get("timestamp") or "").strip()
    record_timestamp = _parse_iso(record.get("timestamp"))

    if payload_timestamp:
        payload_iso = _parse_iso(payload_timestamp)
        if payload_iso is not None:
            return payload_iso

        if record_timestamp is not None:
            try:
                time_bits = [int(part) for part in payload_timestamp.split(":")]
            except ValueError:
                time_bits = []
            if len(time_bits) in {2, 3}:
                hours, minutes = time_bits[0], time_bits[1]
                seconds = time_bits[2] if len(time_bits) == 3 else 0
                return record_timestamp.replace(
                    hour=hours,
                    minute=minutes,
                    second=seconds,
                    microsecond=0,
                )

    return record_timestamp


def _logical_time_token(record: dict[str, Any]) -> str:
    payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
    payload_timestamp = str(payload.get("timestamp") or "").strip()
    if payload_timestamp:
        return payload_timestamp
    parsed = _parse_record_timestamp(record)
    return parsed.isoformat() if parsed is not None else str(record.get("timestamp") or "")


def _extract_ip(payload: dict[str, Any]) -> str:
    candidate = str(
        payload.get("source_ip")
        or payload.get("ip")
        or payload.get("IP_Source")
        or ""
    ).strip()
    if candidate.upper() in _INVALID_IPS:
        return ""
    return candidate


def _extract_stage(record: dict[str, Any], payload: dict[str, Any]) -> str:
    stage = str(payload.get("stage") or "").strip().lower()
    if stage:
        return stage
    event_type = str(record.get("event_type") or "").upper()
    if event_type.endswith("_FINAL"):
        return "final"
    if event_type.endswith("_PASS1"):
        return "pass1"
    if event_type.endswith("_PASS2"):
        return "pass2"
    return ""


def _extract_engine(record: dict[str, Any], payload: dict[str, Any]) -> str:
    engine = _normalize_text(payload.get("engine") or payload.get("domain"))
    if engine:
        return engine
    event_type = _normalize_text(record.get("event_type"))
    if event_type.startswith("ALERT_"):
        return "ALERT"
    return event_type or "UNKNOWN"


def _extract_behavior_label(record: dict[str, Any], payload: dict[str, Any]) -> str:
    label = _normalize_text(
        payload.get("type")
        or payload.get("event_type")
        or payload.get("message")
        or record.get("event_type")
    )
    return label or "UNKNOWN"


def _alert_logical_key(record: dict[str, Any]) -> str:
    payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
    dataset_id = str(record.get("dataset_id") or payload.get("dataset_id") or "")
    ip = _extract_ip(payload)
    engine = _extract_engine(record, payload)
    behavior = _extract_behavior_label(record, payload)
    message = _normalize_text(payload.get("message"))[:80]
    time_token = _logical_time_token(record)
    return "|".join([dataset_id, ip, engine, behavior, message, time_token])


def _support_logical_key(record: dict[str, Any]) -> str:
    payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
    dataset_id = str(record.get("dataset_id") or payload.get("dataset_id") or "")
    time_token = _logical_time_token(record)
    return "|".join([
        str(record.get("category") or ""),
        str(record.get("event_type") or ""),
        dataset_id,
        time_token,
        _normalize_text(payload.get("title") or payload.get("message") or ""),
    ])


def _alert_sort_key(record: dict[str, Any]) -> tuple[int, float, float]:
    payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
    stage = _extract_stage(record, payload)
    ts = _parse_record_timestamp(record)
    return (
        _STAGE_RANK.get(stage, 0),
        max(_event_score(payload), _severity_score(payload)),
        ts.timestamp() if ts is not None else 0.0,
    )


def _normalize_alerts(records: list[dict[str, Any]]) -> tuple[list[AttackEvent], int, int]:
    by_logical_key: dict[str, dict[str, Any]] = {}
    ignored_without_ip = 0
    duplicate_count = 0

    for record in records:
        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
        ip = _extract_ip(payload)
        if not ip:
            ignored_without_ip += 1
            continue
        if _parse_record_timestamp(record) is None:
            continue

        logical_key = _alert_logical_key(record)
        current = by_logical_key.get(logical_key)
        if current is None:
            by_logical_key[logical_key] = record
            continue
        duplicate_count += 1
        if _alert_sort_key(record) > _alert_sort_key(current):
            by_logical_key[logical_key] = record

    normalized: list[AttackEvent] = []
    for logical_key, record in by_logical_key.items():
        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
        timestamp = _parse_record_timestamp(record)
        if timestamp is None:
            continue
        engine = _extract_engine(record, payload)
        behavior_label = _extract_behavior_label(record, payload)
        normalized.append(
            AttackEvent(
                logical_id=logical_key,
                event_id=str(record.get("event_id") or ""),
                timestamp=timestamp,
                category=str(record.get("category") or ""),
                event_type=str(record.get("event_type") or ""),
                dataset_id=str(record.get("dataset_id") or payload.get("dataset_id") or ""),
                ip=_extract_ip(payload),
                engine=engine,
                behavior_key=f"{engine}|{behavior_label}",
                behavior_label=behavior_label,
                severity=_severity_label(payload),
                severity_score=_severity_score(payload),
                score=_event_score(payload),
                stage=_extract_stage(record, payload),
                message=str(payload.get("message") or ""),
            )
        )

    normalized.sort(key=lambda item: (item.timestamp, item.ip, item.behavior_key, item.dataset_id))
    return normalized, ignored_without_ip, duplicate_count


def _normalize_support(records: list[dict[str, Any]]) -> list[SupportEvent]:
    deduped: dict[str, SupportEvent] = {}
    for record in records:
        timestamp = _parse_record_timestamp(record)
        if timestamp is None:
            continue
        logical_key = _support_logical_key(record)
        existing = deduped.get(logical_key)
        candidate = SupportEvent(
            logical_id=logical_key,
            event_id=str(record.get("event_id") or ""),
            timestamp=timestamp,
            category=str(record.get("category") or ""),
            event_type=str(record.get("event_type") or ""),
            dataset_id=str(record.get("dataset_id") or ""),
        )
        if existing is None or candidate.timestamp > existing.timestamp:
            deduped[logical_key] = candidate
    return sorted(deduped.values(), key=lambda item: (item.timestamp, item.category, item.event_type))


def _replayed_events(*, dataset_id: str | None = None, limit: int = 0) -> list[dict[str, Any]]:
    selected_dataset = None if is_fusion_dataset(dataset_id) else (dataset_id or None)
    return replay_timeline(categories=_ATTACK_CATEGORIES, dataset_id=selected_dataset, limit=limit)


def _split_records(records: list[dict[str, Any]]) -> tuple[list[AttackEvent], list[SupportEvent], dict[str, Any]]:
    raw_alerts = [record for record in records if str(record.get("category") or "").lower() == "alerts"]
    raw_support = [record for record in records if str(record.get("category") or "").lower() != "alerts"]
    alerts, ignored_without_ip, duplicate_count = _normalize_alerts(raw_alerts)
    support = _normalize_support(raw_support)
    return alerts, support, {
        "ignored_alerts_without_ip": ignored_without_ip,
        "deduped_duplicate_alerts": duplicate_count,
        "replayed_event_count": len(records),
    }


def _health_weight(payload: dict[str, Any]) -> float:
    return max(
        _as_float(payload.get("row_count"), 0.0) or 0.0,
        _as_float(payload.get("deduped_count"), 0.0) or 0.0,
        _as_float(payload.get("nb_alarms"), 0.0) or 0.0,
        1.0,
    )


def _aggregate_health_score(records: list[dict[str, Any]]) -> float | None:
    latest_by_dataset: dict[str, tuple[datetime, float, float]] = {}

    for record in records:
        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
        health_score = _as_float(payload.get("health_score"))
        if health_score is None:
            continue

        dataset_id = str(record.get("dataset_id") or payload.get("dataset_id") or "").strip()
        if not dataset_id:
            continue

        timestamp = _parse_iso(record.get("timestamp")) or datetime.min.replace(tzinfo=UTC)
        weight = _health_weight(payload)
        current = latest_by_dataset.get(dataset_id)
        if current is None or timestamp >= current[0]:
            latest_by_dataset[dataset_id] = (timestamp, health_score, weight)

    if not latest_by_dataset:
        return None

    total_weight = sum(weight for _, _, weight in latest_by_dataset.values()) or float(len(latest_by_dataset))
    weighted_health = sum(score * weight for _, score, weight in latest_by_dataset.values()) / total_weight
    return round(weighted_health, 2)


def _group_behavior_episodes(
    events: list[AttackEvent],
    *,
    gap_minutes: int,
) -> dict[str, list[list[AttackEvent]]]:
    grouped: dict[str, list[list[AttackEvent]]] = {}
    gap = timedelta(minutes=gap_minutes)
    by_behavior: dict[str, list[AttackEvent]] = defaultdict(list)

    for event in events:
        by_behavior[event.behavior_key].append(event)

    for behavior_key, items in by_behavior.items():
        ordered = sorted(items, key=lambda item: item.timestamp)
        episodes: list[list[AttackEvent]] = []
        current: list[AttackEvent] = []
        for event in ordered:
            if not current:
                current = [event]
                continue
            if event.timestamp - current[-1].timestamp <= gap:
                current.append(event)
                continue
            episodes.append(current)
            current = [event]
        if current:
            episodes.append(current)
        grouped[behavior_key] = episodes

    return grouped


def _attacker_risk_score(
    events: list[AttackEvent],
    *,
    recurrence_bonus: float,
    dataset_bonus: float,
    correlation_bonus: float,
) -> float:
    if not events:
        return 0.0
    base = sum(max(event.severity_score, event.score) for event in events) / len(events)
    return round(min(100.0, base + recurrence_bonus + dataset_bonus + correlation_bonus), 2)


def fusion_top_attackers(
    *,
    dataset_id: str | None = None,
    limit: int = 0,
    top_n: int = 10,
    recurrence_gap_minutes: int = _RECURRENCE_GAP_MINUTES,
) -> list[dict[str, Any]]:
    records = _replayed_events(dataset_id=dataset_id, limit=limit)
    alerts, _, _ = _split_records(records)
    by_ip: dict[str, list[AttackEvent]] = defaultdict(list)
    for event in alerts:
        by_ip[event.ip].append(event)

    attackers: list[dict[str, Any]] = []
    for ip, events in by_ip.items():
        ordered = sorted(events, key=lambda item: item.timestamp)
        datasets = sorted({event.dataset_id for event in ordered if event.dataset_id})
        engines = sorted({event.engine for event in ordered})
        behavior_episodes = _group_behavior_episodes(ordered, gap_minutes=recurrence_gap_minutes)
        correlated_groups = {
            behavior: episodes
            for behavior, episodes in behavior_episodes.items()
            if sum(len(episode) for episode in episodes) >= 2
        }
        recurrence_windows = sum(max(0, len(episodes) - 1) for episodes in behavior_episodes.values())
        correlated_event_count = sum(sum(len(episode) for episode in episodes) for episodes in correlated_groups.values())
        dataset_bonus = min(15.0, max(0, len(datasets) - 1) * 5.0)
        recurrence_bonus = min(15.0, recurrence_windows * 5.0)
        correlation_bonus = min(10.0, len(correlated_groups) * 5.0)

        attackers.append({
            "ip": ip,
            "event_count": len(ordered),
            "dataset_count": len(datasets),
            "datasets": datasets,
            "engines": engines,
            "behavior_count": len(behavior_episodes),
            "behaviors": sorted(behavior_episodes.keys()),
            "correlated_event_count": correlated_event_count,
            "correlated_behaviors": [
                {
                    "behavior": behavior,
                    "event_count": sum(len(episode) for episode in episodes),
                    "episode_count": len(episodes),
                    "datasets": sorted({
                        item.dataset_id
                        for episode in episodes
                        for item in episode
                        if item.dataset_id
                    }),
                }
                for behavior, episodes in sorted(correlated_groups.items())
            ],
            "recurrence_count": recurrence_windows,
            "first_seen": ordered[0].timestamp.isoformat(),
            "last_seen": ordered[-1].timestamp.isoformat(),
            "max_severity": max((event.severity for event in ordered), key=lambda label: _SEVERITY_SCORES.get(label, 0.0)),
            "avg_score": round(sum(max(event.severity_score, event.score) for event in ordered) / len(ordered), 2),
            "risk_score": _attacker_risk_score(
                ordered,
                recurrence_bonus=recurrence_bonus,
                dataset_bonus=dataset_bonus,
                correlation_bonus=correlation_bonus,
            ),
            "evidence_event_ids": [event.event_id for event in ordered if event.event_id][:10],
        })

    attackers.sort(key=lambda item: (-item["risk_score"], -item["event_count"], item["ip"]))
    if top_n > 0:
        return attackers[:top_n]
    return attackers


def _cluster_risk_score(events: list[AttackEvent]) -> float:
    if not events:
        return 0.0
    base = sum(max(event.severity_score, event.score) for event in events) / len(events)
    dataset_bonus = min(15.0, max(0, len({event.dataset_id for event in events if event.dataset_id}) - 1) * 5.0)
    repeated_behavior_ips = 0
    for ip in {event.ip for event in events}:
        behaviors = Counter(event.behavior_key for event in events if event.ip == ip)
        if any(count >= 2 for count in behaviors.values()):
            repeated_behavior_ips += 1
    recurrence_bonus = min(10.0, repeated_behavior_ips * 5.0)
    return round(min(100.0, base + dataset_bonus + recurrence_bonus), 2)


def fusion_timeline(
    *,
    dataset_id: str | None = None,
    limit: int = 0,
    cluster_window_minutes: int = _CLUSTER_WINDOW_MINUTES,
) -> list[dict[str, Any]]:
    records = _replayed_events(dataset_id=dataset_id, limit=limit)
    alerts, support, _ = _split_records(records)
    if not alerts:
        return []

    window = timedelta(minutes=cluster_window_minutes)
    clusters: list[list[AttackEvent]] = []
    current: list[AttackEvent] = []

    for event in alerts:
        if not current:
            current = [event]
            continue
        if event.timestamp - current[-1].timestamp <= window:
            current.append(event)
            continue
        clusters.append(current)
        current = [event]
    if current:
        clusters.append(current)

    timeline: list[dict[str, Any]] = []
    for index, cluster in enumerate(clusters, start=1):
        start = cluster[0].timestamp
        end = cluster[-1].timestamp
        support_window_end = end + window
        support_counts: Counter[str] = Counter(
            item.category
            for item in support
            if start <= item.timestamp <= support_window_end
        )
        dominant_behaviors = Counter(event.behavior_key for event in cluster).most_common(5)
        timeline.append({
            "cluster_id": f"cluster-{index:04d}",
            "window_start": start.isoformat(),
            "window_end": end.isoformat(),
            "event_count": len(cluster),
            "attacker_count": len({event.ip for event in cluster}),
            "dataset_count": len({event.dataset_id for event in cluster if event.dataset_id}),
            "attackers": sorted({event.ip for event in cluster}),
            "dominant_behaviors": [
                {"behavior": behavior, "event_count": count}
                for behavior, count in dominant_behaviors
            ],
            "risk_score": _cluster_risk_score(cluster),
            "supporting_event_counts": dict(support_counts),
            "evidence_event_ids": [event.event_id for event in cluster if event.event_id][:20],
        })

    return timeline


def fusion_risk_score(
    *,
    dataset_id: str | None = None,
    limit: int = 0,
    cluster_window_minutes: int = _CLUSTER_WINDOW_MINUTES,
) -> list[dict[str, Any]]:
    timeline = fusion_timeline(
        dataset_id=dataset_id,
        limit=limit,
        cluster_window_minutes=cluster_window_minutes,
    )
    return [
        {
            "timestamp": cluster["window_end"],
            "window_start": cluster["window_start"],
            "window_end": cluster["window_end"],
            "risk_score": cluster["risk_score"],
            "event_count": cluster["event_count"],
            "attacker_count": cluster["attacker_count"],
            "dataset_count": cluster["dataset_count"],
        }
        for cluster in timeline
    ]


def fusion_summary(
    *,
    dataset_id: str | None = None,
    limit: int = 0,
    cluster_window_minutes: int = _CLUSTER_WINDOW_MINUTES,
    recurrence_gap_minutes: int = _RECURRENCE_GAP_MINUTES,
) -> dict[str, Any]:
    records = _replayed_events(dataset_id=dataset_id, limit=limit)
    alerts, support, stats = _split_records(records)
    attackers = fusion_top_attackers(
        dataset_id=dataset_id,
        limit=limit,
        top_n=10,
        recurrence_gap_minutes=recurrence_gap_minutes,
    )
    timeline = fusion_timeline(
        dataset_id=dataset_id,
        limit=limit,
        cluster_window_minutes=cluster_window_minutes,
    )
    risk_series = fusion_risk_score(
        dataset_id=dataset_id,
        limit=limit,
        cluster_window_minutes=cluster_window_minutes,
    )

    category_counts: Counter[str] = Counter(str(record.get("category") or "unknown") for record in records)
    time_points = [event.timestamp for event in alerts] + [event.timestamp for event in support]
    peak_risk = max((point["risk_score"] for point in risk_series), default=0.0)
    average_risk = round(
        sum(point["risk_score"] for point in risk_series) / len(risk_series),
        2,
    ) if risk_series else 0.0
    health_score = _aggregate_health_score(records)
    if health_score is None:
        health_score = 100.0
    health_status = "HEALTHY" if health_score >= 90 else ("WARNING" if health_score >= 70 else "CRITICAL")

    return {
        "available": bool(records),
        "generated_from": "event_store",
        "dataset_id": dataset_id,
        "replayed_categories": list(_ATTACK_CATEGORIES),
        "time_range": {
            "start": min(time_points).isoformat() if time_points else None,
            "end": max(time_points).isoformat() if time_points else None,
        },
        "source_events": {
            **stats,
            "deduped_alert_event_count": len(alerts),
            "support_event_count": len(support),
        },
        "categories": dict(category_counts),
        "attacker_count": len({event.ip for event in alerts}),
        "correlated_attacker_count": sum(1 for attacker in attackers if attacker["correlated_event_count"] > 0),
        "recurrent_attacker_count": sum(1 for attacker in attackers if attacker["recurrence_count"] > 0),
        "cluster_count": len(timeline),
        "current_risk_score": risk_series[-1]["risk_score"] if risk_series else 0.0,
        "peak_risk_score": peak_risk,
        "average_risk_score": average_risk,
        "health_score": health_score,
        "health_status": health_status,
        "top_attackers": attackers[:5],
    }
