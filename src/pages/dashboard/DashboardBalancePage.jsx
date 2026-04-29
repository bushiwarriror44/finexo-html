import { useEffect, useState } from "react";
import { apiGet } from "../../api/client";
import { useTranslation } from "react-i18next";
import { getSafeErrorMessage, money, normalizeApiList } from "./utils";
import { EmptyState, ErrorState, LoadingSkeleton } from "../../components/dashboard/StateBlocks";
import { FiBarChart2, FiDollarSign, FiLock } from "react-icons/fi";

export function DashboardBalancePage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [balance, setBalance] = useState(0);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [heldBalance, setHeldBalance] = useState(0);
  const [entries, setEntries] = useState([]);
  const [filterType, setFilterType] = useState("all");
  const [search, setSearch] = useState("");
  const [periodPreset, setPeriodPreset] = useState("all");
  const [loaded, setLoaded] = useState(false);
  const filteredEntries = entries.filter((entry) => {
    if (periodPreset === "credit" && String(entry.entryType || "").toLowerCase() !== "credit") return false;
    if (periodPreset === "debit" && String(entry.entryType || "").toLowerCase() !== "debit") return false;
    const type = String(entry.entryType || "").toLowerCase();
    if (filterType !== "all" && type !== filterType) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [entry.reason, entry.entryType, String(entry.amount), String(entry.id)].join(" ").toLowerCase().includes(term);
  });

  const exportCsv = () => {
    const rows = [["id", "type", "amount", "reason"], ...filteredEntries.map((e) => [e.id, e.entryType, e.amount, e.reason])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ledger.csv";
    link.click();
    URL.revokeObjectURL(url);
  };


  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGet("/api/user/balance");
      setBalance(Number(data.balance || 0));
      setAvailableBalance(Number(data.availableBalance || 0));
      setHeldBalance(Number(data.heldBalance || 0));
      setEntries(normalizeApiList(data.entries));
      setLoaded(true);
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.failedLoadBalance")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  return (
    <>
      <ErrorState message={error} onRetry={() => load().catch(() => {})} retryLabel={t("dashboardCabinet.actions.retry")} />
      {loading ? <LoadingSkeleton rows={3} /> : null}
      <div className="dashboard-grid dashboard-grid-5">
        <article className="dashboard-panel metric-card">
          <FiBarChart2 className="metric-icon" />
          <p className="metric-label">{t("dashboardCabinet.metrics.balance")}</p>
          <h4 className="metric-value">{money(balance)}</h4>
        </article>
        <article className="dashboard-panel metric-card">
          <FiDollarSign className="metric-icon" />
          <p className="metric-label">{t("dashboardCabinet.metrics.available")}</p>
          <h4 className="metric-value">{money(availableBalance)}</h4>
        </article>
        <article className="dashboard-panel metric-card">
          <FiLock className="metric-icon" />
          <p className="metric-label">{t("dashboardCabinet.metrics.held")}</p>
          <h4 className="metric-value">{money(heldBalance)}</h4>
        </article>
      </div>
      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.balance.ledgerHistory")}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.balance.hint", { defaultValue: "Use filters to audit entries and export the current view when needed." })}</p>
            <p className="dash-help">{t("dashboardCabinet.overview.hourlyUpdateHint", { defaultValue: "Mining earnings are updated hourly and displayed with 4 decimal precision." })}</p>
            <div className="dash-table-toolbar">
              <div className="dash-chip-row">
                <button type="button" className={`dash-chip ${periodPreset === "all" ? "is-active" : ""}`} onClick={() => setPeriodPreset("all")}>
                  {t("dashboardCabinet.actions.all", { defaultValue: "All" })}
                </button>
                <button type="button" className={`dash-chip ${periodPreset === "credit" ? "is-active" : ""}`} onClick={() => setPeriodPreset("credit")}>
                  Credit
                </button>
                <button type="button" className={`dash-chip ${periodPreset === "debit" ? "is-active" : ""}`} onClick={() => setPeriodPreset("debit")}>
                  Debit
                </button>
              </div>
              <input className="dash-input" placeholder={t("dashboardCabinet.actions.search", { defaultValue: "Search..." })} value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className="dash-input dash-select-sm" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="all">{t("dashboardCabinet.balance.allTypes", { defaultValue: "All types" })}</option>
                <option value="credit">credit</option>
                <option value="debit">debit</option>
              </select>
              <button className="dash-btn is-secondary is-sm" type="button" onClick={exportCsv}>
                {t("dashboardCabinet.balance.exportCsv", { defaultValue: "Export CSV" })}
              </button>
            </div>
            <p className="dash-help">
              {t("dashboardCabinet.balance.summary", { defaultValue: "Entries" })}: {filteredEntries.length} | {t("dashboardCabinet.balance.net", { defaultValue: "Net" })}: {money(filteredEntries.reduce((sum, item) => sum + Number(item.amount || 0), 0))}
            </p>
            <div className="table-shell">
              <table className="dash-table">
                <thead><tr><th>ID</th><th>{t("dashboardCabinet.table.type")}</th><th>{t("dashboardCabinet.table.amount")}</th><th>{t("dashboardCabinet.balance.running", { defaultValue: "Running" })}</th><th>{t("dashboardCabinet.table.reason")}</th></tr></thead>
                <tbody>
                  {loaded && filteredEntries.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <EmptyState title={t("dashboardCabinet.empty.noLedgerEntries")} />
                      </td>
                    </tr>
                  ) : filteredEntries.map((entry, index) => (
                    <tr key={entry.id}>
                      <td data-label="ID">{entry.id}</td>
                      <td data-label={t("dashboardCabinet.table.type")}>{entry.entryType}</td>
                      <td data-label={t("dashboardCabinet.table.amount")}>{money(entry.amount)}</td>
                      <td data-label={t("dashboardCabinet.balance.running", { defaultValue: "Running" })}>{money(filteredEntries.slice(0, index + 1).reduce((sum, item) => sum + Number(item.amount || 0), 0))}</td>
                      <td data-label={t("dashboardCabinet.table.reason")}>{entry.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
