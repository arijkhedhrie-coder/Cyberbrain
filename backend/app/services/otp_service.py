import random
from datetime import datetime, timedelta

RESET_CODES = {}

def generate_reset_code(email: str) -> str:
    code = str(random.randint(100000, 999999))
    RESET_CODES[email.lower()] = {
        "code": code,
        "expires_at": datetime.utcnow() + timedelta(minutes=5)
    }
    return code

def verify_reset_code(email: str, code: str):
    key = email.lower()
    entry = RESET_CODES.get(key)
    if not entry:
        return False, "Code introuvable"
    if datetime.utcnow() > entry["expires_at"]:
        RESET_CODES.pop(key, None)
        return False, "Code expiré"
    if entry["code"] != code:
        return False, "Code invalide"
    RESET_CODES.pop(key, None)
    return True, "Code valide"


def invalidate_reset_code(email: str) -> None:
    RESET_CODES.pop(email.lower(), None)
