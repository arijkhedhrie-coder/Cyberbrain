from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, EmailStr
from jose import jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
from typing import Optional
import json, os

router = APIRouter()

# ── Config JWT ─────────────────────────────────────────────
#   En production : charger depuis variable d'environnement
SECRET_KEY = os.environ.get("SECRET_KEY", "security-dashboard-secret-key-2024")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

# ── Stockage utilisateurs (fichier JSON local) ─────────────
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
USERS_FILE = BASE_DIR / "storage" / "users.json"

print("[DEBUG] USERS_FILE =", USERS_FILE)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── État admin en mémoire (à remplacer par DB en production) ──
class _AdminConfig:
    ADMIN_EMAIL: Optional[str] = None
    ADMIN_PASSWORD_HASH: Optional[str] = None

cfg = _AdminConfig()


# ── Helpers ────────────────────────────────────────────────
def load_users() -> dict:
    if not os.path.exists(USERS_FILE):
        return {}
    with open(USERS_FILE, "r") as f:
        return json.load(f)

def save_users(users: dict):
    with open(USERS_FILE, "w") as f:
        json.dump(users, f, indent=2)

def hash_password(plain: str) -> str:
    """Hash un mot de passe en clair avec bcrypt."""
    return pwd_context.hash(plain)

def utcnow() -> datetime:
    """Retourne l'heure UTC actuelle (compatible Python 3.11+)."""
    return datetime.now(timezone.utc)


# ── broadcast_alarm ────────────────────────────────────────
# Exportée ici pour rétrocompatibilité avec le module WebSocket.
# Si tu as un vrai WebSocket manager, remplace le corps par l'appel réel.
async def broadcast_alarm(data: dict):
    """
    Diffuse une alarme à tous les clients WebSocket connectés.

    Args:
        data: Dictionnaire contenant les détails de l'alarme,
              ex: {"level": "critical", "message": "...", "timestamp": "..."}

    TODO: Brancher sur ton ConnectionManager réel, par exemple :
        from app.api.ws.manager import ws_manager
        await ws_manager.broadcast(json.dumps(data))
    """
    import json as _json
    # Stub fonctionnel — remplacer par l'implémentation WebSocket réelle
    print(f"[broadcast_alarm] {_json.dumps(data)}")


# ── Modèles ────────────────────────────────────────────────
class SignupRequest(BaseModel):
    username: str
    email: EmailStr          # ✅ Validation email activée
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    username: str

class CreateAdminRequest(BaseModel):
    username: str
    email: EmailStr
    password: str


# ── POST /auth/signup ──────────────────────────────────────
@router.post("/auth/signup", status_code=201)
def signup(data: SignupRequest):
    users = load_users()

    if data.username in users:
        raise HTTPException(
            status_code=400,
            detail="Nom d'utilisateur déjà utilisé."
        )

    users[data.username] = {
        "username": data.username,
        "email": data.email,
        "hashed_password": hash_password(data.password),
        "created_at": utcnow().isoformat()
    }
    save_users(users)
    return {"message": "Compte créé avec succès.", "username": data.username}


# ── POST /auth/login ───────────────────────────────────────
@router.post("/auth/login", response_model=TokenResponse)
def login(credentials: LoginRequest):
    users = load_users()
    user = users.get(credentials.username)

    if not user or not pwd_context.verify(credentials.password, user["hashed_password"]):
        raise HTTPException(
            status_code=401,
            detail="Identifiants invalides. Accès refusé."
        )

    expire = utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    token = jwt.encode(
        {"sub": credentials.username, "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "username": credentials.username
    }

from dotenv import load_dotenv
load_dotenv()

ADMIN_SETUP_SECRET = os.environ.get("ADMIN_SETUP_SECRET", "cyberbrain_admin")

print("ENV SECRET =", os.environ.get("ADMIN_SETUP_SECRET"))
print("LOADED SECRET =", ADMIN_SETUP_SECRET)

@router.post("/auth/create-admin", status_code=201)
async def create_admin(
    data: CreateAdminRequest,
    x_admin_setup_secret: str = Header(..., alias="X-Admin-Setup-Secret")
):
    """
    Crée ou met à jour le compte administrateur.
    Nécessite le header : X-Admin-Setup-Secret: <secret>
    """
    if x_admin_setup_secret != ADMIN_SETUP_SECRET:
        raise HTTPException(
            status_code=403,
            detail="Accès non autorisé."
        )

    cfg.ADMIN_EMAIL = data.email
    cfg.ADMIN_PASSWORD_HASH = hash_password(data.password)

    # Persister aussi dans users.json pour cohérence
    users = load_users()
    users[data.username] = {
        "username": data.username,
        "email": data.email,
        "hashed_password": cfg.ADMIN_PASSWORD_HASH,
        "role": "admin",
        "created_at": utcnow().isoformat()
    }
    save_users(users)

    return {
        "status": "success",
        "message": f"Admin '{data.username}' créé avec succès."
    }
from pydantic import EmailStr

class ForgotPasswordRequest(BaseModel):
    email: EmailStr
@router.post("/auth/forgot-password")
def forgot_password(data: ForgotPasswordRequest):
    users = load_users()
    user_found = any(u.get("email") == data.email for u in users.values())
    if not user_found:
        raise HTTPException(404, "Email introuvable")

    from app.services.otp_service import generate_reset_code
    from app.services.email_service import send_reset_email

    token = create_reset_token(data.email)
    reset_link = f"http://localhost:5173/reset-password?token={token}"
    send_reset_email(data.email, reset_link)

    return {"success": True, "message": "Code envoyé"}

def create_reset_token(email: str):
    expire = utcnow() + timedelta(minutes=5)

    token = jwt.encode(
        {
            "sub": email,
            "type": "password_reset",
            "exp": expire
        },
        SECRET_KEY,
        algorithm=ALGORITHM
    )

    return token
class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

@router.post("/auth/reset-password")
def reset_password(data: ResetPasswordRequest):

    try:
        payload = jwt.decode(
            data.token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        if payload.get("type") != "password_reset":
            raise HTTPException(400, "Token invalide")

        email = payload.get("sub")

    except Exception:
        raise HTTPException(400, "Token expiré ou invalide")

    users = load_users()

    user_key = None

    for username, user in users.items():
        if user.get("email") == email:
            user_key = username
            break

    if not user_key:
        raise HTTPException(404, "Utilisateur introuvable")

    users[user_key]["hashed_password"] = hash_password(data.new_password)

    save_users(users)

    return {
        "success": True,
        "message": "Mot de passe réinitialisé"
    }