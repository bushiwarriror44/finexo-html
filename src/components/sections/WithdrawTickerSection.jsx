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
  const loopRows = [...TICKER_ROWS, ...TICKER_ROWS];
  return (
    <section className="withdraw-ticker-section" aria-label="Лента выводов">
      <div className="container">
        <div className="withdraw-ticker-shell">
          <div className="withdraw-ticker-track">
            {loopRows.map((row, index) => (
              <span className="withdraw-ticker-item" key={`${row.name}-${row.asset}-${index}`}>
                <span className="withdraw-ticker-user">{row.name}</span>
                <span className="withdraw-ticker-verb">вывел</span>
                <span className="withdraw-ticker-amount">{row.amount}</span>
                <span className={`withdraw-ticker-asset is-${row.asset.toLowerCase()}`}>{row.asset}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
