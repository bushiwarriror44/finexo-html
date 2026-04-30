import requests
from decimal import Decimal
import os
from typing import Dict, List, Optional, Tuple

TRON_USDT_DECIMALS = Decimal("1000000")
TRON_MAINNET_USDT_CONTRACT = os.getenv("TRON_USDT_CONTRACT", "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj")
TRON_PUBLIC_API_URLS = [
    item.strip()
    for item in os.getenv("TRON_PUBLIC_API_URLS", "https://api.trongrid.io").split(",")
    if item.strip()
]


class TronProviderError(Exception):
    def __init__(self, error_code: str, message: str):
        super().__init__(message)
        self.error_code = error_code
        self.message = message


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


def _build_v1_url(api_url: str, path: str) -> str:
    base = (api_url or "").strip().rstrip("/")
    if base.endswith("/v1"):
        return f"{base}/{path.lstrip('/')}"
    return f"{base}/v1/{path.lstrip('/')}"


def _candidate_tron_endpoints(api_url: str, api_key: str) -> List[Tuple[str, str]]:
    endpoints: List[Tuple[str, str]] = []
    primary_url = (api_url or "").strip()
    primary_key = (api_key or "").strip()
    if primary_url:
        endpoints.append((primary_url, primary_key))
    for public_url in TRON_PUBLIC_API_URLS:
        if public_url == primary_url:
            if not primary_key:
                continue
            endpoints.append((public_url, ""))
            continue
        endpoints.append((public_url, ""))
    # de-duplicate while preserving order
    seen = set()
    unique_endpoints: List[Tuple[str, str]] = []
    for base_url, key in endpoints:
        marker = (base_url.rstrip("/"), bool(key))
        if marker in seen:
            continue
        seen.add(marker)
        unique_endpoints.append((base_url, key))
    return unique_endpoints


def _http_error_to_code(status_code: Optional[int]) -> str:
    if status_code == 429:
        return "PROVIDER_RATE_LIMIT"
    if status_code in {401, 403}:
        return "PROVIDER_CONFIG"
    return "PROVIDER_HTTP_ERROR"


def _fetch_json_with_fallback(api_url: str, api_key: str, path: str, params: Optional[Dict] = None, timeout: int = 20) -> Dict:
    candidates = _candidate_tron_endpoints(api_url, api_key)
    if not candidates:
        raise TronProviderError("PROVIDER_CONFIG", "TRON api url is not configured")

    last_error_code = "PROVIDER_REQUEST_FAILED"
    last_error_message = "TRON provider request failed"
    for base_url, current_key in candidates:
        headers = {"TRON-PRO-API-KEY": current_key} if current_key else {}
        url = _build_v1_url(base_url, path)
        try:
            response = requests.get(url, headers=headers, params=params, timeout=timeout)
            response.raise_for_status()
            return response.json() or {}
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            last_error_code = _http_error_to_code(status_code)
            last_error_message = f"TRON provider HTTP error {status_code or 'unknown'}"
            continue
        except Exception:
            last_error_code = "PROVIDER_REQUEST_FAILED"
            last_error_message = "TRON provider request failed"
            continue
    raise TronProviderError(last_error_code, last_error_message)


def verify_tron_transaction(api_url: str, api_key: str, tx_hash: str) -> dict:
    if not api_url:
        return {"confirmed": False, "errorCode": "PROVIDER_CONFIG", "message": "TRON api url is not configured"}
    try:
        payload = _fetch_json_with_fallback(api_url, api_key, f"transactions/{tx_hash}")
    except TronProviderError as exc:
        return {"confirmed": False, "errorCode": exc.error_code, "message": exc.message}
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
    events_rows = []
    try:
        events_payload = _fetch_json_with_fallback(api_url, api_key, f"transactions/{tx_hash}/events")
        events_rows = (events_payload or {}).get("data") or []
    except Exception:
        events_rows = []
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
    wallet_address = (wallet_address or "").strip()
    if not api_url or not wallet_address:
        return None
    try:
        payload = _fetch_json_with_fallback(
            api_url,
            api_key,
            f"accounts/{wallet_address}",
            params={"only_confirmed": "true"},
        )
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
    except TronProviderError:
        return None
    except Exception:
        return None


def list_tron_usdt_incoming_transfers(api_url: str, api_key: str, wallet_address: str, min_timestamp_ms: int = 0) -> List[Dict]:
    api_url = (api_url or "").strip()
    wallet_address = (wallet_address or "").strip()
    if not api_url or not wallet_address:
        return []
    try:
        params = {
            "only_confirmed": "true",
            "limit": 200,
            "contract_address": TRON_MAINNET_USDT_CONTRACT,
            "min_timestamp": int(min_timestamp_ms or 0),
        }
        payload = _fetch_json_with_fallback(api_url, api_key, f"accounts/{wallet_address}/transactions/trc20", params=params)
        rows = (payload or {}).get("data") or []
        items = []
        for row in rows:
            tx_hash = (row.get("transaction_id") or "").strip()
            to_address = (row.get("to") or "").strip()
            if not tx_hash or not to_address:
                continue
            value_raw = row.get("value")
            token_info = row.get("token_info") or {}
            decimals = token_info.get("decimals")
            amount = None
            try:
                if decimals is not None:
                    amount = Decimal(str(value_raw)) / (Decimal("10") ** Decimal(str(decimals)))
                else:
                    amount = Decimal(str(value_raw))
            except Exception:
                amount = None
            if amount is None:
                continue
            confirmations = int(row.get("confirmations") or 0)
            timestamp_ms = int(row.get("block_timestamp") or 0)
            items.append(
                {
                    "txHash": tx_hash,
                    "toAddress": to_address,
                    "amount": str(amount.quantize(Decimal("0.00000001"))),
                    "confirmations": confirmations,
                    "timestampMs": timestamp_ms,
                }
            )
        return items
    except TronProviderError as exc:
        raise exc
    except Exception:
        return []
