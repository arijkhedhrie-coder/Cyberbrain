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
    if not SEUILS_PATH.exists():
        return {}
    try:
        with open(SEUILS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _ecrire_seuils(seuils: dict) -> None:
    SEUILS_PATH.parent.mkdir(parents=True, exist_ok=True)
    seuils_securises = {
        k: _clamp(k, float(v)) if isinstance(v, (int, float)) else v
        for k, v in seuils.items()
    }
    with open(SEUILS_PATH, "w", encoding="utf-8") as f:
        json.dump(seuils_securises, f, indent=2, ensure_ascii=False)


def _sauvegarder_dans_change_log(
    version_id: str,
    anciens_seuils: dict,
    nouveaux_seuils: dict,
    gate_result: dict,
) -> None:
    CHANGE_LOG.parent.mkdir(parents=True, exist_ok=True)
    entries: list = []
    if CHANGE_LOG.exists():
        try:
            with open(CHANGE_LOG, "r", encoding="utf-8") as f:
                entries = json.load(f)
        except Exception:
            entries = []
    entries.append({
        "version_id":     version_id,
        "timestamp":      datetime.now().isoformat(),
        "anciens_seuils": anciens_seuils,
        "agent_proposal": nouveaux_seuils,
        "gate_result":    gate_result,
    })
    entries = entries[-200:]
    with open(CHANGE_LOG, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)


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
    if not META_CONFIG_PATH.exists():
        return dict(_META_DEFAULTS)
    try:
        with open(META_CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        for k, v in _META_DEFAULTS.items():
            cfg.setdefault(k, v)
        return cfg
    except Exception:
        return dict(_META_DEFAULTS)


def _ecrire_meta_config(cfg: dict) -> None:
    META_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    cfg["last_updated"] = datetime.now().isoformat()
    with open(META_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


# ─────────────────────────────────────────────────────────────────────────────
# COUCHE 3 — META-LEARNING
# ─────────────────────────────────────────────────────────────────────────────

def meta_learning() -> dict:
    memoire     = charger_memoire()
    meta        = _lire_meta_config()
    changements: dict = {}

    rollback_rate = 0.0
    accept_rate   = 0.0

    if CHANGE_LOG.exists():
        try:
            with open(CHANGE_LOG, "r", encoding="utf-8") as f:
                log_entries: list = json.load(f)
            recent_log = log_entries[-20:]
            if recent_log:
                accepted      = sum(1 for e in recent_log if e.get("gate_result", {}).get("accepted"))
                accept_rate   = accepted / len(recent_log)
                rollback_rate = 1.0 - accept_rate
                print(f"[META] Change log : accept={accept_rate:.0%} rollback={rollback_rate:.0%} (sur {len(recent_log)})")
        except Exception as e:
            print(f"[META] Lecture change log échouée : {e}")

    action_stats       = memoire.get("action_stats", {})
    total_approve      = sum(s.get("approved", 0) for s in action_stats.values())
    total_reject       = sum(s.get("rejected", 0) for s in action_stats.values())
    total_actions      = total_approve + total_reject
    admin_approve_rate = total_approve / total_actions if total_actions >= 5 else 0.5
    print(f"[META] Décisions admin : approve={admin_approve_rate:.0%} (sur {total_actions} décisions)")

    history     = memoire.get("threshold_history", [])
    nb_sessions = len(history)

    if rollback_rate > 0.40:
        old = meta["adaptation_aggressivity"]
        meta["adaptation_aggressivity"] = max(0.2, old - 0.1)
        changements["adaptation_aggressivity"] = f"{old:.2f} → {meta['adaptation_aggressivity']:.2f} (rollbacks élevés)"
        print(f"[META] ⬇ Agressivité réduite : {old:.2f} → {meta['adaptation_aggressivity']:.2f}")
    elif admin_approve_rate > 0.80 and total_actions >= 10:
        old = meta["adaptation_aggressivity"]
        meta["adaptation_aggressivity"] = min(0.9, old + 0.1)
        changements["adaptation_aggressivity"] = f"{old:.2f} → {meta['adaptation_aggressivity']:.2f} (admin approuve souvent)"
        print(f"[META] ⬆ Agressivité augmentée : {old:.2f} → {meta['adaptation_aggressivity']:.2f}")

    if nb_sessions < 10:
        old = meta["adaptation_frequency"]
        meta["adaptation_frequency"] = max(3, old + 1)
        changements["adaptation_frequency"] = f"{old} → {meta['adaptation_frequency']} sessions (peu de données)"
        print(f"[META] ⬆ Fréquence ralentie : toutes les {meta['adaptation_frequency']} sessions")
    elif nb_sessions >= 30 and accept_rate > 0.70:
        old = meta["adaptation_frequency"]
        meta["adaptation_frequency"] = max(2, old - 1)
        changements["adaptation_frequency"] = f"{old} → {meta['adaptation_frequency']} sessions (données stables)"
        print(f"[META] ⬇ Fréquence accélérée : toutes les {meta['adaptation_frequency']} sessions")

    if admin_approve_rate > 0.90 and total_actions >= 20 and accept_rate > 0.80:
        if not meta["agent_mode_auto_upgrade"]:
            meta["agent_mode_auto_upgrade"] = True
            changements["agent_mode_auto_upgrade"] = "False → True (confiance système très haute)"
            print("[META] 🚀 Auto-upgrade activé : SUGGESTION → AUTO possible")
    elif admin_approve_rate < 0.50 and total_actions >= 10:
        if meta["agent_mode_auto_upgrade"]:
            meta["agent_mode_auto_upgrade"] = False
            changements["agent_mode_auto_upgrade"] = "True → False (trop de rejets admin)"
            print("[META] ⛔ Auto-upgrade désactivé (trop de rejets admin)")

    _ecrire_meta_config(meta)

    if changements:
        print(f"[META] ✅ {len(changements)} paramètre(s) modifié(s) : {list(changements.keys())}")
    else:
        print("[META] Stratégie stable — aucun changement")

    return {
        "changements":           changements,
        "meta_config_finale":    meta,
        "rollback_rate":         round(rollback_rate, 3),
        "admin_approve_rate":    round(admin_approve_rate, 3),
        "nb_sessions_analysees": nb_sessions,
        "timestamp":             datetime.now().isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# adjust_thresholds()
# ─────────────────────────────────────────────────────────────────────────────

def adjust_thresholds() -> dict | None:
    memoire      = charger_memoire()
    meta         = _lire_meta_config()
    history      = memoire.get("threshold_history", [])
    aggressivity = meta.get("adaptation_aggressivity", 0.5)

    print(f"[ADAPTIVE] agressivité={aggressivity:.2f} | fréquence=/{meta.get('adaptation_frequency', 5)} sessions")

    false_positive_rate = 0.0
    if len(history) >= 5:
        sessions_analysees = history[-10:]
        for h in sessions_analysees:
            total = h.get("nb_alarms_pass1", 0)
            final = h.get("nb_alarms_final", 0)
            if total > 0:
                false_positive_rate += (total - final) / total
        false_positive_rate /= len(sessions_analysees)
        print(f"[ADAPTIVE] Taux de faux positifs global (10 sessions) : {false_positive_rate:.1%}")
    else:
        print(f"[ADAPTIVE] Pas assez d'historique (minimum 5, actuel: {len(history)})")

    action_stats   = memoire.get("action_stats", {})
    reject_rates:  dict[str, float] = {}
    approve_rates: dict[str, float] = {}
    for anomaly_type, stats in action_stats.items():
        approved = stats.get("approved", 0)
        rejected = stats.get("rejected", 0)
        modified = stats.get("modified", 0)
        total    = approved + rejected + modified
        if total >= 3:
            reject_rates[anomaly_type]  = rejected / total
            approve_rates[anomaly_type] = (approved + modified) / total

    dynamic_kb        = memoire.get("dynamic_kb", {})
    kb_success_rates: dict[str, float] = {}
    for attack_type, entries in dynamic_kb.items():
        if len(entries) >= 3:
            successes = sum(1 for e in entries if e.get("success"))
            kb_success_rates[attack_type] = successes / len(entries)

    nouveaux_seuils: dict[str, float] = {}

    if false_positive_rate > 0.30:
        ssh_delta = 5 + int(aggressivity * 5)
        nouveaux_seuils.update({
            "ssh_high": 25 + ssh_delta,
            "web_high": 40 + ssh_delta * 2,
            "ftp_high": 20 + ssh_delta,
        })
        print(f"[ADAPTIVE] ⬆ Seuils augmentés (FP élevés + delta={ssh_delta})")
    elif false_positive_rate < 0.10 and len(history) >= 5:
        ssh_delta = 3 + int(aggressivity * 5)
        nouveaux_seuils.update({
            "ssh_high": max(15, 25 - ssh_delta),
            "web_high": max(20, 40 - ssh_delta * 2),
            "ftp_high": max(8,  20 - ssh_delta),
        })
        print(f"[ADAPTIVE] ⬇ Seuils réduits (peu de FP + delta={ssh_delta})")

    ssh_types = [k for k in reject_rates if "SSH" in k.upper() or "BRUTE" in k.upper()]
    if ssh_types:
        avg_ssh_reject  = sum(reject_rates[k]  for k in ssh_types) / len(ssh_types)
        avg_ssh_approve = sum(approve_rates[k] for k in ssh_types) / len(ssh_types)
        if avg_ssh_reject > 0.40:
            nouveaux_seuils["ssh_high"] = max(nouveaux_seuils.get("ssh_high", 25), 32)
        elif avg_ssh_approve > 0.85:
            nouveaux_seuils["ssh_high"] = min(nouveaux_seuils.get("ssh_high", 25), 22)

    for attack_type, kb_rate in kb_success_rates.items():
        if "SSH" in attack_type.upper() and kb_rate >= 0.90 and len(dynamic_kb.get(attack_type, [])) >= 10:
            nouveaux_seuils["ssh_high"] = max(nouveaux_seuils.get("ssh_high", 25) - 2, 15)

    if not nouveaux_seuils:
        print("[ADAPTIVE] Seuils globaux OK — aucune modification calculée")
        return None

    nouveaux_seuils = {k: _clamp(k, v) for k, v in nouveaux_seuils.items()}

    anciens_seuils = _lire_seuils_actuels()
    gate_result    = evaluate_new_thresholds(anciens_seuils, nouveaux_seuils, memoire)
    version_id     = datetime.now().strftime("%Y%m%d_%H%M%S_%f")

    print(f"[VALIDATION] {'✅ ACCEPTÉ' if gate_result['accepted'] else '❌ REJETÉ'} : {gate_result['reason']}")
    _sauvegarder_dans_change_log(version_id, anciens_seuils, nouveaux_seuils, gate_result)

    if not gate_result["accepted"]:
        print("[ADAPTIVE] Seuils non appliqués — rollback implicite")
        return None

    mapping = {
        "ssh_high": "Nombre_Tentatives",
        "web_high": "web_threshold",
        "ftp_high": "ftp_threshold",
    }
    seuils_actuels = _lire_seuils_actuels()
    for src_key, dst_key in mapping.items():
        if src_key in nouveaux_seuils:
            seuils_actuels[dst_key] = float(nouveaux_seuils[src_key])

    seuils_actuels["_updated_at"]  = datetime.now().isoformat()
    seuils_actuels["_version_id"]  = version_id
    seuils_actuels["_gate_result"] = gate_result
    seuils_actuels["_sources"] = {
        "fp_rate":           round(false_positive_rate, 3),
        "from_action_stats": bool(reject_rates),
        "from_dynamic_kb":   bool(kb_success_rates),
        "aggressivity":      aggressivity,
    }
    _ecrire_seuils(seuils_actuels)

    memoire.setdefault("seuils_adaptatifs", []).append({
        "date":       datetime.now().isoformat(),
        "seuils":     nouveaux_seuils,
        "fp_rate":    round(false_positive_rate, 3),
        "gate":       gate_result,
        "version_id": version_id,
        "sources": {
            "global_fp_rate":    round(false_positive_rate, 3),
            "action_stats_used": list(reject_rates.keys()),
            "kb_types_used":     list(kb_success_rates.keys()),
        },
    })
    sauvegarder_memoire(memoire)

    print(f"[ADAPTIVE] Seuils écrits dans {SEUILS_PATH} : {nouveaux_seuils}")
    return nouveaux_seuils


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
        return _lire_seuils_actuels()