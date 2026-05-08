import json
from pathlib import Path

DATA_PATH = Path(__file__).parent.parent / "storage" / "users.json"

class UserRepository:
    def get_all(self) -> list:
        with open(DATA_PATH, "r") as f:
            return json.load(f)

    def get_by_username(self, username: str) -> dict | None:
        users = self.get_all()
        return next((u for u in users if u["username"] == username), None)

    def save(self, user: dict) -> None:
        users = self.get_all()
        users.append(user)
        with open(DATA_PATH, "w") as f:
            json.dump(users, f, indent=2)