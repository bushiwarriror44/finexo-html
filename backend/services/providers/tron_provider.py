import requests
from decimal import Decimal
import os
from typing import Dict, List, Optional, Tuple

TRON_USDT_DECIMALS = Decimal("1000000")
TRON_MAINNET_USDT_CONTRACT = os.getenv("TRON_USDT_CONTRACT", "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj")


def _normalize_tron_amount(raw_amount):
    if raw_amount is None:
        return None
    try:
        return str(Decimal(str(raw_amount)) / TRON_USDT_DECIMALS)
    except Exception:
        return None


def _extract_transfer_from_events(events: List[Dict]) -> Tuple[Optional[str], Optional[str]]:
    for event in events:
        event_name = (event.get("event_name") or event.get("eventName") or "").strip()
        if event_name and event_name != "Transfer":
            continue
        result = event.get("result") or {}
        contract_address = (event.get("contract_address") or "").strip()
        if not contract_address:
            continue
        if contract_address != TRON_MAINNET_USDT_CONTRACT:
            continue
        to_address = (result.get("to") or result.get("to_address") or "").strip()
        amount = result.get("value")
        normalized_amount = _normalize_tron_amount(amount)
        if to_address and normalized_amount is not None:
            return to_address, normalized_amount
    return None, None


def verify_tron_transaction(api_url: str, api_key: str, tx_hash: str) -> dict:
    if not api_url:
        return {"confirmed": False, "errorCode": "PROVIDER_CONFIG", "message": "TRON api url is not configured"}

    api_key = (api_key or "").strip()
    if not api_key:
        return {"confirmed": False, "errorCode": "PROVIDER_CONFIG", "message": "TRON api key is not configured"}
    headers = {"TRON-PRO-API-KEY": api_key}
    url = f"{api_url.rstrip('/')}/v1/transactions/{tx_hash}"
    response = requests.get(url, headers=headers, timeout=20)
    response.raise_for_status()
    payload = response.json()
    rows = payload.get("data") or []
    if not rows:
        return {"confirmed": False, "errorCode": "TX_NOT_FOUND", "message": "transaction not found"}

    tx = rows[0]
    ret = tx.get("ret") or []
    contract_result = (ret[0] or {}).get("contractRet") if ret else None
    raw_data = tx.get("raw_data") or {}
    contracts = raw_data.get("contract") or []
    value = (((contracts[0] or {}).get("parameter") or {}).get("value") or {}) if contracts else {}
    to_address = value.get("to_address")
    amount = value.get("amount")
    confirmations = int(tx.get("confirmations") or 0)
    events_url = f"{api_url.rstrip('/')}/v1/transactions/{tx_hash}/events"
    events_response = requests.get(events_url, headers=headers, timeout=20)
    events_response.raise_for_status()
    events_rows = (events_response.json() or {}).get("data") or []
    event_to_address, event_amount = _extract_transfer_from_events(events_rows)

    normalized_to_address = event_to_address or to_address
    normalized_amount = event_amount or _normalize_tron_amount(amount)
    return {
        "confirmed": contract_result == "SUCCESS",
        "toAddress": normalized_to_address,
        "amount": normalized_amount,
        "confirmations": confirmations,
        "message": "confirmed" if contract_result == "SUCCESS" else f"status={contract_result or 'unknown'}",
        "errorCode": None if contract_result == "SUCCESS" else "TX_NOT_CONFIRMED",
    }


def get_tron_usdt_wallet_balance(api_url: str, api_key: str, wallet_address: str):
    api_url = (api_url or "").strip()
    api_key = (api_key or "").strip()
    wallet_address = (wallet_address or "").strip()
    if not api_url or not api_key or not wallet_address:
        return None
    try:
        headers = {"TRON-PRO-API-KEY": api_key}
        url = f"{api_url.rstrip('/')}/v1/accounts/{wallet_address}"
        response = requests.get(url, headers=headers, params={"only_confirmed": "true"}, timeout=20)
        response.raise_for_status()
        payload = response.json() or {}
        rows = payload.get("data") or []
        if not rows:
            return Decimal("0")
        trc20_rows = rows[0].get("trc20") or []
        contract_expected = TRON_MAINNET_USDT_CONTRACT.lower()
        for token_map in trc20_rows:
            if not isinstance(token_map, dict):
                continue
            for contract, amount_raw in token_map.items():
                if str(contract or "").strip().lower() != contract_expected:
                    continue
                return Decimal(str(amount_raw or "0"))
        return Decimal("0")
    except Exception:
        return None
