from services.providers.btc_provider import verify_btc_transaction
from services.providers.evm_provider import verify_evm_transaction
from services.providers.tron_provider import verify_tron_transaction


def verify_with_provider(provider: str, api_url: str, api_key: str, tx_hash: str) -> tuple[bool, str]:
    if provider == "tron":
        return verify_tron_transaction(api_url, api_key, tx_hash)
    if provider == "evm":
        return verify_evm_transaction(api_url, api_key, tx_hash)
    if provider == "btc":
        return verify_btc_transaction(api_url, api_key, tx_hash)
    return {"confirmed": False, "errorCode": "UNSUPPORTED_PROVIDER", "message": "unsupported provider"}
