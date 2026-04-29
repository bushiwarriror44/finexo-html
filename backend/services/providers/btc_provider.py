import requests


def verify_btc_transaction(api_url: str, api_key: str, tx_hash: str) -> dict:
    if not api_url:
        return {"confirmed": False, "errorCode": "PROVIDER_CONFIG", "message": "BTC api url is not configured"}

    params = {"token": api_key} if api_key else {}
    url = f"{api_url.rstrip('/')}/txs/{tx_hash}"
    response = requests.get(url, params=params, timeout=20)
    response.raise_for_status()
    payload = response.json()
    confirmations = int(payload.get("confirmations") or 0)
    return {
        "confirmed": confirmations > 0,
        "toAddress": None,
        "amount": str(payload.get("total")) if payload.get("total") is not None else None,
        "confirmations": confirmations,
        "message": f"confirmations={confirmations}" if confirmations > 0 else "pending",
        "errorCode": None if confirmations > 0 else "TX_NOT_CONFIRMED",
    }
