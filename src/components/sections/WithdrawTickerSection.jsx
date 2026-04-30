import { useState } from "react";

const BASE_NAMES = [
  "Dev",
  "cryptobro",
  "hashking",
  "satoshi_ru",
  "minerx",
  "chainwolf",
  "btcfox",
  "asicsam",
  "blockqueen",
  "noderun",
];

const ASSETS = ["BTC", "USDT", "LTC", "KAS", "DOGE"];
const ASSET_ICONS = {
  BTC: "/images/crypto/bitcoin.svg",
  USDT: "/images/crypto/usdt-circle.svg",
  LTC: "/images/crypto/litecoin.svg",
  KAS: "/images/crypto/kaspa.svg",
  DOGE: "/images/crypto/dogecoin.svg",
};

function maskNickname(name) {
  const safe = String(name || "");
  if (!safe) return "***";
  if (safe.length <= 3) return "*".repeat(safe.length);
  return `${safe.slice(0, -3)}***`;
}

function buildTickerRows() {
  const rows = [];
  for (let i = 0; i < 100; i += 1) {
    const name = `${BASE_NAMES[i % BASE_NAMES.length]}${i + 1}`;
    const asset = ASSETS[i % ASSETS.length];
    const amountRaw = asset === "BTC" ? (0.08 + ((i * 7) % 43) / 100) : 150 + ((i * 431) % 9200);
    const amount = asset === "BTC" ? amountRaw.toFixed(2) : amountRaw.toFixed(0);
    rows.push({ name, amount, asset });
  }
  return rows;
}

const TICKER_ROWS = buildTickerRows();

export function WithdrawTickerSection() {
  const [failedIconAssets, setFailedIconAssets] = useState({});
  const loopRows = [...TICKER_ROWS, ...TICKER_ROWS];

  const handleIconError = (asset) => {
    setFailedIconAssets((prev) => ({ ...prev, [asset]: true }));
  };

  return (
    <section className="withdraw-ticker-section" aria-label="Лента выводов">
      <div className="withdraw-ticker-shell">
        <div className="withdraw-ticker-track">
          {loopRows.map((row, index) => (
            <span className="withdraw-ticker-item" key={`${row.name}-${row.asset}-${index}`}>
              <span className="withdraw-ticker-user">{maskNickname(row.name)}</span>
              <span className="withdraw-ticker-verb">вывел</span>
              <span className="withdraw-ticker-amount">{row.amount}</span>
              {failedIconAssets[row.asset] || !ASSET_ICONS[row.asset] ? (
                <span className={`withdraw-ticker-asset is-${row.asset.toLowerCase()}`}>{row.asset}</span>
              ) : (
                <img
                  className="withdraw-ticker-asset-icon"
                  src={ASSET_ICONS[row.asset]}
                  alt={row.asset}
                  loading="lazy"
                  onError={() => handleIconError(row.asset)}
                />
              )}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
