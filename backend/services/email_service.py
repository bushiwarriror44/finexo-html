import logging
import os

import requests


logger = logging.getLogger(__name__)


class EmailServiceError(Exception):
    pass


def _send_email(to_email: str, subject: str, text_body: str, html_body: str) -> None:
    endpoint = os.getenv("EMAIL_API_URL")
    token = os.getenv("EMAIL_API_TOKEN")
    sender = os.getenv("EMAIL_FROM", "noreply@cloudmine.local")

    if not endpoint or not token:
        raise EmailServiceError("EMAIL_API_URL / EMAIL_API_TOKEN are not configured")

    payload = {
        "to": to_email,
        "from": sender,
        "subject": subject,
        "text": text_body,
        "html": html_body,
    }
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    try:
        response = requests.post(endpoint, json=payload, headers=headers, timeout=20)
        response.raise_for_status()
    except requests.RequestException as exc:
        logger.exception("Email send failed: %s", exc)
        raise EmailServiceError("Email delivery failed") from exc


def send_password_reset_email(email: str, reset_url: str) -> None:
    _send_email(
        to_email=email,
        subject="Password reset",
        text_body=f"Use this link to reset password: {reset_url}",
        html_body=f"<p>Use this link to reset password:</p><p><a href=\"{reset_url}\">{reset_url}</a></p>",
    )


def send_team_application_email(
    full_name: str,
    applicant_email: str,
    role: str,
    experience: str,
    message: str,
) -> None:
    target_email = os.getenv("TEAM_APPLICATIONS_TO") or os.getenv("ADMIN_EMAIL")
    if not target_email:
        raise EmailServiceError("TEAM_APPLICATIONS_TO / ADMIN_EMAIL is not configured")
    safe_message = (message or "").strip() or "-"
    text_body = (
        "New team application\n\n"
        f"Name: {full_name}\n"
        f"Email: {applicant_email}\n"
        f"Role: {role}\n"
        f"Experience: {experience}\n"
        f"Message: {safe_message}\n"
    )
    html_body = (
        "<h3>New team application</h3>"
        f"<p><strong>Name:</strong> {full_name}</p>"
        f"<p><strong>Email:</strong> {applicant_email}</p>"
        f"<p><strong>Role:</strong> {role}</p>"
        f"<p><strong>Experience:</strong> {experience}</p>"
        f"<p><strong>Message:</strong><br>{safe_message}</p>"
    )
    _send_email(
        to_email=target_email,
        subject=f"Team application: {role} ({full_name})",
        text_body=text_body,
        html_body=html_body,
    )
