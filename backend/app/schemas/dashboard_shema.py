from pydantic import BaseModel
from typing import List, Optional

class AlertSchema(BaseModel):
    id: str
    severity: str
    message: str
    timestamp: str

class DashboardResponse(BaseModel):
    total_alerts: int
    alerts: List[AlertSchema]
    anomaly_score: Optional[float] = None