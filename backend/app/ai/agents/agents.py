"""
agents.py — VERSION FINALE INTÉGRÉE + AGENT CORRECTEUR SEMI-AUTOMATIQUE
=========================================================================
Fusion complète :
  - Base : version principale (dispatch MCP direct Python, patch throttle automatique + retry 429)
  - Correctifs binôme greffés :
      [B1] field_validator sur ActionCorrectiveInput — coerce dict/list → str (évite rejet 400 Groq)
      [B2] SURVEILLANCE_NORMALE géré explicitement dans OutilActionCorrective
      [B3] Flag anti-boucle _alarme_declenchee_ce_cycle dans OutilDeclencherAlarme
      [B4] OutilAnalyserLogs enrichi — 8 types d'attaques détectés
      [B5] max_iter=1 / max_retry_limit=1 sur detector_agent
  - Agent Correcteur Semi-Automatique (3 Phases Évolutives) :
      [C1] AGENT_MODE configurable : TRAINING | SUGGESTION | AUTO
      [C2] _compute_confidence() — confidence score dynamique par type d'attaque
      [C3] KNOWLEDGE_BASE — base de connaissance enrichie (Phase 1)
      [C4] _build_action() — séparation construction/exécution de l'action
      [C5] Broadcast WebSocket CORRECTIVE_SUGGESTION vers le dashboard
      [C6] Sauvegarde S3 différenciée : training_log / suggestion_log / auto_action_log
      [C7] Corrector Agent backstory mise à jour (semi-automatique, Human-in-the-Loop)
  - FIXES v2 :
      [FIX-1] broadcast_alarm dans OutilDeclencherAlarme correctement indenté dans la boucle
      [FIX-2] POST /api/corrective/suggestion correctement indenté dans le bloc SUGGESTION
      [FIX-3] server_id propagé depuis l'alarme vers broadcast_alarm

Architecture multi-agents CrewAI — 6 agents spécialisés :
  1. Collecteur       — Récupère les logs depuis S3
  2. Analyste         — Analyse les patterns et prédit les tendances
  3. Détecteur        — Détecte anomalies + déclenche alarmes préventives
  4. Correcteur       — Agent semi-automatique (TRAINING → SUGGESTION → AUTO)
  5. Orchestrateur    — Coordonne les agents et gère les priorités
  6. Rapporteur       — Génère et sauvegarde le rapport final sur S3
"""

import os
import sys
import json
import re
from datetime import datetime
from typing import Optional
from app.ai.tools.crewai_compat import patch_legacy_rag_storage_for_ollama

# ── Imports directs — pas de subprocess ──────────────────────────────────────
try:
    from app.ai.tools import s3_tools

    _S3_DISPONIBLE = True
except ImportError:
    s3_tools = None
    _S3_DISPONIBLE = False
    print("[WARN] s3_tools non disponible — opérations S3 en mode simulation")

try:
    from app.ai.tools import linux_tools
    _LINUX_TOOLS_DISPONIBLE = True
except ImportError:
    linux_tools = None
    _LINUX_TOOLS_DISPONIBLE = False
    print("[WARN] linux_tools non disponible — opérations SSH en mode simulation")

# ==============================
# VARIABLES D'ENVIRONNEMENT — AVANT TOUT IMPORT CREWAI
# ==============================
os.environ.setdefault("OPENAI_API_KEY",            "fake-not-needed")
os.environ.setdefault("CREWAI_EMBEDDING_PROVIDER", "ollama")
os.environ.setdefault("CREWAI_EMBEDDING_MODEL",    "nomic-embed-text")
os.environ.setdefault("OLLAMA_BASE_URL",           "http://localhost:11434")
os.environ.setdefault("OTEL_SDK_DISABLED",         "true")

# Patch RAGStorage pour forcer Ollama avant initialisation ChromaDB
_rag_patch_status, _rag_patch_detail = patch_legacy_rag_storage_for_ollama()
if _rag_patch_status == "applied":
    print("[OK] Patch RAGStorage Ollama appliqué")
elif _rag_patch_status == "skipped":
    print(f"[INFO] Patch RAGStorage ignoré: {_rag_patch_detail}")
else:
    print(f"[WARN] Patch RAGStorage échoué: {_rag_patch_detail}")

from crewai import Agent, LLM
from crewai.tools import BaseTool
from pydantic import BaseModel, Field, field_validator
from dotenv import load_dotenv
import time

load_dotenv()



GROQ_API_KEY = os.getenv("GROQ_API_KEY")
os.environ.setdefault("GROQ_API_KEY", GROQ_API_KEY or "")


llm = LLM(
    model="groq/llama-3.1-8b-instant",   
    api_key=GROQ_API_KEY,
    temperature=0.1,
    max_tokens=1000,
)

llm_analyst = LLM(
    model="groq/llama-3.1-8b-instant",
    api_key=GROQ_API_KEY,
    temperature=0.1,
    max_tokens=1000,
)

llm_orchestrator = LLM(
    model="groq/llama-3.1-8b-instant",
    api_key=GROQ_API_KEY,
    temperature=0.0,   
    max_tokens=800,
)

# ── FLAG ANTI-BOUCLE [B3] : empêche declencher_alarme d'être appelé plusieurs fois ──
_alarme_declenchee_ce_cycle = False

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
os.environ.setdefault("GROQ_API_KEY", GROQ_API_KEY or "")

# ================================
# MODULE AWS SECURITY — BLOCAGE BOTO3 RÉEL
# ================================
try:
    from app.aws_security import bloquer_ip_secgroup, bloquer_depuis_anomalie
    AWS_SECURITY_DISPONIBLE = True
    print("[OK] Module aws_security chargé — blocage AWS réel activé")
except ImportError:
    AWS_SECURITY_DISPONIBLE = False
    print("[WARN] aws_security non disponible — mode simulation uniquement")


# ═════════════════════════════════════════════════════════════════════════════
# 🎯 CONFIGURATION GLOBALE DE L'AGENT CORRECTEUR — [C1]
# ═════════════════════════════════════════════════════════════════════════════
AGENT_MODE: str = os.getenv("CORRECTIVE_AGENT_MODE", "SUGGESTION")
CONFIDENCE_THRESHOLD_AUTO: float = float(os.getenv("CONFIDENCE_THRESHOLD", "0.85"))

print(f"[CORRECTIVE AGENT] Mode actif : {AGENT_MODE} | Seuil confiance AUTO : {CONFIDENCE_THRESHOLD_AUTO}")


# ═════════════════════════════════════════════════════════════════════════════
# 🧮 CALCUL DU CONFIDENCE SCORE — [C2]
# ═════════════════════════════════════════════════════════════════════════════


# ── Import mémoire adaptative ─────────────────────────────────────────────────
from app.ai.agents.memory import (
    charger_memoire,
    sauvegarder_memoire,
    get_success_rate,
    enregistrer_stat_action,
)


# ═════════════════════════════════════════════════════════════════════════════
# 🔁 COMMANDES ADAPTATIVES — apprises des corrections admin
# ═════════════════════════════════════════════════════════════════════════════

def get_adaptive_command(anomaly_type: str, default_command: str) -> str:
    """
    Retourne la commande corrigée la plus récente pour ce type d'anomalie,
    ou default_command si aucune correction n'a jamais été enregistrée.
    """
    try:
        memoire = charger_memoire()
        for m in reversed(memoire.get("modified_actions", [])):
            if m.get("anomaly_type") == anomaly_type and m.get("improved_command"):
                print(f"[ADAPTIVE] 🔁 Commande améliorée trouvée pour '{anomaly_type}'")
                return m["improved_command"]
    except Exception as e:
        print(f"[WARN] get_adaptive_command: {e}")
    return default_command


def get_best_command(anomaly_type: str, default_command: str) -> str:
    """
    Retourne la commande corrigée la plus fréquente (vote majoritaire).
    Retourne default_command si aucune correction enregistrée.
    """
    try:
        memoire = charger_memoire()
        candidates = [
            m["improved_command"]
            for m in memoire.get("modified_actions", [])
            if m.get("anomaly_type") == anomaly_type and m.get("improved_command")
        ]
        if candidates:
            best = max(set(candidates), key=candidates.count)
            print(f"[ADAPTIVE] 🏆 Commande majoritaire ({candidates.count(best)}/{len(candidates)}) : {best}")
            return best
    except Exception as e:
        print(f"[WARN] get_best_command: {e}")
    return default_command


# ═════════════════════════════════════════════════════════════════════════════
# 🧮 CALCUL DU CONFIDENCE SCORE — [C2]
# ═════════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════
# FIX 1 — agents.py : _compute_confidence() vraiment adaptative
#
# PROBLÈME ACTUEL (dans agents.py) :
#   def _compute_confidence(type_upper, severite, ip):
#       score = 0.5
#       # ← Les ajustements mémoire sont calculés ici (IP suspecte, bad_actions)
#       # ← MAIS ensuite écrasés par des valeurs hardcodées :
#       if "BRUTE" in type_upper:
#           score = 0.90   # ← ÉCRASE tout ce qui précède !
#
# SOLUTION : accumuler les ajustements mémoire APRÈS le score de base,
# pas les écraser. Le score de base est la baseline, la mémoire est un delta.
#
# COMMENT L'INTÉGRER :
#   Dans src/agents/agents.py, remplacez toute la fonction _compute_confidence()
#   par la version ci-dessous.
# ═══════════════════════════════════════════════════════════════════════════

def _compute_confidence(type_upper: str, severite: str, ip: str) -> float:
    """
    Confidence score VRAIMENT adaptatif :
    1. Score de base par type d'attaque (comme avant)
    2. Ajustements mémoire additifs (nouveau — ne s'écrase plus)
    3. Bonus sévérité
    4. Malus si IP non spécifique
    """
    # ── 1. Score de base par type d'attaque ──────────────────────────────────
    if "BRUTE" in type_upper or "SSH" in type_upper:
        score = 0.90
    elif "SCAN" in type_upper or "PORT" in type_upper:
        score = 0.82
    elif "CPU" in type_upper or "SURCHARGE" in type_upper:
        score = 0.75
    elif "MEM" in type_upper or "MEMOIRE" in type_upper or "MÉMOIRE" in type_upper:
        score = 0.72
    elif "USER" in type_upper or "UTILISATEUR" in type_upper:
        score = 0.68
    else:
        score = 0.50

    # ── 2. Ajustements mémoire (additifs sur le score de base) ───────────────
    try:
        memoire = charger_memoire()

        # IP connue comme suspecte → +0.05 (on est plus sûr)
        if ip and ip in memoire.get("ips_suspectes", []):
            score = min(score + 0.05, 1.0)
            print(f"[MEMOIRE] IP connue {ip} → confiance +5%")

        # IP déjà rejetée comme faux positif → -0.20 (méfiance)
        bad_actions = memoire.get("bad_actions", [])
        if any(b.get("ip") == ip for b in bad_actions):
            score = max(score - 0.20, 0.0)
            print(f"[MEMOIRE] IP {ip} déjà faux positif → confiance -20%")

        # Taux de succès historique pour ce type d'attaque
        success = get_success_rate(type_upper)
        if success >= 0.80:
            score = min(score + 0.05, 1.0)
            print(f"[MEMOIRE] success_rate={success:.0%} → confiance +5%")
        elif 0 < success < 0.40:
            score = max(score - 0.10, 0.0)
            print(f"[MEMOIRE] success_rate={success:.0%} → confiance -10%")

        # Knowledge base dynamique : si on a des données sur ce type d'attaque
        dynamic_kb = memoire.get("dynamic_kb", {})
        kb_entries = dynamic_kb.get(type_upper, [])
        if len(kb_entries) >= 5:
            # Assez d'historique pour ajuster
            successes_kb = sum(1 for e in kb_entries if e.get("success"))
            kb_rate = successes_kb / len(kb_entries)
            if kb_rate >= 0.75:
                score = min(score + 0.03, 1.0)
                print(f"[KB_DYN] Taux succès KB={kb_rate:.0%} → confiance +3%")
            elif kb_rate < 0.30:
                score = max(score - 0.08, 0.0)
                print(f"[KB_DYN] Taux succès KB={kb_rate:.0%} → confiance -8%")

    except Exception as e:
        print(f"[WARN] memoire non disponible dans _compute_confidence: {e}")

    # ── 3. Bonus sévérité critique ────────────────────────────────────────────
    if str(severite).upper() == "CRITIQUE":
        score = min(score + 0.05, 1.0)

    # ── 4. Malus si IP non identifiable ──────────────────────────────────────
    if not ip or ip in ("N/A", "multiple", ""):
        score = max(score - 0.15, 0.0)

    return round(score, 2)

def _confidence_label(score: float) -> str:
    if score >= 0.90:  return "TRÈS HAUTE"
    if score >= 0.80:  return "HAUTE"
    if score >= 0.65:  return "MOYENNE"
    return "FAIBLE"


def _get_risque(type_upper: str) -> str:
    if "BRUTE" in type_upper or "SSH" in type_upper:
        return "Compromission potentielle du serveur SSH si aucune action."
    if "SCAN" in type_upper or "PORT" in type_upper:
        return "Cartographie réseau facilitée pour l'attaquant."
    if "CPU" in type_upper or "SURCHARGE" in type_upper:
        return "Dégradation de service, possible attaque DoS."
    if "MEM" in type_upper:
        return "Instabilité système, risque OOM killer."
    if "USER" in type_upper:
        return "Exfiltration de données ou escalade de privilèges."
    return "Impact inconnu — inspection manuelle recommandée."


# ═════════════════════════════════════════════════════════════════════════════
# 📚 BASE DE CONNAISSANCE — [C3]
# ═════════════════════════════════════════════════════════════════════════════

KNOWLEDGE_BASE: dict = {
    "BRUTE-FORCE SSH / CRITIQUE": {
        "action_recommandee": "BLOCAGE_IP_AWS_SECGROUP",
        "commande":           "iptables -A INPUT -s {ip} -j DROP",
        "raison":             "Brute-force détecté avec sévérité critique → blocage immédiat IP attaquante.",
        "risque_si_inaction": "Compromission potentielle du serveur SSH.",
        "apprentissage":      "L'agent enregistre ce pattern pour futures décisions.",
    },
    "BRUTE-FORCE SSH / AVERTISSEMENT": {
        "action_recommandee": "BAN_FAIL2BAN",
        "commande":           "fail2ban-client set sshd banip {ip}",
        "raison":             "Echecs d'authentification répétés → bannissement temporaire via Fail2Ban.",
        "risque_si_inaction": "Escalade possible vers attaque critique.",
        "apprentissage":      "Pattern SSH mineur enregistré dans la base de connaissance.",
    },
    "PORT SCAN": {
        "action_recommandee": "BLACKLIST_IP",
        "commande":           "iptables -A INPUT -s {ip} -j DROP && echo '{ip}' >> /etc/blacklist.txt",
        "raison":             "Scan de ports actif → mise en blacklist préventive.",
        "risque_si_inaction": "Cartographie réseau facilitée pour l'attaquant.",
        "apprentissage":      "Signature de scan ajoutée au profil comportemental.",
    },
    "SURCHARGE CPU": {
        "action_recommandee": "ALERTE_SYSTEME",
        "commande":           "systemctl status --failed && journalctl -p err -n 50",
        "raison":             "Surcharge système détectée → alerte et analyse logs.",
        "risque_si_inaction": "Dégradation de service, possible DoS.",
        "apprentissage":      "Seuil de charge CPU enregistré pour baseline.",
    },
    "PROBLEME MEMOIRE": {
        "action_recommandee": "LIBERER_MEMOIRE",
        "commande":           "sync && echo 3 > /proc/sys/vm/drop_caches",
        "raison":             "Pression mémoire détectée → libération cache Linux.",
        "risque_si_inaction": "OOM killer possible, instabilité système.",
        "apprentissage":      "Seuil RAM critique enregistré.",
    },
    "UTILISATEUR SUSPECT": {
        "action_recommandee": "DESACTIVER_COMPTE",
        "commande":           "usermod -L {user}",
        "raison":             "Comportement utilisateur anormal → verrouillage préventif.",
        "risque_si_inaction": "Exfiltration de données ou escalade de privilèges.",
        "apprentissage":      "Profil comportemental utilisateur mis à jour.",
    },
}


# ═════════════════════════════════════════════════════════════════════════════
# 🔧 HELPER : construire l'action sans exécuter — [C4]
# ═════════════════════════════════════════════════════════════════════════════


# ═════════════════════════════════════════════════════════════════════════════
# 🔧 HELPER : construire l'action sans exécuter — [C4]
# ═════════════════════════════════════════════════════════════════════════════

def _build_action(type_upper: str, ip: str, severite: str, anomalie: dict) -> dict:
    """
    Construit l'action corrective sans l'exécuter.
    get_best_command() injecte automatiquement les corrections apprises
    des décisions admin passées (MODIFY). Le flag 'adaptive' indique
    si la commande a été améliorée par rapport à la valeur par défaut.
    """
    if "BRUTE" in type_upper or "SSH" in type_upper:
        if str(severite).upper() == "CRITIQUE":
            default_cmd = f"iptables -A INPUT -s {ip} -j DROP"
            commande = get_best_command(type_upper, default_cmd)
            return {
                "type":        "BLOCAGE_IP_AWS_SECGROUP",
                "commande":    commande,
                "description": f"Blocage immédiat de {ip} via AWS Security Group (Boto3)",
                "adaptive":    commande != default_cmd,
            }
        else:
            default_cmd = f"fail2ban-client set sshd banip {ip}"
            commande = get_best_command(type_upper, default_cmd)
            return {
                "type":        "BAN_FAIL2BAN",
                "commande":    commande,
                "description": f"Bannissement de {ip} via Fail2Ban",
                "adaptive":    commande != default_cmd,
            }
    elif "SCAN" in type_upper or "PORT" in type_upper:
        default_cmd = f"iptables -A INPUT -s {ip} -j DROP && echo '{ip}' >> /etc/blacklist.txt"
        commande = get_best_command(type_upper, default_cmd)
        return {
            "type":        "BLACKLIST_IP",
            "commande":    commande,
            "description": f"Ajout de {ip} a la blacklist (scan de ports détecté)",
            "adaptive":    commande != default_cmd,
        }
    elif "SURCHARGE" in type_upper or "CPU" in type_upper:
        default_cmd = "systemctl status --failed && journalctl -p err -n 50"
        commande = get_best_command(type_upper, default_cmd)
        return {
            "type":        "ALERTE_SYSTEME",
            "commande":    commande,
            "description": "Alerte système + analyse logs critiques",
            "slack_msg":   "Surcharge système détectée — vérification requise",
            "adaptive":    commande != default_cmd,
        }
    elif "MEMOIRE" in type_upper or "MÉMOIRE" in type_upper or "MEM" in type_upper:
        default_cmd = "sync && echo 3 > /proc/sys/vm/drop_caches"
        commande = get_best_command(type_upper, default_cmd)
        return {
            "type":        "LIBERER_MEMOIRE",
            "commande":    commande,
            "description": "Libération du cache mémoire Linux",
            "adaptive":    commande != default_cmd,
        }
    elif "UTILISATEUR" in type_upper or "USER" in type_upper:
        user = anomalie.get("user", "unknown")
        default_cmd = f"usermod -L {user}"
        commande = get_best_command(type_upper, default_cmd)
        return {
            "type":        "DESACTIVER_COMPTE",
            "commande":    commande,
            "description": f"Compte '{user}' temporairement désactivé (comportement suspect)",
            "adaptive":    commande != default_cmd,
        }
    else:
        return {
            "type":        "INSPECTION_MANUELLE",
            "description": "Anomalie non reconnue — inspection manuelle requise",
            "adaptive":    False,
        }


from crewai import LLM

_original_llm_call = LLM.call

def _throttled_llm_call(self, *args, **kwargs):
    _last_llm_call = [0.0]
    elapsed = time.time() - _last_llm_call[0]
    from app.core.config.config import MIN_DELAY_SECONDS as _MIN_DELAY_SECONDS
    if elapsed < _MIN_DELAY_SECONDS:
        wait = _MIN_DELAY_SECONDS - elapsed
        print(f"[THROTTLE] Waiting {wait:.1f}s (Groq 6k TPM guard)...")
        time.sleep(wait)
    _last_llm_call[0] = time.time()
    for attempt in range(3):
        try:
            return _original_llm_call(self, *args, **kwargs)
        except Exception as exc:
            err = str(exc).lower()
            if "rate_limit" in err or "ratelimit" in err or "429" in err:
                backoff = 30 * (attempt + 1)
                print(f"[THROTTLE] RateLimitError (tentative {attempt+1}/3) — backoff {backoff}s")
                time.sleep(backoff)
                _last_llm_call[0] = time.time()
                if attempt == 2:
                    raise
            else:
                raise

llm.__class__.call = _throttled_llm_call

def _throttle():
    pass


# ================================
# DISPATCHER MCP
# ================================
def _appeler_mcp(nom_outil: str, arguments: dict) -> str:
    try:
        if nom_outil == "lire_logs_s3":
            if not _S3_DISPONIBLE:
                return "[SIMULATION] lire_logs_s3 — s3_tools non disponible"
            fichier = arguments.get("fichier") or arguments.get("key")
            try:
                contenu = s3_tools.read_object(fichier)
                return f"Logs récupérés depuis S3 (extrait):\n{contenu[:1200]}"
            except Exception as e:
                return f"Erreur lecture S3: {e}"

        if nom_outil == "lister_logs_s3":
            if not _S3_DISPONIBLE:
                return "[SIMULATION] lister_logs_s3 — s3_tools non disponible"
            try:
                prefix   = arguments.get("prefix")
                fichiers = s3_tools.list_objects(prefix=prefix) if prefix else s3_tools.list_objects()
                fichiers = fichiers[:20]
                return "Fichiers disponibles dans S3:\n" + "\n".join(fichiers)
            except Exception as e:
                return f"Erreur listage S3: {e}"

        if nom_outil == "analyser_logs":
            logs   = arguments.get("contenu_logs") or arguments.get("contenu") or ""
            lignes = logs.split("\n")
            erreurs, warnings, ssh = [], [], []
            for ligne in lignes:
                ll = ligne.lower()
                if "error" in ll or "failed" in ll:
                    erreurs.append(ligne[:200])
                elif "warning" in ll or "warn" in ll:
                    warnings.append(ligne[:200])
                elif "ssh" in ll or "accepted" in ll:
                    ssh.append(ligne[:200])
            return (
                "ANALYSE DES LOGS:\n"
                f"- Total lignes: {len(lignes)}\n"
                f"- Erreurs: {len(erreurs)}\n"
                f"- Warnings: {len(warnings)}\n"
                f"- Connexions SSH: {len(ssh)}\n"
                "Top erreurs:\n" + "\n".join(erreurs[:3])
            )

        if nom_outil == "detecter_anomalies":
            donnees   = str(arguments.get("donnees") or arguments.get("rapport") or arguments.get("contenu_logs") or "")
            donnees_l = donnees.lower()
            anomalies = []
            if "error" in donnees_l:
                nb = donnees_l.count("error")
                if nb > 3:
                    anomalies.append(f"CRITIQUE: {nb} erreurs detectees")
            if "failed password" in donnees_l:
                anomalies.append("SECURITE: Tentatives de connexion echouees detectees")
            if "invalid user" in donnees_l:
                anomalies.append("INTRUSION: Utilisateur invalide detecte")
            if "out of memory" in donnees_l:
                anomalies.append("MEMOIRE: Probleme memoire detecte")
            if not anomalies:
                anomalies.append("OK: Aucune anomalie critique detectee")
            return "ANOMALIES DETECTEES:\n" + "\n".join(anomalies)

        if nom_outil == "sauvegarder_rapport_s3":
            if not _S3_DISPONIBLE:
                return "Rapport sauvegardé."
            try:
                contenu     = arguments.get("contenu") or arguments.get("rapport_json") or ""
                nom_fichier = arguments.get(
                    "nom_fichier",
                    f"rapport_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
                )
                s3_tools.save_report(content=contenu, key=f"rapports/{nom_fichier}")
                return f"Rapport sauvegarde sur S3: rapports/{nom_fichier}"
            except Exception as e:
                return f"Erreur sauvegarde S3: {e}"

        if nom_outil == "run_ssh_command":
            if not _LINUX_TOOLS_DISPONIBLE:
                return "[SIMULATION] run_ssh_command — linux_tools non disponible"
            try:
                return linux_tools.run_ssh_command(
                    host=arguments.get("host"),
                    username=arguments.get("username"),
                    password=arguments.get("password"),
                    key_path=arguments.get("key_path"),
                    command=arguments.get("command"),
                    port=arguments.get("port", 22),
                )
            except Exception as e:
                return f"Erreur SSH: {e}"

        if nom_outil == "get_system_metrics":
            if not _LINUX_TOOLS_DISPONIBLE:
                return "[SIMULATION] get_system_metrics — linux_tools non disponible"
            try:
                metrics = linux_tools.get_system_metrics(
                    host=arguments.get("host"),
                    username=arguments.get("username"),
                    password=arguments.get("password"),
                    key_path=arguments.get("key_path"),
                    port=arguments.get("port", 22),
                )
                return json.dumps(metrics, indent=2)
            except Exception as e:
                return f"Erreur métriques SSH: {e}"

        if nom_outil == "orchestrer_pipeline":
            contexte = arguments.get("contexte", "")
            return f"Orchestration OK. Contexte: {contexte[:200]}"

        return f"Outil inconnu: {nom_outil}"

    except Exception as e:
        return f"Erreur dispatcher MCP: {type(e).__name__}: {e}"


# ================================
# SCHÉMAS PYDANTIC
# ================================
class ListerLogsInput(BaseModel):
    prefix: Optional[str] = Field(default=None, description="Préfixe S3 optionnel")

class LireLogsInput(BaseModel):
    fichier: Optional[str] = Field(default=None, description="Nom du fichier log à lire depuis S3")

class AnalyserLogsInput(BaseModel):
    contenu: Optional[str] = Field(default=None, description="Contenu des logs à analyser")

class DetecterAnomaliesInput(BaseModel):
    rapport: Optional[str] = Field(default=None, description="Rapport ou logs à analyser pour détecter les anomalies")

class AlarmeInput(BaseModel):
    alarmes_json: Optional[str] = Field(
        default="[]",
        description=(
            "Alarmes sérialisées en JSON string. "
            "TOUJOURS passer une string, jamais un array. "
            "Exemple sans alarme: '[]'."
        )
    )

    @field_validator("alarmes_json", mode="before")
    @classmethod
    def coerce_to_str(cls, v):
        if isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False)
        if v is None:
            return "[]"
        return str(v)

class ActionCorrectiveInput(BaseModel):
    anomalie_json: Optional[str] = Field(
        default=None,
        description="Anomalie détectée en JSON string avec type, IP, sévérité"
    )

    @field_validator("anomalie_json", mode="before")
    @classmethod
    def coerce_to_str(cls, v):
        if isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False)
        if v is None:
            return None
        return str(v)

class OrchestrationInput(BaseModel):
    contexte: Optional[str] = Field(
        default=None,
        description="Contexte global de la session d'analyse pour coordonner les agents"
    )

class SauvegarderRapportInput(BaseModel):
    rapport_json: Optional[str] = Field(
        default=None,
        description="Le rapport COMPLET sérialisé en une seule string JSON"
    )


# ================================
# CLASSES D'OUTILS
# ================================

class OutilListerLogs(BaseTool):
    name: str = "lister_logs_s3"
    description: str = (
        "Liste les fichiers dans S3. "
        "Utilise toujours prefix='processed/' car c'est là que sont les fichiers."
    )
    args_schema: type[BaseModel] = ListerLogsInput

    def _run(self, prefix: Optional[str] = None, **kwargs) -> str:
        prefix = "processed/"
        result = _appeler_mcp("lister_logs_s3", {"prefix": prefix})
        lignes = [l for l in result.splitlines() if "dataset_" in l]
        return "Fichiers datasets S3:\n" + "\n".join(lignes[:5])


class OutilLireLogs(BaseTool):
    name: str = "lire_logs_s3"
    description: str = (
        "Lit un fichier log depuis S3. "
        "Le fichier doit commencer par 'processed/' ex: 'processed/erreurs_par_heure.csv'"
    )
    args_schema: type[BaseModel] = LireLogsInput

    def _run(self, fichier: Optional[str] = None, **kwargs) -> str:
        if fichier and fichier.startswith("logs/"):
            fichier = fichier.replace("logs/", "", 1)
        resultat = _appeler_mcp("lire_logs_s3", {"fichier": fichier})
        if len(resultat) > 300:
            lignes = resultat.split("\n")[:12]
            return "\n".join(lignes) + "\n... [tronqué à 12 lignes]"
        return resultat


class OutilAnalyserLogs(BaseTool):
    """[B4] Version enrichie : 8 types d'attaques détectés."""
    name: str = "analyser_logs"
    description: str = (
        "Analyse les logs et compte tous les types d'attaques et événements suspects : "
        "SSH brute-force, scan de ports, énumération web, blocages firewall, "
        "échecs d'auth, abus sudo, problèmes mémoire, services en échec."
    )
    args_schema: type[BaseModel] = AnalyserLogsInput

    def _run(self, contenu: Optional[str] = None, **kwargs) -> str:
        if not contenu:
            return "Aucun contenu à analyser"

        lignes = contenu.splitlines()
        compteurs = {
            "SSH_BRUTE_FORCE":  0,
            "PORT_SCAN":        0,
            "WEB_ENUMERATION":  0,
            "FIREWALL_BLOCK":   0,
            "AUTH_FAILURE":     0,
            "SUDO_ABUSE":       0,
            "MEMORY_CRITICAL":  0,
            "SERVICE_FAILED":   0,
        }

        for ligne in lignes:
            l = ligne.upper()
            if "FAILED PASSWORD" in l or "INVALID USER" in l or "BRUTE" in l:
                compteurs["SSH_BRUTE_FORCE"] += 1
            if "NMAP" in l or "PORT SCAN" in l or "MASSCAN" in l:
                compteurs["PORT_SCAN"] += 1
            if "GOBUSTER" in l or "ENUMERATION" in l or "DIRB" in l:
                compteurs["WEB_ENUMERATION"] += 1
            if "UFW BLOCK" in l or "IPTABLES" in l or "DENIED" in l:
                compteurs["FIREWALL_BLOCK"] += 1
            if "AUTHENTICATION FAILURE" in l or "PERM DENIED" in l:
                compteurs["AUTH_FAILURE"] += 1
            if "SUDO" in l and "COMMAND" in l:
                compteurs["SUDO_ABUSE"] += 1
            if "OUT OF MEMORY" in l or "OOM" in l:
                compteurs["MEMORY_CRITICAL"] += 1
            if "FAILED" in l and "SERVICE" in l:
                compteurs["SERVICE_FAILED"] += 1

        rapport = "=== RAPPORT D'ANALYSE ===\n"
        for type_attaque, nombre in compteurs.items():
            if nombre > 0:
                rapport += f"{type_attaque}: {nombre} occurrence(s)\n"

        total = sum(compteurs.values())
        rapport += f"\nTOTAL ÉVÉNEMENTS SUSPECTS : {total}"
        return rapport


class OutilDetecterAnomalies(BaseTool):
    name: str = "detecter_anomalies"
    description: str = (
        "Détecte les intrusions SSH, surcharges système et comportements suspects. "
        "Déclenche automatiquement une alarme préventive avec un message adapté "
        "au type d'anomalie AVANT que la panne survienne."
    )
    args_schema: type[BaseModel] = DetecterAnomaliesInput

    def _run(self, rapport: Optional[str] = None, **kwargs) -> str:
        return _appeler_mcp("detecter_anomalies", {"contenu_logs": rapport or str(kwargs)})


class OutilDeclencherAlarme(BaseTool):
    name: str = "declencher_alarme"
    description: str = (
        "Déclenche une alarme préventive AVANT qu'une panne survienne. "
        "Si alarmes_json vaut 'Aucune alarme critique' ou est vide, "
        "NE PAS déclencher d'alarme — retourner un statut OK."
    )
    args_schema: type[BaseModel] = AlarmeInput

    def _run(self, alarmes_json: Optional[str] = None, **kwargs) -> str:
        # [B3] Flag anti-boucle : une seule alarme par cycle
        global _alarme_declenchee_ce_cycle
        if _alarme_declenchee_ce_cycle:
            return "Alarme déjà traitée dans ce cycle — ignoré."
        _alarme_declenchee_ce_cycle = True

        if not alarmes_json or alarmes_json.strip() in (
            "Aucune alarme critique", "[]", "", "null", "aucune", "none"
        ):
            return "Aucune alarme à déclencher — système en état normal."

        try:
            if isinstance(alarmes_json, (list, dict)):
                alarmes = alarmes_json if isinstance(alarmes_json, list) else [alarmes_json]
            else:
                alarmes = json.loads(alarmes_json) if alarmes_json else []
                if not isinstance(alarmes, list):
                    alarmes = [alarmes]
        except Exception:
            texte_upper = alarmes_json.upper()
            mots_cles_reels = ["BRUTE", "SCAN", "INTRUSION", "CRITIQUE", "BLOCAGE"]
            if not any(m in texte_upper for m in mots_cles_reels):
                return "Pas d'anomalie confirmée dans le message reçu."
            alarmes = [{
                "type":     "ANOMALIE",
                "message":  alarmes_json,
                "severite": "AVERTISSEMENT",
                "ip":       "multiple"
            }]

        resultats = []
        for alarme in alarmes:
            type_alarme = alarme.get("type", "ANOMALIE")
            message     = alarme.get("message", "Anomalie détectée")
            severite    = alarme.get("severite", "AVERTISSEMENT")
            ip          = alarme.get("ip", "N/A")

            if "BRUTE-FORCE" in type_alarme.upper() or "SSH" in type_alarme.upper():
                notification = (
                    f"ALARME SÉCURITÉ — BRUTE-FORCE SSH DÉTECTÉ\n"
                    f"IP Source: {ip}\nDétail: {message}\n"
                    f"Action immédiate requise: Bloquer {ip} via iptables/Fail2Ban"
                )
            elif "SURCHARGE" in type_alarme.upper() or "CPU" in type_alarme.upper():
                notification = (
                    f"ALARME PERFORMANCE — SURCHARGE SYSTÈME DÉTECTÉE\n"
                    f"Détail: {message}\n"
                    f"Action immédiate requise: Vérifier les processus"
                )
            elif "MÉMOIRE" in type_alarme.upper() or "RAM" in type_alarme.upper():
                notification = (
                    f"ALARME RESSOURCES — SATURATION MÉMOIRE DÉTECTÉE\n"
                    f"Détail: {message}\n"
                    f"Action immédiate requise: Libérer la RAM"
                )
            elif "SCAN" in type_alarme.upper() or "PORT" in type_alarme.upper():
                notification = (
                    f"ALARME RECONNAISSANCE — SCAN DE PORTS DÉTECTÉ\n"
                    f"IP Source: {ip}\nDétail: {message}\n"
                    f"Action immédiate requise: Ajouter {ip} à la blacklist"
                )
            else:
                notification = (
                    f"ALARME GÉNÉRALE — {severite}\n"
                    f"Détail: {message}\n"
                    f"Action immédiate requise: Inspection manuelle"
                )

            print(f"\n{'='*60}")
            print(notification)
            print(f"{'='*60}\n")

            ip_safe = str(ip).replace(".", "_").replace("/", "_")
            result  = _appeler_mcp("sauvegarder_rapport_s3", {
                "contenu":     notification,
                "nom_fichier": f"alarme_{ip_safe}.json",
                "type":        "alarme",
            })

            # ✅ [FIX-1] broadcast_alarm correctement indenté dans la boucle for alarme
            # ✅ [FIX-3] server_id propagé depuis l'alarme vers le WebSocket
            try:
                from api_auth import broadcast_alarm
                broadcast_alarm({
                    "type":      type_alarme,
                    "source_ip": ip,
                    "severity":  severite,
                    "message":   message,
                    "engine":    type_alarme.split("-")[0].split("_")[0].upper(),
                    "server_id": str(alarme.get("server_id") or alarme.get("Serveur") or "auth"),
                })
            except Exception as e:
                print(f"[WS][WARN] broadcast depuis declencher_alarme échoué: {e}")

            resultats.append(f"Alarme envoyée: {notification[:100]}... | S3: {result}")

        return "\n".join(resultats) if resultats else "Aucune alarme déclenchée."


class OutilActionCorrective(BaseTool):
    name: str = "appliquer_action_corrective"
    description: str = (
        "Agent correcteur semi-automatique — analyse l'anomalie, calcule un confidence score, "
        "puis selon le mode actif (TRAINING / SUGGESTION / AUTO) : "
        "apprend sans agir, suggère à l'administrateur, ou exécute automatiquement si confiance >= 0.85."
    )
    args_schema: type[BaseModel] = ActionCorrectiveInput

    def _run(self, anomalie_json: Optional[str] = None, **kwargs) -> str:
        if isinstance(anomalie_json, (dict, list)):
            anomalie_json = json.dumps(anomalie_json, ensure_ascii=False)

        try:
            anomalie = json.loads(anomalie_json) if anomalie_json else {}
        except Exception:
            texte       = (anomalie_json or "")
            texte_upper = texte.upper()
            ip_trouvee  = "multiple"
            match = re.search(r'\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b', texte)
            if match:
                ip_trouvee = match.group(1)
            if "BRUTE" in texte_upper or "SSH" in texte_upper or "BLOCAGE" in texte_upper:
                anomalie = {"type": "BRUTE-FORCE SSH", "severite": "CRITIQUE",      "ip": ip_trouvee}
            elif "CPU" in texte_upper or "SURCHARGE" in texte_upper:
                anomalie = {"type": "SURCHARGE CPU",   "severite": "AVERTISSEMENT", "ip": "N/A"}
            elif "SCAN" in texte_upper or "PORT" in texte_upper:
                anomalie = {"type": "PORT SCAN",       "severite": "AVERTISSEMENT", "ip": ip_trouvee}
            elif "WATCHLIST" in texte_upper:
                anomalie = {"type": "WATCHLIST",       "severite": "AVERTISSEMENT", "ip": ip_trouvee}
            else:
                anomalie = {"description": str(anomalie_json)}

        type_anomalie = anomalie.get("type", anomalie.get("feature", ""))
        ip            = anomalie.get("ip", "N/A")
        severite      = anomalie.get("severite", "AVERTISSEMENT")
        action_req    = anomalie.get("action", "")
        type_upper    = str(type_anomalie).upper()
        action_upper  = str(action_req).upper()
        timestamp     = datetime.now().isoformat()

        # ── [B2] SURVEILLANCE_NORMALE — jamais d'action ───────────────────────
        if (
            "SURVEILLANCE" in type_upper
            or "NORMALE" in type_upper
            or "MONITORING" in action_upper
            or (
                type_upper in ("", "FAIBLE", "INFO")
                and severite in ("FAIBLE", "INFO", "NORMAL")
            )
        ):
            result = {
                "mode":        AGENT_MODE,
                "type":        "SURVEILLANCE_NORMALE",
                "statut":      "OK",
                "executed":    False,
                "timestamp":   timestamp,
                "description": "Système en surveillance normale — aucune action corrective requise.",
                "message":     "Aucune attaque active confirmée. Monitoring passif actif.",
                "details": {
                    "ip":       ip,
                    "severite": severite,
                    "message":  "Aucune attaque active confirmée. Monitoring passif actif.",
                    "conseil":  "Continuer la surveillance. Prochain cycle d'analyse prévu automatiquement."
                }
            }
            print(f"[ACTION CORRECTIVE] {result['description']}")
            result_str = json.dumps(result, ensure_ascii=False, indent=2)
            _appeler_mcp("sauvegarder_rapport_s3", {
                "contenu":     result_str,
                "nom_fichier": "action_surveillance-normale.json",
                "type":        "action_corrective",
            })
            return result_str

        # ── Actions préventives analytiques (pas de blocage auto) ─────────────
        if (
            "ALERT_HIGH_PRIORITY" in type_upper
            or "TRAFFIC_THROTTLE" in type_upper
            or "PREEMPTIVE_BLOCK" in type_upper
            or "PRE_ATTACK" in type_upper
            or "IMMINENT_DATA_EXFIL" in type_upper
        ):
            action = {
                "type":        "RECOMMANDATION_PREVENTIVE",
                "commande":    "",
                "description": (
                    f"Action préventive recommandée ({type_anomalie}). "
                    "Aucune exécution automatique."
                ),
                "statut":      "EN_ATTENTE",
            }
            result_str  = json.dumps(action, ensure_ascii=False, indent=2)
            nom_fichier = f"action_{action['type'].lower().replace('_', '-')}.json"
            _appeler_mcp("sauvegarder_rapport_s3", {
                "contenu":     json.dumps(action, ensure_ascii=False),
                "nom_fichier": nom_fichier,
                "type":        "action_corrective",
            })
            return result_str

        # ── [C2] Calcul confidence score ──────────────────────────────────────
        confidence = _compute_confidence(type_upper, severite, ip)

        # ── [C4] Construction de l'action (sans l'exécuter) ──────────────────
        action = _build_action(type_upper, ip, severite, anomalie)

        # ═══════════════════════════════════════════════════════════════════
        # Phase 1 — TRAINING
        # ═══════════════════════════════════════════════════════════════════
        if AGENT_MODE == "TRAINING":
            kb_key   = f"{type_anomalie} / {severite}".upper()
            kb_entry = KNOWLEDGE_BASE.get(kb_key, KNOWLEDGE_BASE.get(
                next((k for k in KNOWLEDGE_BASE if k.split("/")[0].strip() in type_upper), ""),
                None
            ))
            result = {
                "mode":              "TRAINING",
                "phase":             "Phase 1 — Apprentissage supervisé",
                "executed":          False,
                "timestamp":         timestamp,
                "anomalie_recue":    anomalie,
                "action_apprise":    action,
                "confidence":        confidence,
                "connaissance_base": kb_entry,
                "message": (
                    "Agent en phase d'apprentissage. "
                    "L'action corrective est calculée et enregistrée, "
                    "mais AUCUNE exécution n'a lieu. "
                    "Validez ou corrigez pour enrichir la base de connaissance."
                ),
                "instruction_admin": (
                    f"ACTION PROPOSEE : {action.get('type')} | "
                    f"CONFIANCE : {confidence:.0%} | "
                    f"Validez via /api/corrective/validate si correct."
                ),
            }
            print(f"[TRAINING] {action.get('type')} | confiance={confidence:.0%} | NON EXECUTE")
            _appeler_mcp("sauvegarder_rapport_s3", {
                "contenu":     json.dumps(result, ensure_ascii=False),
                "nom_fichier": f"training_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
                "type":        "training_log",
            })
            return json.dumps(result, ensure_ascii=False, indent=2)

        # ═══════════════════════════════════════════════════════════════════
        # Phase 2 — SUGGESTION
        # ═══════════════════════════════════════════════════════════════════
        if AGENT_MODE == "SUGGESTION":
            result = {
                "mode":             "SUGGESTION",
                "phase":            "Phase 2 — Human-in-the-Loop",
                "executed":         False,
                "timestamp":        timestamp,
                "anomalie":         anomalie,
                "action_suggeree":  action,
                "confidence":       confidence,
                "confidence_label": _confidence_label(confidence),
                "message": (
                    f"Suggestion générée avec une confiance de {confidence:.0%}. "
                    "L'administrateur doit valider avant toute exécution."
                ),
                "validation_url":  "/api/corrective/validate",
                "risque_inaction": _get_risque(type_upper),
            }
            print(f"[SUGGESTION] {action.get('type')} | IP={ip} | confiance={confidence:.0%} | EN ATTENTE VALIDATION")

            # [C5] Broadcast WebSocket vers le dashboard
            try:
                from api_auth import broadcast_alarm
                broadcast_alarm({
                    "type":              "CORRECTIVE_SUGGESTION",
                    "source_ip":         ip,
                    "severity":          "CRITICAL" if str(severite).upper() == "CRITIQUE" else "HIGH",
                    "action":            action.get("type", ""),
                    "confidence":        confidence,
                    "mode":              AGENT_MODE,
                    "message":           f"[SUGGESTION] {action.get('description', '')}",
                    "human_insight": (
                        f"Agent suggere : {action.get('type')} | "
                        f"Confiance : {confidence:.0%} | Validation requise."
                    ),
                    "suggestion_payload": result,
                })
            except Exception as e:
                print(f"[WS][WARN] Broadcast suggestion échoué : {e}")

            # ✅ [FIX-2] POST vers /api/corrective/suggestion correctement indenté
            # dans le bloc SUGGESTION — remplit _pending_suggestions pour le frontend
            try:
                import requests as _req
                _req.post(
                    "http://localhost:8000/api/corrective/suggestion",
                    json={
                        "anomaly_type": str(type_anomalie),
                        "ip":           str(ip),
                        "severity":     str(severite),
                        "action_type":  str(action.get("type", "")),
                        "command":      str(action.get("commande", "")),
                        "description":  str(action.get("description", "")),
                        "confidence":   float(confidence),
                        "mode":         AGENT_MODE,
                        "timestamp":    timestamp,
                    },
                    timeout=5,
                )
                print(f"[SUGGESTION] Enregistrée dans /api/corrective/suggestions")
            except Exception as e:
                print(f"[CORRECTIVE][WARN] Enregistrement suggestion échoué : {e}")

            # [C6] Sauvegarde S3 suggestion_log
            _appeler_mcp("sauvegarder_rapport_s3", {
                "contenu":     json.dumps(result, ensure_ascii=False),
                "nom_fichier": f"suggestion_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
                "type":        "suggestion_log",
            })
            return json.dumps(result, ensure_ascii=False, indent=2)

        # ═══════════════════════════════════════════════════════════════════
        # Phase 3 — AUTO
        # ═══════════════════════════════════════════════════════════════════

        # ═══════════════════════════════════════════════════════════════════
        # Phase 3 — AUTO
        # ═══════════════════════════════════════════════════════════════════
        if AGENT_MODE == "AUTO":

            success_rate = get_success_rate(type_upper)

            # Condition d'exécution automatique :
            # confiance suffisante ET taux de succès historique >= 80 %
            # Si aucun historique (success_rate == 0.0) → on laisse passer
            auto_ok = (
                confidence >= CONFIDENCE_THRESHOLD_AUTO
                and (success_rate >= 0.80 or success_rate == 0.0)
            )

            if not auto_ok:
                if confidence < CONFIDENCE_THRESHOLD_AUTO:
                    raison = f"Confidence {confidence:.0%} < seuil {CONFIDENCE_THRESHOLD_AUTO:.0%}"
                else:
                    raison = f"success_rate={success_rate:.0%} < 80 % — trop d'erreurs passées"

                result = {
                    "mode":            "AUTO_BLOCKED",
                    "phase":           "Phase 3 — Auto (bloqué)",
                    "executed":        False,
                    "timestamp":       timestamp,
                    "reason":          raison,
                    "confidence":      confidence,
                    "success_rate":    success_rate,
                    "action_suggeree": action,
                    "message": (
                        f"Exécution automatique bloquée : {raison}. "
                        "Suggestion transmise à l'administrateur."
                    ),
                    "validation_url":  "/api/corrective/validate",
                }
                print(f"[AUTO_BLOCKED] {raison}")
                try:
                    from api_auth import broadcast_alarm
                    broadcast_alarm({
                        "type":               "CORRECTIVE_SUGGESTION",
                        "source_ip":          ip,
                        "severity":           "HIGH",
                        "action":             action.get("type", ""),
                        "confidence":         confidence,
                        "success_rate":       success_rate,
                        "mode":               "AUTO_BLOCKED",
                        "message":            f"[AUTO-BLOQUE] {action.get('description', '')}",
                        "human_insight":      f"{raison}. Validation requise.",
                        "suggestion_payload": result,
                    })
                except Exception as e:
                    print(f"[WS][WARN] Broadcast auto-blocked échoué : {e}")
                return json.dumps(result, ensure_ascii=False, indent=2)

            # ── Confiance ET success_rate suffisants → exécution réelle ──────
            action["statut"]       = "EXÉCUTÉ"
            action["executed"]     = True
            action["timestamp"]    = timestamp
            action["confidence"]   = confidence
            action["success_rate"] = success_rate

            # Enregistrement de l'action automatique comme APPROVE dans les stats
            enregistrer_stat_action(type_upper, "approved")

            print(f"[AUTO] {action.get('type')} | IP={ip} | confiance={confidence:.0%} | EXECUTION")
            if "commande" in action:
                print(f"[COMMANDE] {action['commande']}")

            est_ssh       = "BRUTE" in type_upper or "SSH" in type_upper
            ip_specifique = ip and ip not in ("N/A", "multiple", "")

            if AWS_SECURITY_DISPONIBLE and est_ssh and ip_specifique and str(severite).upper() == "CRITIQUE":
                print(f"\n[AWS BOTO3] Blocage RÉEL de {ip} dans Security Group AWS...")
                try:
                    aws_result = bloquer_ip_secgroup(
                        ip=ip,
                        raison=(
                            f"Agent IA CrewAI | {type_anomalie} | "
                            f"Sévérité: {severite} | Auto-blocage | confiance={confidence:.0%}"
                        )
                    )
                    action["aws_blocage_reel"] = aws_result
                    action["aws_statut"]       = aws_result.get("statut", "INCONNU")
                    action["statut"]           = "EXÉCUTÉ"
                    print(f"[AWS BOTO3] Résultat  : {aws_result.get('message', 'N/A')}")
                    print(f"[AWS BOTO3] SG statut : {aws_result.get('statut')}")
                    if aws_result.get("regles_supprimees"):
                        print(f"[AWS BOTO3] Règles supprimées : {aws_result['regles_supprimees']}")
                    if aws_result.get("tag_audit"):
                        print(f"[AWS BOTO3] Audit trail : {aws_result['tag_audit']}")
                    if aws_result.get("nacl_regle", {}).get("statut") == "DENY_AJOUTÉ":
                        nacl_info = aws_result["nacl_regle"]
                        print(f"[AWS BOTO3] NACL DENY #{nacl_info['rule_number']} ajoutée dans {nacl_info['nacl_id']}")
                except Exception as e:
                    print(f"[AWS BOTO3] Erreur boto3: {type(e).__name__}: {e}")
                    action["aws_blocage_reel"] = {"statut": "ERREUR", "message": str(e)}
                    action["statut"]           = "ERREUR_AWS"
            elif AWS_SECURITY_DISPONIBLE and est_ssh and not ip_specifique:
                print(f"[AWS BOTO3] IP '{ip}' non spécifique — blocage manuel requis")
                action["aws_blocage_reel"] = {
                    "statut":  "IGNORÉ",
                    "raison":  f"IP '{ip}' non spécifique — impossible de bloquer automatiquement",
                    "conseil": "Identifiez les IPs précises et appelez bloquer_ip_secgroup() manuellement",
                }
            elif not AWS_SECURITY_DISPONIBLE:
                action["aws_blocage_reel"] = {
                    "statut":  "SIMULATION",
                    "message": "aws_security.py non importé — configurez AWS_SECURITY_GROUP_ID dans .env",
                }

            result = {
                "mode":       "AUTO",
                "phase":      "Phase 3 — Automatisation conditionnelle",
                "executed":   True,
                "timestamp":  timestamp,
                "action":     action,
                "confidence": confidence,
                "success_rate": success_rate,
                "message":    f"Action automatique exécutée (confiance={confidence:.0%} >= seuil {CONFIDENCE_THRESHOLD_AUTO:.0%})",
            }
            nom_fichier = f"auto_action_{action['type'].lower().replace('_', '-')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            _appeler_mcp("sauvegarder_rapport_s3", {
                "contenu":     json.dumps(result, ensure_ascii=False),
                "nom_fichier": nom_fichier,
                "type":        "auto_action_log",
            })
            return json.dumps(result, ensure_ascii=False, indent=2)

        # Mode inconnu → fallback sécurisé
        return json.dumps({
            "mode":     AGENT_MODE,
            "error":    f"Mode inconnu : {AGENT_MODE}. Valeurs acceptées : TRAINING, SUGGESTION, AUTO.",
            "executed": False,
        }, indent=2)


class OutilOrchestration(BaseTool):
    name: str = "orchestrer_pipeline"
    description: str = "Coordonne et priorise le travail des 5 autres agents."
    args_schema: type[BaseModel] = OrchestrationInput

    def _run(self, contexte: Optional[str] = None, **kwargs) -> str:
        result = _appeler_mcp("orchestrer_pipeline", {"contexte": contexte or str(kwargs)})
        return result if isinstance(result, str) and result.strip() else "Pipeline orchestré avec succès."


class OutilSauvegarderRapport(BaseTool):
    name: str = "sauvegarder_rapport_s3"
    description: str = (
        "Sauvegarde le rapport final complet sur S3. "
        "Sérialise TOUT le rapport en JSON string et le passe dans rapport_json."
    )
    args_schema: type[BaseModel] = SauvegarderRapportInput

    def _run(self, rapport_json: Optional[str] = None, **kwargs) -> str:
        try:
            data = json.loads(rapport_json) if isinstance(rapport_json, str) else {}
        except Exception:
            data = {}

        data["contenu"]     = rapport_json or str(kwargs)
        data["nom_fichier"] = f"rapport_{data.get('timestamp', 'final')}.json"

        return _appeler_mcp(
            "sauvegarder_rapport_s3",
            data or {
                "contenu":     str(kwargs),
                "nom_fichier": "rapport_final.json"
            }
        )


# ================================
# INSTANCES DES OUTILS
# ================================
outil_lister_logs  = OutilListerLogs()
outil_lire_logs    = OutilLireLogs()
outil_analyser     = OutilAnalyserLogs()
outil_anomalies    = OutilDetecterAnomalies()
outil_alarme       = OutilDeclencherAlarme()
outil_correctif    = OutilActionCorrective()
outil_orchestrer   = OutilOrchestration()
outil_rapport      = OutilSauvegarderRapport()


# ================================
# 6 AGENTS SPÉCIALISÉS
# ================================

collector_agent = Agent(
    role="Collecteur de Logs",
    goal=(
        "Collecter de manière exhaustive tous les fichiers logs depuis Amazon S3 "
        "et assurer la disponibilité des données pour les agents suivants."
    ),
    backstory=(
        "Tu es un expert en collecte de données système. Tu maîtrises parfaitement "
        "Amazon S3 et récupères les logs des serveurs Linux (syslog, auth.log) "
        "ainsi que les logs d'attaques générés par la VM Kali Linux."
    ),
    tools=[outil_lister_logs, outil_lire_logs],
    llm=llm,
    verbose=True,
    max_iter=2,
    max_retry_limit=1,
)

analyst_agent = Agent(
    role="Analyste de Logs Linux",
    goal=(
        "Analyser en profondeur les logs pour identifier tous les types "
        "d'attaques et événements suspects, compter les erreurs et connexions SSH, "
        "et prédire les tendances futures."
    ),
    backstory=(
        "Tu es un expert en analyse de logs Linux et en cybersécurité. "
        "Tu distingues les erreurs critiques des simples warnings, "
        "identifies les patterns suspects et anticipes les tendances "
        "grâce à une analyse statistique rigoureuse."
    ),
    tools=[outil_analyser],
    llm=llm_analyst,
    verbose=True,
    max_iter=2,
    max_retry_limit=1,
)

detector_agent = Agent(
    role="Détecteur d'Anomalies et Déclencheur d'Alarmes",
    goal=(
        "Détecter les anomalies confirmées et déclencher une alarme UNIQUEMENT "
        "si une vraie menace est présente. Ne pas déclencher d'alarme si le "
        "système est en état normal."
    ),
    backstory=(
        "Tu es un expert en cybersécurité et détection d'anomalies. "
        "Tu identifies en temps réel les tentatives d'intrusion SSH, "
        "les surcharges système, les scans de ports et les comportements anormaux. "
        "Tu déclenches des alarmes SEULEMENT quand une anomalie réelle est confirmée. "
        "Si nb_anomalies=0 et aucune alarme critique, tu retournes un statut OK "
        "sans déclencher d'alarme."
    ),
    tools=[outil_anomalies, outil_alarme],
    llm=llm,
    verbose=True,
    max_iter=1,           # [B5] Évite les boucles infinies sur le détecteur
    max_retry_limit=1,
)

corrector_agent = Agent(
    role="Agent Correcteur Semi-Automatique",
    goal=(
        "Analyser chaque anomalie détectée, calculer le confidence score, "
        "puis selon le mode actif (TRAINING / SUGGESTION / AUTO) : "
        "apprendre sans agir, suggérer à l'administrateur pour validation, "
        "ou exécuter automatiquement si la confiance est suffisante (>= 85%). "
        "En mode surveillance normale, confirmer l'état OK sans aucune action."
    ),
    backstory=(
        "Tu es un expert en remédiation semi-automatique de sécurité informatique. "
        "Tu opères en 3 phases évolutives : Phase 1 (TRAINING) — tu observes et apprends "
        "sans jamais agir; Phase 2 (SUGGESTION) — tu proposes des actions correctives "
        "à l'administrateur qui valide avant toute exécution (Human-in-the-Loop); "
        "Phase 3 (AUTO) — tu exécutes automatiquement UNIQUEMENT si ton confidence score "
        "dépasse le seuil configuré (85% par défaut). Pour SURVEILLANCE_NORMALE tu confirmes "
        "simplement l'état sain. Cette approche progressive garantit zéro faux positif critique."
    ),
    tools=[outil_correctif],
    llm=llm,
    verbose=True,
)

orchestrator_agent = Agent(
    role="Orchestrateur de Pipeline Multi-Agents",
    goal=(
        "Coordonner l'ensemble des 5 agents spécialisés, "
        "gérer les priorités en temps réel, décider des escalades "
        "et garantir la cohérence globale de l'analyse."
    ),
    backstory=(
        "Tu es le chef d'orchestre du système de supervision. "
        "Tu supervises en permanence l'état global du pipeline, "
        "coordonnes les interventions des agents selon la criticité des événements, "
        "gères les conflits de priorité et garantis que chaque anomalie "
        "est traitée dans le bon ordre par le bon agent. "
        "En cas d'incident critique, tu escalades immédiatement vers "
        "le détecteur et le correcteur avant tout autre traitement. "
        "Tu réponds DIRECTEMENT sans utiliser d'outil externe."
    ),
    tools=[],
    llm=llm_orchestrator,
    verbose=True,
)

reporter_agent = Agent(
    role="Rapporteur et Synthétiseur",
    goal=(
        "Générer un rapport complet, structuré et lisible "
        "consolidant les résultats de tous les agents, "
        "puis le sauvegarder sur S3 pour les équipes opérationnelles."
    ),
    backstory=(
        "Tu es expert en reporting opérationnel et visualisation de données. "
        "Tu synthétises les analyses, anomalies, alarmes et actions correctives "
        "en rapports clairs avec des KPIs précis, des recommandations "
        "et un résumé exécutif pour les équipes de supervision. "
        "RÈGLE ABSOLUE : Tu utilises UNIQUEMENT l'outil sauvegarder_rapport_s3. "
        "Tu n'as JAMAIS accès à brave_search, web_search ou internet. "
        "Si l'outil retourne un résultat quelconque, tu réponds immédiatement "
        "'Le rapport a été sauvegardé avec succès sur S3.' sans autre action."
    ),
    tools=[outil_rapport],
    llm=llm,
    verbose=True,
)