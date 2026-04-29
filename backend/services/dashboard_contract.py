from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional


def api_error(message: str, code: str, status: int, details: Optional[Dict[str, Any]] = None):
    payload: Dict[str, Any] = {"error": message, "code": code}
    if details:
        payload["details"] = details
    return payload, status


def iso_or_none(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def map_topup_status(status: str) -> str:
    normalized = str(status or "").lower()
    if normalized == "confirmed":
        return "completed"
    if normalized == "rejected":
        return "failed"
    if normalized == "pending":
        return "pending"
    return normalized or "pending"


def map_topup_verification_status(status: str) -> str:
    normalized = str(status or "").lower()
    if normalized == "done":
        return "completed"
    if normalized == "failed":
        return "failed"
    if normalized == "running":
        return "running"
    if normalized == "queued":
        return "queued"
    return normalized or "queued"


def map_kyc_status(status: str) -> str:
    normalized = str(status or "").lower()
    if normalized == "pending":
        return "review"
    return normalized or "not_started"


def map_withdrawal_status(status: str) -> str:
    normalized = str(status or "").lower()
    if normalized in {"approved", "processing"}:
        return "processing"
    if normalized == "rejected":
        return "failed"
    return normalized or "pending"


def map_ticket_status(status: str) -> str:
    normalized = str(status or "").lower()
    if normalized == "resolved":
        return "completed"
    return normalized or "open"


def map_notification_category(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"payments", "withdrawals", "support", "compliance", "system"}:
        return normalized
    return "system"


def map_notification_priority(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"low", "medium", "high", "critical"}:
        return normalized
    return "medium"
