from pydantic import BaseModel

class CorrectiveActionRequest(BaseModel):
    alert_id: str
    action_type: str
    target: str

class CorrectiveActionResponse(BaseModel):
    status: str
    message: str
    executed: bool