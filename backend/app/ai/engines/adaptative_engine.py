# app/ai/engines/adaptative_engine.py
# ═══════════════════════════════════════════════════════════════════════════
# VERSION FINALE UNIQUE — tout est ici
#
# COUCHE 1 : evaluate_new_thresholds() — valide les nouveaux seuils avant application
# COUCHE 2 : SAFE_RANGES + _clamp()   — limites absolues anti-dérive
# COUCHE 3 : meta_learning()          — adapte la stratégie globale
# INTERFACE : DynamicConfig           — façade utilisée par main.py
# ═══════════════════════════════════════════════════════════════════════════

import json
import os
from datetime import datetime
from pathlib import Path

from app.ai.agents.memory import charger_memoire, sauvegarder_memoire

# ─────────────────────────────────────────────────────────────────────────────
# CHEMINS — centralisés ici, une seule source de vérité
# ─────────────────────────────────────────────────────────────────────────────

SEUILS_PATH      = Path("app/models/seuils_adaptatifs.json")
CHANGE_LOG       = Path("app/models/threshold_change_log.json")
META_CONFIG_PATH = Path("app/models/meta_config.json")
_ISOLATION_NOTICE = (
    "Global threshold persistence and meta-learning are disabled. "
    "Thresholds, memory, and overrides must remain dataset-scoped."
)

# ─────────────────────────────────────────────────────────────────────────────
# COUCHE 2 — SAFE RANGES (limites absolues anti-dérive)
# ─────────────────────────────────────────────────────────────────────────────

SAFE_RANGES: dict[str, tuple[float, float]] = {
    "ssh_high":          (10.0,  60.0),
    "web_high":          (20.0, 200.0),
    "ftp_high":          (5.0,   50.0),
    "kernel_high":       (3.0,   30.0),
    "Nombre_Tentatives": (10.0,  60.0),
    "web_threshold":     (20.0, 200.0),
    "ftp_threshold":     (5.0,   50.0),
    "kernel_threshold":  (3.0,   30.0),
}


def _clamp(key: str, value: float) -> float:
    if key not in SAFE_RANGES:
        return value
    lo, hi = SAFE_RANGES[key]
    clamped = max(lo, min(hi, value))
    if clamped != value:
        print(f"[SAFE_RANGE] {key}: {value} → {clamped} (limité entre {lo} et {hi})")
    return clamped


# ─────────────────────────────────────────────────────────────────────────────
# PERSISTANCE — lecture / écriture JSON
# ─────────────────────────────────────────────────────────────────────────────

def _lire_seuils_actuels() -> dict:
    return {}


def _ecrire_seuils(seuils: dict) -> None:
    print(f"[ADAPTIVE][DISABLED] { _ISOLATION_NOTICE }")


def _sauvegarder_dans_change_log(
    version_id: str,
    anciens_seuils: dict,
    nouveaux_seuils: dict,
    gate_result: dict,
) -> None:
    print(f"[ADAPTIVE][DISABLED] Change log skipped for {version_id}: {_ISOLATION_NOTICE}")


# ─────────────────────────────────────────────────────────────────────────────
# COUCHE 1 — VALIDATION POST-ADAPTATION
# ─────────────────────────────────────────────────────────────────────────────

def evaluate_new_thresholds(
    anciens_seuils: dict,
    nouveaux_seuils: dict,
    memoire: dict,
) -> dict:
    history = memoire.get("threshold_history", [])

    if len(history) < 3:
        return {
            "accepted":    True,
            "reason":      "Pas assez d'historique pour évaluer — accepté par défaut (bootstrap)",
            "old_fp_rate": 0.0,
            "new_fp_rate": 0.0,
            "delta":       0.0,
        }

    recent = history[-5:]
    old_fp = 0.0
    count  = 0
    for h in recent:
        total = h.get("nb_alarms_pass1", 0)
        final = h.get("nb_alarms_final", 0)
        if total > 0:
            old_fp += (total - final) / total
            count  += 1
    old_fp = old_fp / count if count > 0 else 0.0

    ssh_old     = anciens_seuils.get("Nombre_Tentatives", anciens_seuils.get("ssh_high", 25.0))
    ssh_new     = nouveaux_seuils.get("ssh_high", ssh_old)
    delta_ratio = (ssh_new - ssh_old) / ssh_old if ssh_old != 0 else 0.0

    estimated_new_fp = old_fp * (1.0 - delta_ratio * 0.5)
    estimated_new_fp = max(0.0, min(1.0, estimated_new_fp))
    delta = estimated_new_fp - old_fp

    if estimated_new_fp <= old_fp + 0.05:
        return {
            "accepted":    True,
            "reason":      f"Amélioration estimée : FP {old_fp:.1%} → {estimated_new_fp:.1%} (delta={delta:+.1%})",
            "old_fp_rate": round(old_fp, 3),
            "new_fp_rate": round(estimated_new_fp, 3),
            "delta":       round(delta, 3),
        }
    else:
        return {
            "accepted":    False,
            "reason":      f"Régression estimée : FP {old_fp:.1%} → {estimated_new_fp:.1%} (delta={delta:+.1%}) — ROLLBACK",
            "old_fp_rate": round(old_fp, 3),
            "new_fp_rate": round(estimated_new_fp, 3),
            "delta":       round(delta, 3),
        }


# ─────────────────────────────────────────────────────────────────────────────
# META CONFIG
# ─────────────────────────────────────────────────────────────────────────────

_META_DEFAULTS: dict = {
    "adaptation_frequency":    5,
    "adaptation_aggressivity": 0.5,
    "ml_weight":               0.7,
    "agent_mode_auto_upgrade": False,
    "last_updated":            None,
    "_version":                1,
}


def _lire_meta_config() -> dict:
    return {
        **_META_DEFAULTS,
        "disabled": True,
        "scope": "dataset_local_only",
        "reason": _ISOLATION_NOTICE,
    }


def _ecrire_meta_config(cfg: dict) -> None:
    print(f"[ADAPTIVE][DISABLED] Meta config write skipped: {_ISOLATION_NOTICE}")


# ─────────────────────────────────────────────────────────────────────────────
# COUCHE 3 — META-LEARNING
# ─────────────────────────────────────────────────────────────────────────────

def meta_learning() -> dict:
    return {
        "disabled": True,
        "scope": "dataset_local_only",
        "reason": _ISOLATION_NOTICE,
        "timestamp": datetime.now().isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# adjust_thresholds()
# ─────────────────────────────────────────────────────────────────────────────

def adjust_thresholds() -> dict | None:
    print(f"[ADAPTIVE][DISABLED] {_ISOLATION_NOTICE}")
    return {
        "disabled": True,
        "scope": "dataset_local_only",
        "reason": _ISOLATION_NOTICE,
        "timestamp": datetime.now().isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# INTERFACE — DynamicConfig
# Façade utilisée par main.py.
# ─────────────────────────────────────────────────────────────────────────────

class DynamicConfig:
    """
    Interface unique pour main.py.
    Toute la logique est dans les fonctions au-dessus.
    """

    def __init__(
        self,
        ssh_high_risk_threshold: int = 38,
        ssh_med_risk_threshold: int = 25,
        web_high_risk_threshold: int = 55,
        web_med_risk_threshold: int = 30,
        ftp_high_risk_threshold: int = 55,
        ftp_med_risk_threshold: int = 30,
        kernel_high_risk_threshold: int = 50,
        session_high_risk_threshold: int = 50,
        session_med_risk_threshold: int = 25,
        correlation_window_min: int = 30,
        escalate_ips: list = None,
        suppress_ips: list = None,
        rerun_engines: list = None,
        threat_level: str = "NORMAL",
        reasoning: str = "",
        confidence: float = 0.5,
    ):
        self.ssh_high_risk_threshold = ssh_high_risk_threshold
        self.ssh_med_risk_threshold = ssh_med_risk_threshold
        self.web_high_risk_threshold = web_high_risk_threshold
        self.web_med_risk_threshold = web_med_risk_threshold
        self.ftp_high_risk_threshold = ftp_high_risk_threshold
        self.ftp_med_risk_threshold = ftp_med_risk_threshold
        self.kernel_high_risk_threshold = kernel_high_risk_threshold
        self.session_high_risk_threshold = session_high_risk_threshold
        self.session_med_risk_threshold = session_med_risk_threshold
        self.correlation_window_min = correlation_window_min
        self.escalate_ips = escalate_ips or []
        self.suppress_ips = suppress_ips or []
        self.rerun_engines = rerun_engines or []
        self.threat_level = threat_level
        self.reasoning = reasoning
        self.confidence = confidence

    @classmethod
    def default(cls) -> "DynamicConfig":
        return cls(
            ssh_high_risk_threshold=38,
            ssh_med_risk_threshold=22,
            web_high_risk_threshold=55,
            web_med_risk_threshold=30,
            ftp_high_risk_threshold=55,
            ftp_med_risk_threshold=30,
            kernel_high_risk_threshold=50,
            session_high_risk_threshold=50,
            session_med_risk_threshold=25,
            correlation_window_min=30,
            escalate_ips=[],
            suppress_ips=[],
            rerun_engines=[],
            threat_level="NORMAL",
            reasoning="Fallback default config",
            confidence=0.5,
        )

    @classmethod
    def from_json(cls, data: dict) -> "DynamicConfig":
        """
        Reconstruit une instance DynamicConfig depuis un dictionnaire JSON.
        """
        if not data:
            return cls.default()

        # Safe extraction with defaults
        return cls(
            ssh_high_risk_threshold=data.get("ssh_high_risk_threshold", 38),
            ssh_med_risk_threshold=data.get("ssh_med_risk_threshold", 22),
            web_high_risk_threshold=data.get("web_high_risk_threshold", 55),
            web_med_risk_threshold=data.get("web_med_risk_threshold", 30),
            ftp_high_risk_threshold=data.get("ftp_high_risk_threshold", 55),
            ftp_med_risk_threshold=data.get("ftp_med_risk_threshold", 30),
            kernel_high_risk_threshold=data.get("kernel_high_risk_threshold", 50),
            session_high_risk_threshold=data.get("session_high_risk_threshold", 50),
            session_med_risk_threshold=data.get("session_med_risk_threshold", 25),
            correlation_window_min=data.get("correlation_window_min", 30),
            escalate_ips=data.get("escalate_ips", []),
            suppress_ips=data.get("suppress_ips", []),
            rerun_engines=data.get("rerun_engines", []),
            threat_level=data.get("threat_level", "NORMAL"),
            reasoning=data.get("reasoning", ""),
            confidence=data.get("confidence", 0.5),
        )

    def to_json(self) -> dict:
        return {
            "ssh_high_risk_threshold": self.ssh_high_risk_threshold,
            "ssh_med_risk_threshold": self.ssh_med_risk_threshold,
            "web_high_risk_threshold": self.web_high_risk_threshold,
            "web_med_risk_threshold": self.web_med_risk_threshold,
            "ftp_high_risk_threshold": self.ftp_high_risk_threshold,
            "ftp_med_risk_threshold": self.ftp_med_risk_threshold,
            "kernel_high_risk_threshold": self.kernel_high_risk_threshold,
            "session_high_risk_threshold": self.session_high_risk_threshold,
            "session_med_risk_threshold": self.session_med_risk_threshold,
            "correlation_window_min": self.correlation_window_min,
            "escalate_ips": self.escalate_ips,
            "suppress_ips": self.suppress_ips,
            "rerun_engines": self.rerun_engines,
            "threat_level": self.threat_level,
            "reasoning": self.reasoning,
            "confidence": self.confidence,
            "meta_config": _lire_meta_config(),
        }

    def summary(self) -> str:
        return (
            f"threat={self.threat_level} | "
            f"ssh_high={self.ssh_high_risk_threshold} | "
            f"ssh_med={self.ssh_med_risk_threshold} | "
            f"web_high={self.web_high_risk_threshold} | "
            f"web_med={self.web_med_risk_threshold} | "
            f"session_high={self.session_high_risk_threshold} | "
            f"session_med={self.session_med_risk_threshold} | "
            f"confidence={self.confidence:.2f} | "
            f"reasoning={self.reasoning[:60]}"
        )

    def is_default(self) -> bool:
        return (
            self.threat_level == "NORMAL"
            and not self.escalate_ips
            and not self.suppress_ips
            and self.ssh_high_risk_threshold == 38
            and self.ssh_med_risk_threshold == 22
            and self.web_high_risk_threshold == 55
            and self.web_med_risk_threshold == 30
            and self.ftp_high_risk_threshold == 55
            and self.ftp_med_risk_threshold == 30
            and self.kernel_high_risk_threshold == 50
            and self.session_high_risk_threshold == 50
            and self.session_med_risk_threshold == 25
            and self.correlation_window_min == 30
        )

    @staticmethod
    def get_meta_config() -> dict:
        return _lire_meta_config()

    @staticmethod
    def update_meta_learning() -> dict:
        return meta_learning()

    @staticmethod
    def run_adjust_thresholds() -> dict | None:
        return adjust_thresholds()

    @staticmethod
    def current_thresholds() -> dict:
        return {}
