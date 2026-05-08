# src/agents/trust_gate.py
# ─────────────────────────────────────────────────────────────────────────────
# Trust Gate — VERSION FINALE
# Décide si le système est autorisé à s'adapter, selon le contexte demandé.
#
# Contextes supportés :
#   "GLOBAL"             → protège adjust_thresholds() dans main.py
#   "PASS2"              → protège le déclenchement du PASS 2
#   "CORRECTIVE_ACTION"  → protège _run_safe_corrective_action() dans main.py
# ─────────────────────────────────────────────────────────────────────────────

from app.ai.agents.memory import get_success_rate, compute_session_stability


def should_adapt(context: str = "GLOBAL") -> dict:
    """
    Décide si le système peut s'adapter selon le contexte.

    Args:
        context : "GLOBAL" | "PASS2" | "CORRECTIVE_ACTION"

    Retourne :
    {
        "allow":        bool,
        "reason":       str,
        "success_rate": float,
        "stability":    dict,
        "context":      str,
    }
    """
    stability    = compute_session_stability()
    confidence   = stability.get("confidence", "LOW")
    stable_sigs  = stability.get("stable_signals", 0)

    # ── Seuils différents selon le risque du contexte ─────────────────────────
    # CORRECTIVE_ACTION = risque le plus élevé → critères les plus stricts
    # PASS2             = risque moyen          → critères intermédiaires
    # GLOBAL            = risque faible         → critères souples

    if context == "CORRECTIVE_ACTION":
        # Action concrète sur le système → exige confiance maximale
        required_confidence = "HIGH"
        required_rate       = 0.75
        anomaly_type        = "BRUTE-FORCE SSH"   # type le plus critique

    elif context == "PASS2":
        # Réajustement des seuils de détection → confiance intermédiaire
        required_confidence = "MEDIUM"
        required_rate       = 0.60
        anomaly_type        = "GLOBAL"

    else:  # GLOBAL
        # Adaptation des seuils de base → critères souples
        required_confidence = "LOW"    # accepte même LOW (on refuse seulement si vide)
        required_rate       = 0.50
        anomaly_type        = "GLOBAL"

    # ── Récupération du taux de succès ────────────────────────────────────────
    rate = get_success_rate(anomaly_type)

    # ── Règle 1 : taux de succès insuffisant ──────────────────────────────────
    if rate > 0 and rate < required_rate:
        return {
            "allow":        False,
            "reason":       f"[{context}] Taux de succès trop faible ({rate:.0%} < {required_rate:.0%} requis)",
            "success_rate": rate,
            "stability":    stability,
            "context":      context,
        }

    # ── Règle 2 : stabilité insuffisante ─────────────────────────────────────
    confidence_levels = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}
    conf_score    = confidence_levels.get(confidence, 0)
    req_score     = confidence_levels.get(required_confidence, 1)

    if conf_score < req_score:
        return {
            "allow":        False,
            "reason":       f"[{context}] Stabilité insuffisante ({confidence} < {required_confidence} requis, signaux={stable_sigs}/3)",
            "success_rate": rate,
            "stability":    stability,
            "context":      context,
        }

    # ── Règle 3 : PASS2 bloqué si drift élevé ────────────────────────────────
    if context == "PASS2":
        drift_flagged = stability.get("drift_flagged", False)
        if drift_flagged:
            return {
                "allow":        False,
                "reason":       f"[PASS2] Drift élevé détecté — adaptation risquée, garder Pass 1",
                "success_rate": rate,
                "stability":    stability,
                "context":      context,
            }

    # ── Autorisé ──────────────────────────────────────────────────────────────
    return {
        "allow":        True,
        "reason":       f"[{context}] OK — taux={rate:.0%} stabilité={confidence} signaux={stable_sigs}/3",
        "success_rate": rate,
        "stability":    stability,
        "context":      context,
    }