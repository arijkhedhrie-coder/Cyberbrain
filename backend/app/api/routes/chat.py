from fastapi import APIRouter
from pydantic import BaseModel
import os, json
from datetime import datetime

router = APIRouter(prefix="/api", tags=["chat"])

# We'll use the same Groq LLM as the agents
import os
api_key = os.getenv("GROQ_API_KEY")

def _call_llm(prompt: str) -> str:
    """Quick Groq call using the same model as your agents."""
    try:
        from groq import Groq
        client = Groq(api_key=api_key)
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=600,
        )
        return completion.choices[0].message.content
    except Exception as e:
        return f"Erreur LLM : {e}"

def _get_dashboard_context() -> str:
    """Collect a short summary of the current system state."""
    try:
        from dashboard_routes import _load_memory, _latest_jsonl, _get_event
        events = _latest_jsonl()
        mem = _load_memory()
        kpis = _get_event(events, "METRICS_COMPUTED")
        pass1 = _get_event(events, "PASS1_COMPLETE")
        health = kpis.get("health_score", "N/A")
        alerts = pass1.get("alarm_count", 0)
        pattern = kpis.get("attack_pattern", "unknown")
        return (
            f"Santé système : {health}%. "
            f"Alarmes actives : {alerts}. "
            f"Pattern d'attaque : {pattern}. "
            f"(Données du {datetime.now().strftime('%H:%M:%S')})"
        )
    except Exception:
        return "Contexte non disponible."

class ChatRequest(BaseModel):
    message: str

@router.post("/chat")
def chat_endpoint(req: ChatRequest):
    context = _get_dashboard_context()
    system_prompt = (
        "Tu es l'assistant du tableau de bord IDPS (Intrusion Detection & Prevention System). "
        "Ce système surveille en temps réel des serveurs Linux (SSH, Web, FTP, Kernel) via un pipeline hybride "
        "multi-agent basé sur CrewAI et des moteurs de détection ML (10+ couches SSH, 5 couches générales, "
        "détection de chaînes d'attaque, prédiction, agent correcteur semi‑automatique, Trust Gate). "
        "Réponds de manière concise et utile en français.\n\n"
        f"Contexte actuel du système :\n{context}"
    )
    full_prompt = f"{system_prompt}\n\nUtilisateur : {req.message}\nAssistant :"
    answer = _call_llm(full_prompt)
    return {"response": answer}