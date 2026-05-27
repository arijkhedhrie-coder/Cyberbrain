"""
prediction_engine.py — Pre-attack forecasting from normalized logs
══════════════════════════════════════════════════════════════════════
Goal: convert evolving log patterns into a "prediction_score" and
pre-attack flags (BOTNET_WARMUP, SPRAY_PHASE, CRASH_COMING, DATA_EXFIL_START).

Input:  df_norm (standardized columns from src/adapter.py)
Output: dict:
  {
    "prediction_score": int,
    "signals": {...},
    "flags": [...],
    "predicted_events": [...]
  }
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd


SSH_FAILURE_REGEX = re.compile(
    r"(?:authentication failure|check pass|failed password|invalid user|login incorrect)",
    re.IGNORECASE,
)

FTP_TRANSFER_REGEX = re.compile(
    r"(?:STOR|RETR|upload|download|stor\s|retr\s|file\s+download|file\s+upload)",
    re.IGNORECASE,
)

# Keep FTP download/upload classification simple: use content keywords.
FTP_RETR_REGEX = re.compile(r"(?:RETR|download|file\s+download)", re.IGNORECASE)
FTP_STOR_REGEX = re.compile(r"(?:STOR|upload|file\s+upload)", re.IGNORECASE)

KERNEL_ERROR_REGEX = re.compile(
    r"(?:kernel panic|BUG:|Oops:|general protection fault|segfault|"
    r"Out of memory|oom-killer|Killed process|EXT4-fs error|I/O error|"
    r"blk_update_request: I/O error|panic|Call Trace)",
    re.IGNORECASE,
)

KERNEL_WARN_REGEX = re.compile(
    r"(?:\bWARN\b|\bWARNING\b|soft lockup|hard lockup|transmit timed out|watchdog)",
    re.IGNORECASE,
)


# Tunables (kept at top so thesis reviewers can justify them).
ALPHA_EWMA = 0.3
EPS = 1e-6

MIN_MINUTE_BUCKETS = 5
LAST_WINDOW_MINUTES = 3
PREV_WINDOW_MINUTES = 3
MIN_ACTIVITY_RATIO_FOR_FORECAST = 0.5

TREND_RATIO_RISING = 1.25
ACCEL_POSITIVE_MIN = 0.0
BURST_RATIO_STRONG = 2.0

BOTNET_MIN_UNIQUE_IPS = 5
BOTNET_LOW_FAILS_PER_IP = 2.0
BOTNET_FAILS_PER_MINUTE_MAX = 15

SPRAY_MIN_USERNAMES = 8
SPRAY_LOW_FAILS_PER_MINUTE_MAX = 20

CRASH_KERNEL_BURST_RATIO = 1.7
CRASH_MIN_KERNEL_TREND_RATIO = 1.25

EXFIL_MIN_FTP_BURST_RATIO = 1.8
EXFIL_MIN_RETR_SHARE = 0.6

SHORT_BURST_PEAK_SHARE = 0.6
SHORT_FAILURES_SEVERE = 12
SHORT_KERNEL_EVENTS_MIN = 2
SHORT_HIGH_SEVERITY_SHARE = 0.6


def _safe_astype_str(series: pd.Series) -> pd.Series:
    return series.fillna("").astype(str)


def _extract_username_safe(content: pd.Series) -> pd.Series:
    # Lazily import to avoid unnecessary import-time coupling.
    try:
        from app.ai.engines.ml_engine import extract_username
    except ImportError:
        from ml_engine import extract_username

    return _safe_astype_str(content).apply(lambda c: extract_username(c))


def _core_signals(s: pd.Series) -> dict[str, Any]:
    """
    Compute core EWMA trend, acceleration (second difference), and burst potential.
    """
    s = pd.to_numeric(s, errors="coerce").fillna(0.0).astype(float)

    ewma = s.ewm(alpha=ALPHA_EWMA, adjust=False).mean()
    ewma_tail_mean = float(ewma.tail(min(len(ewma), PREV_WINDOW_MINUTES)).mean()) if len(ewma) else 0.0

    last_val = float(s.iloc[-1]) if len(s) else 0.0
    trend_ratio = last_val / max(ewma_tail_mean, EPS)

    # Second derivative proxy: diff(diff(series)).
    if len(s) < 3:
        acceleration = 0.0
    else:
        d1 = s.diff()
        d2 = d1.diff()
        acceleration = float(d2.iloc[-1]) if len(d2) else 0.0

    baseline = float(s.median()) if len(s) else 0.0
    if baseline <= 0.0 and last_val <= 0.0:
        burst_ratio = 0.0
    else:
        burst_ratio = last_val / max(baseline, EPS)
    # Prevent extreme ratios from dominating purely due to baseline==0.
    burst_ratio = float(min(burst_ratio, 50.0))

    return {
        "last": last_val,
        "ewma_tail_mean": ewma_tail_mean,
        "trend_ratio": float(trend_ratio),
        "acceleration": float(acceleration),
        "baseline_median": baseline,
        "burst_ratio": float(burst_ratio),
    }


def _series_profile(s: pd.Series) -> dict[str, Any]:
    s = pd.to_numeric(s, errors="coerce").fillna(0.0).astype(float)
    total = float(s.sum()) if len(s) else 0.0
    active_mask = s > 0
    active_minutes = int(active_mask.sum()) if len(s) else 0
    minute_count = int(len(s))
    peak = float(s.max()) if len(s) else 0.0
    last = float(s.iloc[-1]) if len(s) else 0.0
    return {
        "total": total,
        "active_minutes": active_minutes,
        "minute_count": minute_count,
        "active_ratio": float(active_minutes / max(minute_count, 1)),
        "peak": peak,
        "peak_share": float(peak / max(total, EPS)) if total > 0 else 0.0,
        "last": last,
        "last_share": float(last / max(total, EPS)) if total > 0 else 0.0,
    }


def _window_means(series: pd.Series, last_minutes: int, prev_minutes: int) -> tuple[float, float]:
    if len(series) == 0:
        return 0.0, 0.0
    last_slice = series.tail(last_minutes) if len(series) >= last_minutes else series
    prev_slice = series.tail(last_minutes + prev_minutes).head(prev_minutes) if len(series) >= last_minutes + prev_minutes else series.head(0)
    last_mean = float(last_slice.mean()) if len(last_slice) else 0.0
    prev_mean = float(prev_slice.mean()) if len(prev_slice) else 0.0
    return last_mean, prev_mean


def _severity_profile(df_norm: pd.DataFrame) -> dict[str, Any]:
    if "severity" not in df_norm.columns:
        return {"total": 0, "high_share": 0.0, "dominant": ""}

    severity = _safe_astype_str(df_norm["severity"]).str.upper().str.strip()
    severity = severity[severity != ""]
    if severity.empty:
        return {"total": 0, "high_share": 0.0, "dominant": ""}

    high_mask = severity.str.contains(r"CRIT|HIGH", regex=True, na=False)
    dominant = str(severity.mode().iloc[0]) if not severity.mode().empty else ""
    return {
        "total": int(len(severity)),
        "high_share": float(high_mask.mean()) if len(severity) else 0.0,
        "dominant": dominant,
    }


def _select_analysis_mode(minute_count: int, timeline_profile: dict[str, Any]) -> tuple[str, str]:
    if minute_count < MIN_MINUTE_BUCKETS:
        return "short_burst_predictive", "limited_minute_history"
    if timeline_profile.get("active_ratio", 0.0) < MIN_ACTIVITY_RATIO_FOR_FORECAST:
        return "short_burst_predictive", "sparse_temporal_continuity"
    return "long_timeline_forecast", "sustained_temporal_history"


def _append_phase(flags: list[str], predicted_events: list[str], flag: str, event: str) -> None:
    if flag not in flags:
        flags.append(flag)
    if event not in predicted_events:
        predicted_events.append(event)


def _empty_prediction(message: str, analysis_mode: str = "insufficient_data") -> dict[str, Any]:
    return {
        "prediction_score": 0,
        "signals": {},
        "flags": [],
        "predicted_events": [],
        "analysis_mode": analysis_mode,
        "timeline_characteristics": {},
        "message": message,
    }


def _score_long_mode(signals: dict[str, dict[str, Any]], flags: list[str]) -> float:
    prediction_score = 0.0

    if signals["failures"]["trend_ratio"] >= TREND_RATIO_RISING:
        prediction_score += 5.0
    if signals["failures"]["acceleration"] > 0:
        prediction_score += 8.0
    if signals["failures"]["burst_ratio"] >= BURST_RATIO_STRONG:
        prediction_score += 6.0

    if signals["kernel_errors"]["trend_ratio"] >= TREND_RATIO_RISING:
        prediction_score += 5.0
    if signals["kernel_errors"]["burst_ratio"] >= 1.5 and signals["kernel_errors"]["acceleration"] >= 0:
        prediction_score += 7.0

    if signals["usernames"]["trend_ratio"] >= TREND_RATIO_RISING:
        prediction_score += 4.0
    if signals["usernames"]["burst_ratio"] >= 2.0:
        prediction_score += 3.0

    if signals["ftp_events"]["trend_ratio"] >= TREND_RATIO_RISING:
        prediction_score += 4.0
    if signals["ftp_events"]["burst_ratio"] >= BURST_RATIO_STRONG:
        prediction_score += 5.0

    if "BOTNET_WARMUP" in flags:
        prediction_score += 10.0
    if "SPRAY_PHASE" in flags:
        prediction_score += 8.0
    if "CRASH_COMING" in flags:
        prediction_score += 10.0
    if "DATA_EXFIL_START" in flags:
        prediction_score += 10.0

    return prediction_score


def _score_short_mode(
    signals: dict[str, dict[str, Any]],
    flags: list[str],
    timeline_profile: dict[str, Any],
    failures_profile: dict[str, Any],
    unique_ips_profile: dict[str, Any],
    usernames_profile: dict[str, Any],
    ftp_profile: dict[str, Any],
    kernel_profile: dict[str, Any],
    severity_profile: dict[str, Any],
    ssh_unique_ip_total: int,
    username_total: int,
    retr_share: float,
) -> float:
    prediction_score = 0.0

    if signals["failures"]["burst_ratio"] >= BURST_RATIO_STRONG:
        prediction_score += 8.0
    if failures_profile["peak_share"] >= SHORT_BURST_PEAK_SHARE and failures_profile["peak"] >= SHORT_FAILURES_SEVERE:
        prediction_score += 7.0
    if failures_profile["last"] >= SHORT_FAILURES_SEVERE:
        prediction_score += 5.0

    if ssh_unique_ip_total >= BOTNET_MIN_UNIQUE_IPS:
        prediction_score += 5.0
    if unique_ips_profile["peak_share"] >= SHORT_BURST_PEAK_SHARE and unique_ips_profile["peak"] >= BOTNET_MIN_UNIQUE_IPS:
        prediction_score += 4.0

    if username_total >= SPRAY_MIN_USERNAMES:
        prediction_score += 7.0
    if usernames_profile["peak_share"] >= 0.5 and username_total >= max(4, SPRAY_MIN_USERNAMES // 2):
        prediction_score += 3.0

    if ftp_profile["total"] >= 2:
        prediction_score += 4.0
    if ftp_profile["peak_share"] >= SHORT_BURST_PEAK_SHARE and retr_share >= EXFIL_MIN_RETR_SHARE:
        prediction_score += 5.0

    if kernel_profile["peak"] >= SHORT_KERNEL_EVENTS_MIN:
        prediction_score += 6.0
    if signals["kernel_errors"]["burst_ratio"] >= CRASH_KERNEL_BURST_RATIO:
        prediction_score += 4.0

    active_signal_families = sum(
        [
            int(failures_profile["total"] > 0),
            int(ssh_unique_ip_total >= 2),
            int(username_total >= 2),
            int(ftp_profile["total"] > 0),
            int(kernel_profile["total"] > 0),
        ]
    )
    if active_signal_families >= 2:
        prediction_score += 4.0
    if active_signal_families >= 3:
        prediction_score += 6.0

    if timeline_profile["peak_share"] >= SHORT_BURST_PEAK_SHARE and active_signal_families >= 2:
        prediction_score += 5.0

    if severity_profile["high_share"] >= SHORT_HIGH_SEVERITY_SHARE and severity_profile["total"] >= 3:
        prediction_score += 4.0

    if "BOTNET_WARMUP" in flags:
        prediction_score += 10.0
    if "SPRAY_PHASE" in flags:
        prediction_score += 8.0
    if "CRASH_COMING" in flags:
        prediction_score += 10.0
    if "DATA_EXFIL_START" in flags:
        prediction_score += 10.0

    return prediction_score


def _build_minute_frame(df_norm: pd.DataFrame) -> pd.DataFrame:
    if df_norm is None or df_norm.empty:
        return pd.DataFrame()

    if "timestamp" not in df_norm.columns:
        return pd.DataFrame()

    df = df_norm.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df = df.dropna(subset=["timestamp"])
    if df.empty:
        return pd.DataFrame()

    df["_minute"] = df["timestamp"].dt.floor("1min")

    return df


def run_prediction_engine(df_norm: pd.DataFrame) -> dict[str, Any]:
    """
    Main entry point for the pre-attack forecasting engine.
    """
    minute_df = _build_minute_frame(df_norm)
    if minute_df.empty:
        return _empty_prediction("Prevision indisponible: horodatage exploitable absent.")

    minute_index = pd.date_range(
        minute_df["_minute"].min(),
        minute_df["_minute"].max(),
        freq="1min",
    )

    content = _safe_astype_str(minute_df.get("Content", pd.Series(index=minute_df.index, dtype=str)))
    source_log = _safe_astype_str(minute_df.get("source_log", pd.Series(index=minute_df.index, dtype=str)))

    # SSH failures
    ssh_mask = content.str.contains(SSH_FAILURE_REGEX.pattern, na=False)
    ssh_df = minute_df.loc[ssh_mask].copy()

    # FTP transfers (activity that suggests file movement or recon around files)
    ftp_mask = (
        source_log.str.contains("ftp", case=False, na=False)
        | content.str.contains(FTP_TRANSFER_REGEX.pattern, na=False)
    )
    ftp_df = minute_df.loc[ftp_mask].copy()

    # Kernel errors/warnings (pre-crash instability)
    kernel_mask = (
        source_log.str.contains("syslog", case=False, na=False)
        | content.str.contains(KERNEL_ERROR_REGEX.pattern, na=False)
        | content.str.contains(KERNEL_WARN_REGEX.pattern, na=False)
    ) & content.str.contains(r"kernel|oom|panic|bug:|segfault|i/o error|ext4", flags=re.I, na=False)

    kernel_df = minute_df.loc[kernel_mask].copy()

    # Create per-minute series (dense reindex fill 0).
    def _reindex(s: pd.Series) -> pd.Series:
        if s is None or s.empty:
            return pd.Series(0.0, index=minute_index)
        return s.reindex(minute_index, fill_value=0.0).astype(float)

    all_events_per_minute = _reindex(minute_df.groupby("_minute").size())
    failures_per_minute = _reindex(
        ssh_df.groupby("_minute").size()
    )

    unique_ips_per_minute = _reindex(
        ssh_df.groupby("_minute")["source_ip"].nunique()
    )

    # Username diversity / spraying phase uses SSH failure context.
    username_total = 0
    if not ssh_df.empty:
        usernames_per_row = _extract_username_safe(ssh_df["Content"])
        tmp = ssh_df.copy()
        tmp["_username"] = usernames_per_row
        usernames_per_minute = _reindex(tmp.groupby("_minute")["_username"].nunique())
        username_total = int(usernames_per_row.replace("", pd.NA).dropna().nunique())
    else:
        usernames_per_minute = pd.Series(0.0, index=minute_index)

    ftp_events_per_minute = _reindex(
        ftp_df.groupby("_minute").size()
    )

    # Split FTP into RETR (downloads) and STOR (uploads) for exfil nuance.
    if not ftp_df.empty:
        retr_mask = _safe_astype_str(ftp_df.get("Content", pd.Series(index=ftp_df.index, dtype=str))).str.contains(
            FTP_RETR_REGEX.pattern, na=False
        )
        stor_mask = _safe_astype_str(ftp_df.get("Content", pd.Series(index=ftp_df.index, dtype=str))).str.contains(
            FTP_STOR_REGEX.pattern, na=False
        )
        retr_per_minute = _reindex(ftp_df.loc[retr_mask].groupby("_minute").size())
        stor_per_minute = _reindex(ftp_df.loc[stor_mask].groupby("_minute").size())
    else:
        retr_per_minute = pd.Series(0.0, index=minute_index)
        stor_per_minute = pd.Series(0.0, index=minute_index)

    kernel_errors_per_minute = _reindex(
        kernel_df.groupby("_minute").size()
    )

    timeline_profile = _series_profile(all_events_per_minute)
    analysis_mode, mode_reason = _select_analysis_mode(len(minute_index), timeline_profile)

    # Core signals for each series.
    signals = {
        "failures": _core_signals(failures_per_minute),
        "unique_ips": _core_signals(unique_ips_per_minute),
        "usernames": _core_signals(usernames_per_minute),
        "ftp_events": _core_signals(ftp_events_per_minute),
        "kernel_errors": _core_signals(kernel_errors_per_minute),
    }
    failures_profile = _series_profile(failures_per_minute)
    unique_ips_profile = _series_profile(unique_ips_per_minute)
    usernames_profile = _series_profile(usernames_per_minute)
    ftp_profile = _series_profile(ftp_events_per_minute)
    kernel_profile = _series_profile(kernel_errors_per_minute)
    severity_profile = _severity_profile(minute_df)

    # Pre-attack pattern rules
    flags: list[str] = []
    predicted_events: list[str] = []

    last_ips_mean, prev_ips_mean = _window_means(unique_ips_per_minute, LAST_WINDOW_MINUTES, PREV_WINDOW_MINUTES)
    ips_last = float(unique_ips_per_minute.iloc[-1])
    fails_last = float(failures_per_minute.iloc[-1])
    fails_per_ip_last = fails_last / max(ips_last, 1.0)
    ssh_unique_ip_total = int(
        _safe_astype_str(ssh_df.get("source_ip", pd.Series(index=ssh_df.index, dtype=object)))
        .replace({"": pd.NA, "none": pd.NA, "None": pd.NA, "nan": pd.NA, "NaN": pd.NA})
        .dropna()
        .nunique()
    )
    total_failures = failures_profile["total"]
    fails_per_ip_total = total_failures / max(float(ssh_unique_ip_total), 1.0)

    ips_rising = prev_ips_mean > 0 and (last_ips_mean / prev_ips_mean) >= 1.2 or (prev_ips_mean == 0 and last_ips_mean >= BOTNET_MIN_UNIQUE_IPS)
    failures_still_low = fails_last <= BOTNET_FAILS_PER_MINUTE_MAX and fails_per_ip_last <= BOTNET_LOW_FAILS_PER_IP
    ips_above_floor = ips_last >= BOTNET_MIN_UNIQUE_IPS

    if analysis_mode == "long_timeline_forecast":
        if ips_rising and failures_still_low and ips_above_floor:
            _append_phase(flags, predicted_events, "BOTNET_WARMUP", "DISTRIBUTED_ATTACK_IMMINENT")
    else:
        if (
            ssh_unique_ip_total >= BOTNET_MIN_UNIQUE_IPS
            and fails_per_ip_total <= BOTNET_LOW_FAILS_PER_IP * 2.0
            and (
                unique_ips_profile["peak_share"] >= SHORT_BURST_PEAK_SHARE
                or unique_ips_profile["peak"] >= BOTNET_MIN_UNIQUE_IPS
            )
        ):
            _append_phase(flags, predicted_events, "BOTNET_WARMUP", "DISTRIBUTED_ATTACK_IMMINENT")

    # Username spraying phase: username diversity ramps while failures remain moderate.
    last_usernames = float(usernames_per_minute.iloc[-1])
    usernames_median = float(usernames_per_minute.median())
    usernames_spiking = (usernames_median <= 0 and last_usernames >= SPRAY_MIN_USERNAMES) or (
        usernames_median > 0 and (last_usernames / max(usernames_median, EPS)) >= 3.0
    )
    failures_low = float(failures_per_minute.iloc[-1]) <= SPRAY_LOW_FAILS_PER_MINUTE_MAX
    if analysis_mode == "long_timeline_forecast":
        if usernames_spiking and failures_low:
            _append_phase(flags, predicted_events, "SPRAY_PHASE", "BRUTE_FORCE_INCOMING")
    else:
        if username_total >= SPRAY_MIN_USERNAMES and total_failures <= max(SPRAY_LOW_FAILS_PER_MINUTE_MAX, username_total * 2):
            _append_phase(flags, predicted_events, "SPRAY_PHASE", "BRUTE_FORCE_INCOMING")

    # Infra stress (crash coming): kernel errors rising + acceleration + burst.
    kernel_trend = signals["kernel_errors"]["trend_ratio"]
    kernel_accel = signals["kernel_errors"]["acceleration"]
    kernel_burst = signals["kernel_errors"]["burst_ratio"]
    kernel_last = float(kernel_errors_per_minute.iloc[-1])
    if analysis_mode == "long_timeline_forecast":
        if (
            kernel_trend >= CRASH_MIN_KERNEL_TREND_RATIO
            and kernel_accel >= ACCEL_POSITIVE_MIN
            and kernel_burst >= CRASH_KERNEL_BURST_RATIO
            and kernel_last >= 2.0
        ):
            _append_phase(flags, predicted_events, "CRASH_COMING", "SYSTEM_FAILURE_IMMINENT")
    else:
        if (
            kernel_profile["peak"] >= SHORT_KERNEL_EVENTS_MIN
            and (
                kernel_burst >= CRASH_KERNEL_BURST_RATIO
                or kernel_profile["peak_share"] >= SHORT_BURST_PEAK_SHARE
            )
        ):
            _append_phase(flags, predicted_events, "CRASH_COMING", "SYSTEM_FAILURE_IMMINENT")

    # Data exfil start: FTP activity spiking, with download-heavy behavior (RETR share).
    ftp_burst = signals["ftp_events"]["burst_ratio"]
    retr_last = float(retr_per_minute.iloc[-1])
    ftp_last = float(ftp_events_per_minute.iloc[-1])
    retr_share = retr_last / max(ftp_last, EPS)
    retr_total = float(retr_per_minute.sum())
    retr_last_min = float(retr_per_minute.iloc[-1])
    if analysis_mode == "long_timeline_forecast":
        if (
            ftp_burst >= EXFIL_MIN_FTP_BURST_RATIO
            and retr_share >= EXFIL_MIN_RETR_SHARE
            and ftp_last >= 2
            and retr_last_min >= 2
        ):
            _append_phase(flags, predicted_events, "DATA_EXFIL_START", "DATA_THEFT_IN_PROGRESS")
    else:
        if (
            ftp_profile["total"] >= 2
            and retr_total >= 2
            and retr_share >= EXFIL_MIN_RETR_SHARE
            and (
                ftp_burst >= EXFIL_MIN_FTP_BURST_RATIO
                or ftp_profile["peak_share"] >= SHORT_BURST_PEAK_SHARE
            )
        ):
            _append_phase(flags, predicted_events, "DATA_EXFIL_START", "DATA_THEFT_IN_PROGRESS")

    if analysis_mode == "long_timeline_forecast":
        prediction_score = _score_long_mode(signals, flags)
    else:
        prediction_score = _score_short_mode(
            signals=signals,
            flags=flags,
            timeline_profile=timeline_profile,
            failures_profile=failures_profile,
            unique_ips_profile=unique_ips_profile,
            usernames_profile=usernames_profile,
            ftp_profile=ftp_profile,
            kernel_profile=kernel_profile,
            severity_profile=severity_profile,
            ssh_unique_ip_total=ssh_unique_ip_total,
            username_total=username_total,
            retr_share=retr_share,
        )

    prediction_score = float(min(100.0, prediction_score))

    return {
        "prediction_score": int(round(prediction_score)),
        "signals": signals,
        "flags": flags,
        "predicted_events": predicted_events,
        "analysis_mode": analysis_mode,
        "timeline_characteristics": {
            "minute_buckets": int(len(minute_index)),
            "mode_reason": mode_reason,
            "activity_ratio": timeline_profile["active_ratio"],
            "peak_share": timeline_profile["peak_share"],
            "active_minutes": timeline_profile["active_minutes"],
            "severity_high_share": severity_profile["high_share"],
        },
        "message": (
            "Prevision calculee (mode long terme)."
            if analysis_mode == "long_timeline_forecast"
            else "Prevision calculee (mode adaptatif pour rafales courtes)."
        ),
    }

