from datetime import datetime
from decimal import Decimal
from typing import Optional

import requests


def _api_url(bot_token: str, method: str) -> str:
    return f"https://api.telegram.org/bot{bot_token}/{method}"


def sync_last_chat_id(bot_token: str, offset: Optional[int] = None) -> dict:
    token = (bot_token or "").strip()
    if not token:
        return {"ok": False, "error": "Telegram bot token is not configured"}
    params = {"timeout": 0, "limit": 100}
    if offset is not None:
        params["offset"] = int(offset)
    try:
        response = requests.get(_api_url(token, "getUpdates"), params=params, timeout=15)
        data = response.json() if response.ok else {}
    except Exception:
        return {"ok": False, "error": "Telegram getUpdates request failed"}
    if not response.ok or not data.get("ok"):
        return {"ok": False, "error": "Telegram getUpdates returned error"}
    updates = data.get("result") or []
    if not updates:
        return {"ok": False, "error": "No updates found. Send any message to the bot first."}
    last_chat_id = None
    max_update_id = None
    for update in updates:
        update_id = update.get("update_id")
        if update_id is not None:
            max_update_id = update_id if max_update_id is None else max(max_update_id, update_id)
        for key in ("message", "edited_message", "channel_post", "edited_channel_post"):
            payload = update.get(key) or {}
            chat = payload.get("chat") or {}
            chat_id = chat.get("id")
            if chat_id is not None:
                last_chat_id = str(chat_id)
    if not last_chat_id:
        return {"ok": False, "error": "No chat_id found in bot updates"}
    return {"ok": True, "chatId": last_chat_id, "lastUpdateId": max_update_id}


def send_topup_confirmed_notification(
    bot_token: str,
    chat_id: str,
    *,
    topup_id: int,
    user_id: int,
    user_email: str,
    amount,
    asset: str,
    network: str,
    tx_hash: str,
    confirmed_at: Optional[datetime],
) -> bool:
    token = (bot_token or "").strip()
    target_chat = str(chat_id or "").strip()
    if not token or not target_chat:
        return False
    amount_text = str(Decimal(str(amount or 0)).quantize(Decimal("0.00000001")).normalize())
    confirmed_text = (confirmed_at or datetime.utcnow()).strftime("%Y-%m-%d %H:%M:%S UTC")
    text = (
        "✅ Пополнение подтверждено\n"
        f"ID пополнения: #{topup_id}\n"
        f"Пользователь: {user_email} (ID {user_id})\n"
        f"Сумма: {amount_text} {asset}\n"
        f"Сеть: {network}\n"
        f"Tx hash: {tx_hash}\n"
        f"Время: {confirmed_text}"
    )
    payload = {
        "chat_id": target_chat,
        "text": text,
        "disable_web_page_preview": True,
    }
    try:
        response = requests.post(_api_url(token, "sendMessage"), json=payload, timeout=15)
        data = response.json() if response.ok else {}
        return bool(response.ok and data.get("ok"))
    except Exception:
        return False
