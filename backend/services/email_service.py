import logging
import os
import smtplib
from email.message import EmailMessage

import requests


logger = logging.getLogger(__name__)


class EmailServiceError(Exception):
    pass


def _as_bool(value: str, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _send_via_smtp(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str,
    sender: str,
) -> None:
    host = os.getenv("EMAIL_SMTP_HOST")
    if not host:
        raise EmailServiceError("EMAIL_SMTP_HOST is not configured")
    port = int(os.getenv("EMAIL_SMTP_PORT", "25"))
    user = os.getenv("EMAIL_SMTP_USER", "")
    password = os.getenv("EMAIL_SMTP_PASSWORD", "")
    use_tls = _as_bool(os.getenv("EMAIL_SMTP_USE_TLS"), default=False)
    use_starttls = _as_bool(os.getenv("EMAIL_SMTP_STARTTLS"), default=False)
    timeout = int(os.getenv("EMAIL_SMTP_TIMEOUT_SECONDS", "20"))

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")

    try:
        if use_tls:
            with smtplib.SMTP_SSL(host, port, timeout=timeout) as server:
                if user:
                    server.login(user, password)
                server.send_message(msg)
            return

        with smtplib.SMTP(host, port, timeout=timeout) as server:
            if use_starttls:
                server.starttls()
            if user:
                server.login(user, password)
            server.send_message(msg)
    except smtplib.SMTPException as exc:
        logger.exception("SMTP email send failed: %s", exc)
        raise EmailServiceError("SMTP email delivery failed") from exc
    except OSError as exc:
        logger.exception("SMTP connection failed: %s", exc)
        raise EmailServiceError("SMTP connection failed") from exc


def _send_via_http_api(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str,
    sender: str,
    endpoint: str,
    token: str,
) -> None:
    payload = {
        "to": to_email,
        "from": sender,
        "subject": subject,
        "text": text_body,
        "html": html_body,
    }
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    timeout = int(os.getenv("EMAIL_API_TIMEOUT_SECONDS", "20"))
    try:
        response = requests.post(endpoint, json=payload, headers=headers, timeout=timeout)
        response.raise_for_status()
    except requests.RequestException as exc:
        logger.exception("Email API send failed: %s", exc)
        raise EmailServiceError("Email API delivery failed") from exc


def _send_email(to_email: str, subject: str, text_body: str, html_body: str) -> None:
    endpoint = os.getenv("EMAIL_API_URL")
    token = os.getenv("EMAIL_API_TOKEN")
    sender = os.getenv("EMAIL_FROM", "noreply@cloudmine.local")
    smtp_host = os.getenv("EMAIL_SMTP_HOST")

    if smtp_host:
        _send_via_smtp(
            to_email=to_email,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
            sender=sender,
        )
        return

    if endpoint and token:
        _send_via_http_api(
            to_email=to_email,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
            sender=sender,
            endpoint=endpoint,
            token=token,
        )
        return

    raise EmailServiceError(
        "Email delivery is not configured. Set EMAIL_SMTP_HOST for local SMTP "
        "or EMAIL_API_URL/EMAIL_API_TOKEN for HTTP provider."
    )


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
