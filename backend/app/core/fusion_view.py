from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any

FUSION_DATASET = "__fusion__"
FUSION_LABEL = "FUSION VIEW"
FUSION_ALIASES = {
    "",
    "fusion",
    "__fusion__",
    "merged",
    "__merged__",
}

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

_FUSION_MIN_DATASETS = 2
_FUSION_MIN_ALERTS = 3
_FUSION_MIN_SCORE = 70.0
_FUSION_MIN_SEVERITY = 75.0
_FUSION_WINDOW_MINUTES = 30
_FUSION_MIN_ENGINES = 2


def is_fusion_dataset(dataset: str | None) -> bool:
    value = str(dataset or "").strip().lower()
    return value in FUSION_ALIASES and value != ""


def normalize_dataset_query(dataset: str | None) -> str | None:
    if is_fusion_dataset(dataset):
        return FUSION_DATASET
    return dataset


def _as_float(value: Any, default: float | None = None) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _severity_label(alarm: dict[str, Any]) -> str:
    return str(alarm.get("severity") or alarm.get("severite") or "INFO").upper()


def _severity_score(alarm: dict[str, Any]) -> float:
    return _SEVERITY_SCORES.get(_severity_label(alarm), 0.0)


def _alarm_score(alarm: dict[str, Any]) -> float:
    return (
        _as_float(alarm.get("score"), 0.0)
        or _as_float(alarm.get("score_final"), 0.0)
        or 0.0
    )


def _alarm_ip(alarm: dict[str, Any]) -> str:
    ip = str(
        alarm.get("source_ip")
        or alarm.get("ip")
        or alarm.get("IP_Source")
        or ""
    ).strip()
    if ip.lower() in {"", "n/a", "none", "nan", "multiple", "system", "global"}:
        return ""
    return ip


def _alarm_engine(alarm: dict[str, Any]) -> str:
    return str(alarm.get("engine") or alarm.get("domain") or "UNKNOWN").upper()


def _alarm_type(alarm: dict[str, Any]) -> str:
    return str(alarm.get("type") or alarm.get("message") or "UNKNOWN").upper()


def _parse_alarm_timestamp(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _is_fusion_qualifying_alarm(alarm: dict[str, Any]) -> bool:
    return (
        _severity_score(alarm) >= _FUSION_MIN_SEVERITY
        and _alarm_score(alarm) >= _FUSION_MIN_SCORE
        and _parse_alarm_timestamp(alarm.get("timestamp")) is not None
    )


def _best_fusion_cluster(alarms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    qualified: list[tuple[datetime, dict[str, Any]]] = []
    for alarm in alarms:
        if not _is_fusion_qualifying_alarm(alarm):
            continue
        timestamp = _parse_alarm_timestamp(alarm.get("timestamp"))
        if timestamp is None:
            continue
        qualified.append((timestamp, alarm))

    if len(qualified) < _FUSION_MIN_ALERTS:
        return []

    qualified.sort(key=lambda item: item[0])
    best_window: list[tuple[datetime, dict[str, Any]]] = []
    left = 0
    window_limit = timedelta(minutes=_FUSION_WINDOW_MINUTES)

    for right, (right_ts, _) in enumerate(qualified):
        while right_ts - qualified[left][0] > window_limit:
            left += 1
        current = qualified[left:right + 1]
        if len(current) > len(best_window):
            best_window = current

    return [alarm for _, alarm in best_window]


def _sort_alarm_key(alarm: dict[str, Any]) -> tuple[float, float]:
    return (_severity_score(alarm), _alarm_score(alarm))


def _build_cross_dataset_alarm(entry: dict[str, Any]) -> dict[str, Any]:
    dataset_count = int(entry["dataset_count"])
    total_alarm_count = int(entry["total_alarm_count"])
    severity = "CRITICAL" if dataset_count >= 3 or total_alarm_count >= 6 else "HIGH"
    score = min(99.0, round(55 + dataset_count * 10 + min(total_alarm_count, 10) * 2, 1))
    datasets = entry["datasets"]
    return {
        "timestamp": entry.get("latest_seen") or datetime.now().isoformat(),
        "type": "CROSS_DATASET_IP_CORRELATION",
        "ip": entry["ip"],
        "source_ip": entry["ip"],
        "severity": severity,
        "engine": "CORRELATION",
        "domain": "CORRELATION",
        "score": score,
        "message": (
            f"IP {entry['ip']} triggered {total_alarm_count} high-confidence alert(s) across "
            f"{dataset_count} datasets within {entry['window_minutes']}m: {', '.join(datasets)}"
        ),
        "human_insight": "Distributed pattern detected across isolated datasets in read-only fusion mode.",
        "action": "MONITOR",
        "country": "Unknown",
        "failures": total_alarm_count,
        "server_id": "GLOBAL",
        "dataset_id": FUSION_DATASET,
    }


def _build_fusion_activity(title: str, detail: str, severity: str, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "timestamp": datetime.now().isoformat(),
        "event_type": "FUSION_VIEW_ACTIVITY",
        "dashboard_activity": {
            "id": f"fusion-{title.lower().replace(' ', '-')}-{datetime.now().strftime('%H%M%S%f')}",
            "timestamp": datetime.now().isoformat(),
            "dataset_id": FUSION_DATASET,
            "stage": "fusion",
            "actor": "Global Detector",
            "title": title,
            "detail": detail,
            "status": "completed",
            "severity": severity,
            "meta": meta or {},
        },
    }


def _build_global_alert_ranking(alarms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranking: list[dict[str, Any]] = []
    for index, alarm in enumerate(sorted(alarms, key=_sort_alarm_key, reverse=True)[:25], start=1):
        ranking.append({
            "rank": index,
            "dataset_id": str(alarm.get("dataset_id") or ""),
            "ip": _alarm_ip(alarm),
            "type": str(alarm.get("type") or alarm.get("message") or "UNKNOWN"),
            "severity": _severity_label(alarm),
            "score": round(_alarm_score(alarm), 2),
            "engine": _alarm_engine(alarm),
            "message": str(alarm.get("message") or ""),
        })
    return ranking


def _build_minimization_series(dataset_results: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"alarmes": 0.0, "risque": 0.0, "count": 0.0})
    for payload in dataset_results.values():
        for point in payload.get("minimization", []):
            timestamp = str(point.get("timestamp") or "")
            if not timestamp:
                continue
            bucket = buckets[timestamp]
            bucket["alarmes"] += _as_float(point.get("alarmes"), 0.0) or 0.0
            bucket["risque"] += _as_float(point.get("risque"), 0.0) or 0.0
            bucket["count"] += 1.0
    series: list[dict[str, Any]] = []
    for timestamp in sorted(buckets.keys())[-20:]:
        bucket = buckets[timestamp]
        count = max(bucket["count"], 1.0)
        series.append({
            "timestamp": timestamp,
            "alarmes": int(round(bucket["alarmes"])),
            "risque": round(bucket["risque"] / count, 1),
        })
    return series


def build_fusion_payload(dataset_results: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if not dataset_results:
        return {}

    datasets = sorted(dataset_results.keys())
    alarms: list[dict[str, Any]] = []
    decisions: list[dict[str, Any]] = []
    sessions: list[dict[str, Any]] = []
    log_lines: list[str] = []
    data_sources: set[str] = set()
    row_count = 0
    deduped_count = 0
    noise_values: list[float] = []
    health_values: list[float] = []
    drift_scores: list[float] = []
    trust_scores: list[float] = []
    prediction_flags: set[str] = set()
    prediction_score = 0
    global_engine_counts: Counter[str] = Counter()
    ip_map: dict[str, dict[str, Any]] = {}

    for dataset_id, payload in dataset_results.items():
        for alarm in payload.get("alarms", []) or payload.get("alarmes", []) or []:
            if not isinstance(alarm, dict):
                continue
            copied = dict(alarm)
            copied.setdefault("dataset_id", dataset_id)
            copied.setdefault("server_id", dataset_id)
            alarms.append(copied)
            global_engine_counts[_alarm_engine(copied)] += 1

            ip = _alarm_ip(copied)
            if ip:
                entry = ip_map.setdefault(ip, {
                    "ip": ip,
                    "alarms": [],
                })
                entry["alarms"].append(copied)

        for decision in payload.get("decisions", [])[-5:]:
            if isinstance(decision, dict):
                copied = dict(decision)
                copied.setdefault("dataset_id", dataset_id)
                decisions.append(copied)

        for session in payload.get("sessions", [])[-5:]:
            if isinstance(session, dict):
                copied = dict(session)
                copied.setdefault("dataset_id", dataset_id)
                sessions.append(copied)

        log_lines.extend(payload.get("log_lines", [])[-10:])

        row_count += int(payload.get("kpis", {}).get("row_count", 0) or 0)
        deduped_count += int(payload.get("kpis", {}).get("deduped_count", 0) or 0)

        noise_ratio = _as_float(payload.get("kpis", {}).get("noise_ratio"))
        if noise_ratio is not None:
            noise_values.append(noise_ratio)

        health_score = _as_float(payload.get("kpis", {}).get("health_score"))
        if health_score is not None:
            health_values.append(health_score)

        drift_score = _as_float(payload.get("trust", {}).get("drift_score"))
        if drift_score is not None:
            drift_scores.append(drift_score)

        trust_score = _as_float(payload.get("trust", {}).get("confidence_in_metrics"))
        if trust_score is not None:
            trust_scores.append(trust_score)

        data_sources.update(str(src) for src in payload.get("data_sources", []) if src)

        prediction = payload.get("prediction", {}) or {}
        prediction_score = max(prediction_score, int(prediction.get("prediction_score", 0) or 0))
        prediction_flags.update(str(flag) for flag in prediction.get("flags", []) if flag)

    cross_dataset_ip_correlation: list[dict[str, Any]] = []
    for entry in ip_map.values():
        cluster = _best_fusion_cluster(entry["alarms"])
        if len(cluster) < _FUSION_MIN_ALERTS:
            continue
        datasets_hit = sorted({
            str(alarm.get("dataset_id") or "")
            for alarm in cluster
            if str(alarm.get("dataset_id") or "")
        })
        if len(datasets_hit) < _FUSION_MIN_DATASETS:
            continue
        engines_hit = sorted({_alarm_engine(alarm) for alarm in cluster})
        types_hit = sorted({_alarm_type(alarm) for alarm in cluster})
        if len(engines_hit) < _FUSION_MIN_ENGINES and len(types_hit) < _FUSION_MIN_ENGINES:
            continue
        max_score = max((_alarm_score(alarm) for alarm in cluster), default=0.0)
        if max_score < _FUSION_MIN_SCORE:
            continue
        timestamps = [
            ts
            for alarm in cluster
            if (ts := _parse_alarm_timestamp(alarm.get("timestamp"))) is not None
        ]
        if not timestamps:
            continue
        earliest_seen = min(timestamps).isoformat()
        latest_seen = max(timestamps).isoformat()
        cross_dataset_ip_correlation.append({
            "ip": entry["ip"],
            "datasets": datasets_hit,
            "dataset_count": len(datasets_hit),
            "engines": engines_hit,
            "types": types_hit,
            "total_alarm_count": len(cluster),
            "observed_alarm_count": len(entry["alarms"]),
            "max_score": round(max_score, 2),
            "latest_seen": latest_seen,
            "earliest_seen": earliest_seen,
            "window_minutes": _FUSION_WINDOW_MINUTES,
            "criteria": {
                "min_datasets": _FUSION_MIN_DATASETS,
                "min_alerts": _FUSION_MIN_ALERTS,
                "min_score": _FUSION_MIN_SCORE,
                "min_severity": "HIGH",
                "min_engine_or_type_diversity": _FUSION_MIN_ENGINES,
                "time_window_minutes": _FUSION_WINDOW_MINUTES,
            },
        })

    cross_dataset_ip_correlation.sort(
        key=lambda item: (
            int(item["dataset_count"]),
            int(item["total_alarm_count"]),
            float(item["max_score"]),
        ),
        reverse=True,
    )

    correlation_alarms = [
        _build_cross_dataset_alarm(entry)
        for entry in cross_dataset_ip_correlation[:10]
    ]

    ranked_local_alarms = sorted(alarms, key=_sort_alarm_key, reverse=True)
    ranked_alarms = correlation_alarms + ranked_local_alarms[:50]
    global_alert_ranking = _build_global_alert_ranking(correlation_alarms + ranked_local_alarms)

    total_alarm_count = len(alarms)
    severity_average = (
        sum(_severity_score(alarm) for alarm in alarms) / total_alarm_count
        if total_alarm_count
        else 0.0
    )
    global_risk_score = round(min(100.0, severity_average), 1)
    average_health = round(sum(health_values) / len(health_values), 2) if health_values else round(max(0.0, 100.0 - global_risk_score), 2)
    average_noise = round(sum(noise_values) / len(noise_values), 3) if noise_values else None
    average_drift = round(sum(drift_scores) / len(drift_scores), 3) if drift_scores else None
    average_trust = round(sum(trust_scores) / len(trust_scores), 3) if trust_scores else None
    health_status = "HEALTHY" if average_health >= 90 else ("WARNING" if average_health >= 70 else "CRITICAL")

    global_detector_flags = [
        {
            "ip": entry["ip"],
            "dataset_count": entry["dataset_count"],
            "datasets": entry["datasets"],
            "reason": f"Distributed activity detected across {entry['dataset_count']} datasets.",
            "severity": "CRITICAL" if int(entry["dataset_count"]) >= 3 else "HIGH",
        }
        for entry in cross_dataset_ip_correlation[:10]
    ]

    events = [
        _build_fusion_activity(
            title="Fusion overlay ready",
            detail=f"Read-only aggregation built from {len(datasets)} dataset(s).",
            severity="INFO",
            meta={"datasets": datasets, "analysis_only": True},
        )
    ]
    for flag in global_detector_flags[:5]:
        events.append(_build_fusion_activity(
            title="Cross-dataset detector flagged an IP",
            detail=f"{flag['ip']} appears in {flag['dataset_count']} datasets: {', '.join(flag['datasets'])}",
            severity=flag["severity"],
            meta=flag,
        ))

    if not cross_dataset_ip_correlation:
        events.append(_build_fusion_activity(
            title="No distributed IP overlap detected",
            detail="The fusion layer found no high-confidence same-IP cluster across multiple datasets in the current run.",
            severity="INFO",
        ))

    minimization = _build_minimization_series(dataset_results)

    fusion_kpis = {
        "datasets_covered": len(datasets),
        "global_risk_score": global_risk_score,
        "average_drift_score": average_drift,
        "distributed_attack_ips": len(cross_dataset_ip_correlation),
        "ranked_alerts": len(global_alert_ranking),
    }

    return {
        "available": True,
        "analysis_only": True,
        "mode": "fusion",
        "dataset_id": FUSION_DATASET,
        "dataset_label": FUSION_LABEL,
        "datasets": datasets,
        "metrics": {
            "available": True,
            "missing_data": [],
            "health_score": average_health,
            "health_status": health_status,
            "ssh_failures": None,
            "blocked_ips": None,
            "alert_status": "FUSION_VIEW",
            "attack_pattern": "cross_dataset_overlay",
            "ip_entropy": None,
            "unique_attacking_ips": len(ip_map),
            "attack_velocity": round(total_alarm_count / max(len(datasets), 1), 2),
            "is_velocity_spike": len(cross_dataset_ip_correlation) > 0,
            "night_ratio": None,
            "row_count": row_count,
            "server_count": len(datasets),
            "data_sources": sorted(data_sources),
            "deduped_count": deduped_count,
            "noise_ratio": average_noise,
            "data_quality": "FUSION_READ_ONLY",
            "notes": {
                "mode": "FUSION_VIEW",
                "analysis_only": "true",
                "global_risk_score": str(global_risk_score),
                "average_drift_score": "" if average_drift is None else str(average_drift),
                "distributed_attack_ips": str(len(cross_dataset_ip_correlation)),
            },
            "nb_alarms": len(ranked_alarms),
        },
        "kpis": {
            "available": True,
            "missing_data": [],
            "health_score": average_health,
            "health_status": health_status,
            "ssh_failures": None,
            "blocked_ips": None,
            "alert_status": "FUSION_VIEW",
            "attack_pattern": "cross_dataset_overlay",
            "ip_entropy": None,
            "unique_attacking_ips": len(ip_map),
            "attack_velocity": round(total_alarm_count / max(len(datasets), 1), 2),
            "is_velocity_spike": len(cross_dataset_ip_correlation) > 0,
            "night_ratio": None,
            "row_count": row_count,
            "server_count": len(datasets),
            "data_sources": sorted(data_sources),
            "deduped_count": deduped_count,
            "noise_ratio": average_noise,
            "data_quality": "FUSION_READ_ONLY",
            "notes": {
                "mode": "FUSION_VIEW",
                "analysis_only": "true",
                "global_risk_score": str(global_risk_score),
                "average_drift_score": "" if average_drift is None else str(average_drift),
                "distributed_attack_ips": str(len(cross_dataset_ip_correlation)),
            },
            "nb_alarms": len(ranked_alarms),
        },
        "alarms": ranked_alarms,
        "alarmes": ranked_alarms,
        "trust": {
            "available": True,
            "model_agreement": None,
            "false_positive_rate": None,
            "drift_score": average_drift,
            "drift_label": "ELEVATED" if (average_drift or 0.0) >= 0.3 else "STABLE",
            "drift_flagged": bool((average_drift or 0.0) >= 0.3),
            "stability": "FUSION_READ_ONLY",
            "confidence_in_metrics": average_trust,
            "confidence_label": "FUSION ONLY",
            "signals_summary": (
                f"Read-only overlay across {len(datasets)} datasets. "
                f"{len(cross_dataset_ip_correlation)} cross-dataset IP correlation(s) detected."
            ),
        },
        "prediction": {
            "available": True,
            "prediction_score": prediction_score,
            "flags": sorted(prediction_flags),
            "predicted_events": [],
            "message": "Fusion mode aggregates predictions without changing local decisions.",
            "risk_evolution": [],
            "behavioral_analysis": {},
            "prevention_suggestions": [],
            "risk_level": "HIGH" if global_risk_score >= 70 else ("MEDIUM" if global_risk_score >= 40 else "LOW"),
            "signal_analysis": {},
            "explanations": [],
            "history": [],
            "dataset_id": FUSION_DATASET,
        },
        "engine_scores": [
            {
                "engine": engine,
                "alarms": count,
                "score": min(100, count * 5),
                "pass1": 0,
                "pass2": 0,
                "status": "ALARM" if count > 0 else "CLEAR",
                "rerun_p2": False,
            }
            for engine, count in sorted(global_engine_counts.items())
        ],
        "decisions": decisions[-20:],
        "sessions": sorted(sessions, key=lambda item: str(item.get("date") or ""), reverse=True)[:20],
        "log_lines": (
            [
                f"[{datetime.now().strftime('%H:%M:%S')}] FUSION VIEW ready - read-only overlay across {len(datasets)} datasets",
            ]
            + log_lines[-40:]
        )[-60:],
        "events": events[-60:],
        "memory": {
            "analysis_only": True,
            "datasets": datasets,
        },
        "memory_file": None,
        "data_quality": {
            "raw_rows": row_count,
            "dedup_rows": deduped_count,
            "noise_pct": average_noise,
            "ml_weight": None,
            "data_sources": sorted(data_sources),
        },
        "backtest_history": [],
        "server_ids": datasets,
        "data_sources": sorted(data_sources),
        "minimization": minimization,
        "fusion": {
            "analysis_only": True,
            "cross_dataset_ip_correlation": cross_dataset_ip_correlation[:25],
            "global_alert_ranking": global_alert_ranking,
            "global_detector_flags": global_detector_flags,
            "global_kpis": fusion_kpis,
        },
    }
