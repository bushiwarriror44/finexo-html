import requests
from decimal import Decimal
import os
from typing import Dict, List, Optional, Tuple

TRON_USDT_DECIMALS = Decimal("1000000")
TRON_MAINNET_USDT_CONTRACT = os.getenv("TRON_USDT_CONTRACT", "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj")
TRON_USDT_KNOWN_CONTRACTS = {
    "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj",  # legacy/common mapping
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",  # current main USDT TRC20
}
TRON_USDT_CONTRACTS = {
    item.strip()
    for item in os.getenv(
        "TRON_USDT_CONTRACTS",
        ",".join(sorted({TRON_MAINNET_USDT_CONTRACT, *TRON_USDT_KNOWN_CONTRACTS})),
    ).split(",")
    if item.strip()
}
TRON_PUBLIC_API_URLS = [
    item.strip()
    for item in os.getenv(
        "TRON_PUBLIC_API_URLS",
        "https://api.trongrid.io,https://api.tronstack.io,https://tronapi.io",
    ).split(",")
    if item.strip()
]
TRONSCAN_API_BASE = os.getenv("TRONSCAN_API_BASE", "https://apilist.tronscanapi.com/api").strip().rstrip("/")


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


def _normalize_contract_address(value: str) -> str:
    return str(value or "").strip().lower()


def _extract_raw_amount_from_tronscan(value) -> Decimal:
    return Decimal(str(value or "0"))


def _parse_tronscan_amount(raw_value, decimals=None) -> Optional[Decimal]:
    try:
        raw = _extract_raw_amount_from_tronscan(raw_value)
        if decimals is None:
            return raw
        decimals_num = int(decimals)
        return raw / (Decimal("10") ** Decimal(str(decimals_num)))
    except Exception:
        return None


def _extract_transfer_from_events(events: List[Dict]) -> Tuple[Optional[str], Optional[str]]:
    expected_contracts = {_normalize_contract_address(contract) for contract in TRON_USDT_CONTRACTS}
    for event in events:
        event_name = (event.get("event_name") or event.get("eventName") or "").strip()
        if event_name and event_name != "Transfer":
            continue
        result = event.get("result") or {}
        contract_address = (event.get("contract_address") or "").strip()
        if not contract_address:
            continue
        if _normalize_contract_address(contract_address) not in expected_contracts:
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


def _get_tronscan_usdt_wallet_balance(wallet_address: str) -> Optional[Decimal]:
    address = (wallet_address or "").strip()
    if not address:
        return None
    try:
        response = requests.get(
            "https://apilist.tronscanapi.com/api/account",
            params={"address": address},
            timeout=20,
        )
        if not response.ok:
            return None
        payload = response.json() or {}
        rows = payload.get("trc20token_balances") or payload.get("trc20TokenBalances") or []
        expected_contracts = {_normalize_contract_address(contract) for contract in TRON_USDT_CONTRACTS}
        for row in rows:
            if not isinstance(row, dict):
                continue
            symbol = str(row.get("tokenAbbr") or row.get("symbol") or "").strip().upper()
            contract = _normalize_contract_address(row.get("tokenId") or row.get("contract_address"))
            if symbol != "USDT" and contract not in expected_contracts:
                continue
            raw_balance = row.get("balance")
            decimals = row.get("tokenDecimal")
            amount = _parse_tronscan_amount(raw_balance, decimals if decimals is not None else 6)
            if amount is not None:
                return amount
        return None
    except Exception:
        return None


def _get_tronscan_incoming_transfers(wallet_address: str, min_timestamp_ms: int = 0) -> List[Dict]:
    address = (wallet_address or "").strip()
    if not address:
        return []
    try:
        params = {
            "limit": 200,
            "start": 0,
            "relatedAddress": address,
            "toAddress": address,
            "sort": "-timestamp",
            "contract_address": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            "start_timestamp": int(min_timestamp_ms or 0),
        }
        response = requests.get(f"{TRONSCAN_API_BASE}/token_trc20/transfers", params=params, timeout=20)
        if not response.ok:
            return []
        payload = response.json() or {}
        rows = payload.get("token_transfers") or payload.get("data") or []
        expected_contracts = {_normalize_contract_address(contract) for contract in TRON_USDT_CONTRACTS}
        items: List[Dict] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            tx_hash = str(row.get("transaction_id") or row.get("hash") or "").strip()
            to_address = str(row.get("to_address") or row.get("toAddress") or row.get("to") or "").strip()
            contract = _normalize_contract_address(
                row.get("contract_address")
                or row.get("tokenInfo", {}).get("tokenId")
                or row.get("tokenInfo", {}).get("address")
            )
            symbol = str(
                row.get("tokenInfo", {}).get("tokenAbbr")
                or row.get("tokenInfo", {}).get("symbol")
                or row.get("token_symbol")
                or ""
            ).strip().upper()
            if not tx_hash or not to_address:
                continue
            if symbol != "USDT" and contract not in expected_contracts:
                continue
            decimals = row.get("tokenInfo", {}).get("tokenDecimal") or row.get("token_decimal") or 6
            amount = _parse_tronscan_amount(row.get("quant") or row.get("amount") or row.get("value"), decimals)
            if amount is None:
                continue
            confirmations = int(row.get("confirmations") or 0)
            timestamp_ms = int(row.get("block_ts") or row.get("timestamp") or row.get("block_timestamp") or 0)
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
    except Exception:
        return []


def _get_tronscan_transaction(tx_hash: str) -> Optional[Dict]:
    hash_value = (tx_hash or "").strip()
    if not hash_value:
        return None
    try:
        response = requests.get(
            f"{TRONSCAN_API_BASE}/transaction-info",
            params={"hash": hash_value},
            timeout=20,
        )
        if not response.ok:
            return None
        payload = response.json() or {}
        result = payload.get("contractRet") or payload.get("result")
        confirmed = str(result or "").upper() == "SUCCESS"
        transfer_rows = payload.get("trc20TransferInfo") or payload.get("tokenTransfers") or []
        to_address = None
        amount_value = None
        expected_contracts = {_normalize_contract_address(contract) for contract in TRON_USDT_CONTRACTS}
        for row in transfer_rows:
            if not isinstance(row, dict):
                continue
            symbol = str(row.get("symbol") or row.get("tokenSymbol") or "").strip().upper()
            contract = _normalize_contract_address(row.get("contract_address") or row.get("tokenId"))
            if symbol != "USDT" and contract not in expected_contracts:
                continue
            to_address = str(row.get("to_address") or row.get("toAddress") or row.get("to") or "").strip() or None
            amount_value = row.get("amount_str") or row.get("amount") or row.get("quant")
            decimals = row.get("decimals") or row.get("tokenDecimal")
            amount_decimal = _parse_tronscan_amount(amount_value, decimals if decimals is not None else None)
            if amount_decimal is not None:
                amount_value = str(amount_decimal.quantize(Decimal("0.00000001")))
            break
        confirmations = int(payload.get("confirmations") or payload.get("confirmed") or 0)
        return {
            "confirmed": confirmed,
            "toAddress": to_address,
            "amount": amount_value,
            "confirmations": confirmations,
            "message": "confirmed" if confirmed else f"status={result or 'unknown'}",
            "errorCode": None if confirmed else "TX_NOT_CONFIRMED",
        }
    except Exception:
        return None


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
        tronscan_payload = _get_tronscan_transaction(tx_hash)
        if tronscan_payload:
            return tronscan_payload
        return {"confirmed": False, "errorCode": exc.error_code, "message": exc.message}
    rows = payload.get("data") or []
    if not rows:
        tronscan_payload = _get_tronscan_transaction(tx_hash)
        if tronscan_payload:
            return tronscan_payload
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
            tronscan_fallback = _get_tronscan_usdt_wallet_balance(wallet_address)
            return tronscan_fallback if tronscan_fallback is not None else Decimal("0")
        trc20_rows = rows[0].get("trc20") or []
        contract_expected = {contract.lower() for contract in TRON_USDT_CONTRACTS}
        for token_map in trc20_rows:
            if not isinstance(token_map, dict):
                continue
            for contract, amount_raw in token_map.items():
                if str(contract or "").strip().lower() not in contract_expected:
                    continue
                return Decimal(str(amount_raw or "0"))
        tronscan_fallback = _get_tronscan_usdt_wallet_balance(wallet_address)
        return tronscan_fallback if tronscan_fallback is not None else Decimal("0")
    except TronProviderError:
        tronscan_fallback = _get_tronscan_usdt_wallet_balance(wallet_address)
        return tronscan_fallback
    except Exception:
        tronscan_fallback = _get_tronscan_usdt_wallet_balance(wallet_address)
        return tronscan_fallback


def list_tron_usdt_incoming_transfers(api_url: str, api_key: str, wallet_address: str, min_timestamp_ms: int = 0) -> List[Dict]:
    api_url = (api_url or "").strip()
    wallet_address = (wallet_address or "").strip()
    if not api_url or not wallet_address:
        return []
    try:
        rows: List[Dict] = []
        for contract in TRON_USDT_CONTRACTS:
            params = {
                "only_confirmed": "true",
                "limit": 200,
                "contract_address": contract,
                "min_timestamp": int(min_timestamp_ms or 0),
            }
            payload = _fetch_json_with_fallback(api_url, api_key, f"accounts/{wallet_address}/transactions/trc20", params=params)
            rows.extend((payload or {}).get("data") or [])

        # Fallback without contract filter; keep only USDT by token symbol when provider supports it.
        if not rows:
            fallback_params = {
                "only_confirmed": "true",
                "limit": 200,
                "min_timestamp": int(min_timestamp_ms or 0),
            }
            payload = _fetch_json_with_fallback(api_url, api_key, f"accounts/{wallet_address}/transactions/trc20", params=fallback_params)
            raw_rows = (payload or {}).get("data") or []
            for row in raw_rows:
                token_info = row.get("token_info") or {}
                symbol = str(token_info.get("symbol") or "").strip().upper()
                contract_address = _normalize_contract_address(token_info.get("address") or row.get("token_id"))
                if symbol == "USDT" or contract_address in {_normalize_contract_address(c) for c in TRON_USDT_CONTRACTS}:
                    rows.append(row)

        dedup: Dict[str, Dict] = {}
        for row in rows:
            tx_hash = str(row.get("transaction_id") or "").strip()
            if tx_hash and tx_hash not in dedup:
                dedup[tx_hash] = row
        rows = list(dedup.values())
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
        if not items:
            tronscan_items = _get_tronscan_incoming_transfers(wallet_address, min_timestamp_ms=min_timestamp_ms)
            if tronscan_items:
                return tronscan_items
        return items
    except TronProviderError as exc:
        tronscan_items = _get_tronscan_incoming_transfers(wallet_address, min_timestamp_ms=min_timestamp_ms)
        if tronscan_items:
            return tronscan_items
        raise exc
    except Exception:
        return []
