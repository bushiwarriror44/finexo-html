import requests


def verify_evm_transaction(api_url: str, api_key: str, tx_hash: str) -> dict:
    if not api_url:
        return {"confirmed": False, "errorCode": "PROVIDER_CONFIG", "message": "EVM api url is not configured"}

    params = {
        "module": "transaction",
        "action": "gettxreceiptstatus",
        "txhash": tx_hash,
    }
    if api_key:
        params["apikey"] = api_key

    response = requests.get(api_url, params=params, timeout=20)
    response.raise_for_status()
    payload = response.json()
    result = payload.get("result", {})
    status = result.get("status")
    tx_result = {
        "confirmed": status == "1",
        "toAddress": None,
        "amount": None,
        "confirmations": int(result.get("confirmations") or 0),
        "message": "confirmed" if status == "1" else payload.get("message", "pending"),
        "errorCode": None if status == "1" else "TX_NOT_CONFIRMED",
    }
    return tx_result
