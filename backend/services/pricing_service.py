import os
import time
from decimal import Decimal

import requests

from models import PaymentConversionRate, db

COINGECKO_SIMPLE_PRICE_URL = os.getenv("COINGECKO_SIMPLE_PRICE_URL", "https://api.coingecko.com/api/v3/simple/price")
COINGECKO_CACHE_TTL_SECONDS = int(os.getenv("COINGECKO_CACHE_TTL_SECONDS", "60"))

ASSET_TO_COINGECKO_ID = {
    "USDT": "tether",
    "USDC": "usd-coin",
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "DOGE": "dogecoin",
    "LTC": "litecoin",
    "KAS": "kaspa",
}

_PRICE_CACHE: dict[str, tuple[float, Decimal]] = {}


def _fetch_price_usd(asset: str) -> Decimal:
    asset = (asset or "").strip().upper()
    if asset == "USDT":
        return Decimal("1")
    cached = _PRICE_CACHE.get(asset)
    now = time.time()
    if cached and now - cached[0] < COINGECKO_CACHE_TTL_SECONDS:
        return cached[1]

    coin_id = ASSET_TO_COINGECKO_ID.get(asset)
    if not coin_id:
        raise ValueError(f"unsupported asset for conversion: {asset}")
    response = requests.get(
        COINGECKO_SIMPLE_PRICE_URL,
        params={"ids": coin_id, "vs_currencies": "usd"},
        timeout=10,
    )
    response.raise_for_status()
    payload = response.json() or {}
    usd = payload.get(coin_id, {}).get("usd")
    if usd is None:
        raise ValueError(f"missing conversion price for asset: {asset}")
    price = Decimal(str(usd))
    _PRICE_CACHE[asset] = (now, price)
    return price


def convert_to_usdt(asset: str, amount) -> dict:
    asset = (asset or "").strip().upper()
    amount = Decimal(str(amount or "0"))
    if amount <= 0:
        raise ValueError("amount must be positive")
    rate = _fetch_price_usd(asset)
    converted = amount * rate
    return {
        "source": "coingecko",
        "baseAsset": asset,
        "quoteAsset": "USDT",
        "rate": rate,
        "originalAmount": amount,
        "convertedAmount": converted,
        "timestamp": int(time.time()),
    }


def save_conversion_snapshot(*, source: str, base_asset: str, rate, original_amount, converted_amount, topup_id=None, contract_id=None):
    row = PaymentConversionRate(
        source=source,
        base_asset=base_asset,
        quote_asset="USDT",
        rate=rate,
        original_amount=original_amount,
        converted_amount=converted_amount,
        topup_id=topup_id,
        contract_id=contract_id,
    )
    db.session.add(row)
    db.session.commit()
    return row
