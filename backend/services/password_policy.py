import re


UPPER_RE = re.compile(r"[A-Z]")
DIGIT_RE = re.compile(r"\d")


def validate_password_policy(password: str) -> tuple[bool, str]:
    value = str(password or "")
    if len(value) < 8:
        return False, "TOO_SHORT"
    if not UPPER_RE.search(value):
        return False, "MISSING_UPPERCASE"
    if not DIGIT_RE.search(value):
        return False, "MISSING_DIGIT"
    return True, "OK"
