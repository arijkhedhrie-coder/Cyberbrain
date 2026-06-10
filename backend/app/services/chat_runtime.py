from __future__ import annotations

import os
from datetime import datetime

def call_llm(prompt: str, *, timeout_seconds: float = 6.0) -> str:
    """Quick Groq call using the same model as the agents."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not configured.")

    from groq import Groq

    client = Groq(api_key=api_key, timeout=timeout_seconds, max_retries=0)
    completion = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
        max_tokens=600,
    )
    message = completion.choices[0].message.content
    if not message:
        raise RuntimeError("Empty response from Groq chat completion.")
    return message


def get_dashboard_context() -> str:
    """Collect a short summary of the current system state."""
    try:
        from app.api.routes.dashboard_routes import _get_event, _latest_jsonl, _load_memory

        events = _latest_jsonl()
        mem = _load_memory()
        kpis = _get_event(events, "METRICS_COMPUTED")
        pass1 = _get_event(events, "PASS1_COMPLETE")
        health = kpis.get("health_score", "N/A")
        alerts = pass1.get("alarm_count", 0)
        pattern = kpis.get("attack_pattern", "unknown")
        sessions = mem.get("sessions", [])
        latest_session = sessions[-1].get("date", "") if sessions else ""
        latest_session_text = latest_session or "inconnue"
        return (
            f"Sante systeme : {health}%. "
            f"Alarmes actives : {alerts}. "
            f"Pattern d'attaque : {pattern}. "
            f"Derniere session analysee : {latest_session_text}. "
            f"(Donnees du {datetime.now().strftime('%H:%M:%S')})"
        )
    except Exception:
        return "Contexte non disponible."


def build_chat_prompt(message: str, context: str) -> str:
    system_prompt = (
        "Tu es l'assistant du tableau de bord IDPS (Intrusion Detection & Prevention System). "
        "Ce systeme surveille en temps reel des serveurs Linux (SSH, Web, FTP, Kernel) via un pipeline hybride "
        "multi-agent base sur CrewAI et des moteurs de detection ML (10+ couches SSH, 5 couches generales, "
        "detection de chaines d'attaque, prediction, agent correcteur semi-automatique, Trust Gate). "
        "Reponds de maniere concise et utile en francais.\n\n"
        f"Contexte actuel du systeme :\n{context}"
    )
    return f"{system_prompt}\n\nUtilisateur : {message}\nAssistant :"


def build_chat_fallback_response(context: str, user_message: str, *, reason: str | None = None) -> str:
    message = (
        "Le service d'analyse approfondie est temporairement indisponible. "
        f"Resume disponible : {context} "
    )
    if reason:
        message += f"Cause technique : {reason}. "
    message += "Tu peux reessayer dans quelques instants pour une reponse IA complete."
    return message
