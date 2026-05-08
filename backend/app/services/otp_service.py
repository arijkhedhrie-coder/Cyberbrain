import random
from datetime import datetime, timedelta

RESET_CODES = {}

def generate_reset_code(email: str) -> str:
    code = str(random.randint(100000, 999999))
    RESET_CODES[email] = {
        "code": code,
        "expires_at": datetime.utcnow() + timedelta(minutes=5)
    }
    return code

def verify_reset_code(email: str, code: str):
    entry = RESET_CODES.get(email)
    if not entry:
        return False, "Code introuvable"
    if datetime.utcnow() > entry["expires_at"]:
        return False, "Code expiré"
    if entry["code"] != code:
        return False, "Code invalide"
    return True, "Code valide"