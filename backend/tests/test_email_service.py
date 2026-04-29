import os
import unittest
from unittest.mock import MagicMock, patch

try:
    from backend.services import email_service
except ModuleNotFoundError:
    from services import email_service


class EmailServiceConfigTest(unittest.TestCase):
    def setUp(self):
        self._keys = [
            "EMAIL_API_URL",
            "EMAIL_API_TOKEN",
            "EMAIL_FROM",
            "EMAIL_SMTP_HOST",
            "EMAIL_SMTP_PORT",
            "EMAIL_SMTP_USER",
            "EMAIL_SMTP_PASSWORD",
            "EMAIL_SMTP_USE_TLS",
            "EMAIL_SMTP_STARTTLS",
            "EMAIL_SMTP_TIMEOUT_SECONDS",
        ]
        self._saved = {k: os.environ.get(k) for k in self._keys}
        for key in self._keys:
            os.environ.pop(key, None)

    def tearDown(self):
        for key in self._keys:
            if self._saved[key] is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = self._saved[key]

    def test_prefers_smtp_over_http_when_smtp_host_set(self):
        os.environ["EMAIL_SMTP_HOST"] = "127.0.0.1"
        os.environ["EMAIL_SMTP_PORT"] = "25"
        os.environ["EMAIL_API_URL"] = "https://example.test/send"
        os.environ["EMAIL_API_TOKEN"] = "token"
        os.environ["EMAIL_FROM"] = "noreply@cloud-mine.com"

        with patch.object(email_service.smtplib, "SMTP") as smtp_mock, patch.object(
            email_service.requests, "post"
        ) as requests_post:
            smtp_instance = MagicMock()
            smtp_mock.return_value.__enter__.return_value = smtp_instance

            email_service._send_email(
                to_email="user@test.com",
                subject="Subject",
                text_body="Text",
                html_body="<p>Text</p>",
            )

            smtp_instance.send_message.assert_called_once()
            requests_post.assert_not_called()

    def test_uses_http_api_when_smtp_not_configured(self):
        os.environ["EMAIL_API_URL"] = "https://example.test/send"
        os.environ["EMAIL_API_TOKEN"] = "token"
        os.environ["EMAIL_FROM"] = "noreply@cloud-mine.com"
        with patch.object(email_service.requests, "post") as requests_post:
            response = MagicMock()
            response.raise_for_status.return_value = None
            requests_post.return_value = response

            email_service._send_email(
                to_email="user@test.com",
                subject="Subject",
                text_body="Text",
                html_body="<p>Text</p>",
            )
            requests_post.assert_called_once()

    def test_raises_when_no_delivery_mode_configured(self):
        with self.assertRaises(email_service.EmailServiceError):
            email_service._send_email(
                to_email="user@test.com",
                subject="Subject",
                text_body="Text",
                html_body="<p>Text</p>",
            )


if __name__ == "__main__":
    unittest.main()
