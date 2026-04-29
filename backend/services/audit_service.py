from datetime import datetime
from typing import Optional

from models import AuditLog, db


def write_audit(actor_type: str, actor_id: Optional[int], event: str, details: str = "") -> None:
    log = AuditLog(
        actor_type=actor_type,
        actor_id=actor_id,
        event=event,
        details=details,
        created_at=datetime.utcnow(),
    )
    db.session.add(log)
    db.session.commit()
