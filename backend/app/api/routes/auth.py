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


def find_user_by_email(users: dict, email: str) -> tuple[Optional[str], Optional[dict]]:
    target = email.lower()
    for username, user in users.items():
        if str(user.get("email", "")).lower() == target:
            return username, user
    return None, None


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
class ForgotPasswordRequest(BaseModel):
    email: EmailStr


@router.post("/auth/forgot-password")
def forgot_password(data: ForgotPasswordRequest):
    users = load_users()
    user_key, _ = find_user_by_email(users, data.email)
    if not user_key:
        raise HTTPException(status_code=404, detail="Email introuvable")

    from app.services.otp_service import generate_reset_code
    from app.services.otp_service import invalidate_reset_code
    from app.services.email_service import send_reset_email

    otp_code = generate_reset_code(data.email)
    try:
        send_reset_email(data.email, otp_code)
    except Exception as exc:
        invalidate_reset_code(data.email)
        raise HTTPException(status_code=500, detail=str(exc))

    return {"success": True, "message": "OTP sent to your email"}

class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp: str
    new_password: str


@router.post("/auth/reset-password")
def reset_password(data: ResetPasswordRequest):
    users = load_users()
    user_key, _ = find_user_by_email(users, data.email)
    if not user_key:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    from app.services.otp_service import verify_reset_code

    is_valid, message = verify_reset_code(data.email, data.otp)
    if not is_valid:
        raise HTTPException(status_code=400, detail=message)

    users[user_key]["hashed_password"] = hash_password(data.new_password)

    save_users(users)

    return {
        "success": True,
        "message": "Mot de passe réinitialisé"
    }
