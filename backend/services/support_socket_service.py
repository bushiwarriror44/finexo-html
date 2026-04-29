from datetime import datetime, timedelta

from flask import session
from flask_socketio import emit, join_room

from models import SupportMessage, SupportSlaRule, SupportTicket, User, db


def _ticket_sla(priority: str):
    rule = SupportSlaRule.query.filter_by(priority=priority.lower(), is_active=True).first()
    if not rule:
        return None, None
    now = datetime.utcnow()
    return now + timedelta(minutes=int(rule.first_response_minutes)), now + timedelta(
        minutes=int(rule.resolution_minutes)
    )


def _serialize_message(row: SupportMessage) -> dict:
    return {
        "id": row.id,
        "ticketId": row.ticket_id,
        "senderType": row.sender_type,
        "senderId": row.sender_id,
        "body": row.body,
        "createdAt": row.created_at.isoformat(),
    }


def _serialize_ticket(row: SupportTicket) -> dict:
    return {
        "id": row.id,
        "requesterId": row.requester_id,
        "assigneeId": row.assignee_id,
        "subject": row.subject,
        "priority": row.priority,
        "status": row.status,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
    }


def _current_user():
    user_id = session.get("user_id")
    if user_id:
        return User.query.get(user_id)
    guest_id = session.get("guest_user_id")
    if guest_id:
        row = User.query.get(guest_id)
        if row and not row.is_admin:
            return row
    return None


def _current_admin():
    admin_id = session.get("admin_user_id")
    if not admin_id:
        return None
    row = User.query.get(admin_id)
    if not row or not row.is_admin or not row.is_active:
        return None
    return row


def _ensure_live_ticket(user_id: int) -> SupportTicket:
    row = (
        SupportTicket.query.filter(
            SupportTicket.requester_id == user_id,
            SupportTicket.status.in_(["open", "in_progress"]),
        )
        .order_by(SupportTicket.updated_at.desc())
        .first()
    )
    if row:
        return row
    first_due, resolution_due = _ticket_sla("medium")
    row = SupportTicket(
        requester_id=user_id,
        subject="Live support chat",
        priority="medium",
        status="open",
        first_response_due_at=first_due,
        resolution_due_at=resolution_due,
        sla_state="on_track",
    )
    db.session.add(row)
    db.session.commit()
    return row


def register_support_socket_handlers(socketio):
    @socketio.on("support:user:init")
    def support_user_init():
        user = _current_user()
        if not user:
            emit("support:error", {"error": "unauthorized"})
            return
        ticket = _ensure_live_ticket(user.id)
        room = f"ticket_{ticket.id}"
        join_room(room)
        rows = (
            SupportMessage.query.filter_by(ticket_id=ticket.id)
            .order_by(SupportMessage.id.asc())
            .limit(200)
            .all()
        )
        emit(
            "support:user:state",
            {
                "ticket": _serialize_ticket(ticket),
                "messages": [_serialize_message(item) for item in rows],
            },
        )
        emit("support:admin:ticket_update", {"ticket": _serialize_ticket(ticket)}, to="admins")

    @socketio.on("support:user:message")
    def support_user_message(payload):
        user = _current_user()
        if not user:
            emit("support:error", {"error": "unauthorized"})
            return
        body = (payload or {}).get("body", "").strip()
        if not body:
            emit("support:error", {"error": "message is required"})
            return
        ticket = _ensure_live_ticket(user.id)
        room = f"ticket_{ticket.id}"
        join_room(room)
        row = SupportMessage(ticket_id=ticket.id, sender_type="user", sender_id=user.id, body=body)
        ticket.updated_at = datetime.utcnow()
        db.session.add(row)
        db.session.commit()
        message_payload = _serialize_message(row)
        emit("support:user:new_message", message_payload, to=room)
        emit("support:admin:new_message", message_payload, to="admins")
        emit("support:admin:ticket_update", {"ticket": _serialize_ticket(ticket)}, to="admins")

    @socketio.on("support:admin:init")
    def support_admin_init():
        admin = _current_admin()
        if not admin:
            emit("support:error", {"error": "forbidden"})
            return
        join_room("admins")
        tickets = (
            SupportTicket.query.filter(SupportTicket.status.in_(["open", "in_progress"]))
            .order_by(SupportTicket.updated_at.desc())
            .limit(500)
            .all()
        )
        emit("support:admin:state", {"tickets": [_serialize_ticket(item) for item in tickets]})

    @socketio.on("support:admin:join")
    def support_admin_join(payload):
        admin = _current_admin()
        if not admin:
            emit("support:error", {"error": "forbidden"})
            return
        ticket_id = int((payload or {}).get("ticketId") or 0)
        ticket = SupportTicket.query.get(ticket_id)
        if not ticket:
            emit("support:error", {"error": "ticket not found"})
            return
        room = f"ticket_{ticket.id}"
        join_room(room)
        rows = (
            SupportMessage.query.filter_by(ticket_id=ticket.id)
            .order_by(SupportMessage.id.asc())
            .limit(500)
            .all()
        )
        emit(
            "support:admin:ticket_messages",
            {"ticket": _serialize_ticket(ticket), "messages": [_serialize_message(item) for item in rows]},
        )

    @socketio.on("support:admin:message")
    def support_admin_message(payload):
        admin = _current_admin()
        if not admin:
            emit("support:error", {"error": "forbidden"})
            return
        ticket_id = int((payload or {}).get("ticketId") or 0)
        body = (payload or {}).get("body", "").strip()
        if not ticket_id or not body:
            emit("support:error", {"error": "ticketId and body are required"})
            return
        ticket = SupportTicket.query.get(ticket_id)
        if not ticket:
            emit("support:error", {"error": "ticket not found"})
            return
        if not ticket.assignee_id:
            ticket.assignee_id = admin.id
        ticket.status = "in_progress"
        if not ticket.first_responded_at:
            ticket.first_responded_at = datetime.utcnow()
        ticket.updated_at = datetime.utcnow()
        row = SupportMessage(ticket_id=ticket.id, sender_type="admin", sender_id=admin.id, body=body)
        db.session.add(row)
        db.session.commit()
        room = f"ticket_{ticket.id}"
        message_payload = _serialize_message(row)
        emit("support:user:new_message", message_payload, to=room)
        emit("support:admin:new_message", message_payload, to=room)
        emit("support:admin:ticket_update", {"ticket": _serialize_ticket(ticket)}, to="admins")
