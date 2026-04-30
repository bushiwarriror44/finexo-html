import { useEffect, useRef, useState } from "react";

export function WithdrawModal({ isOpen, withdrawableBalance, purchaseOnlyBalance = 0, initialAddress = "", onClose, onSubmit, t }) {
  const [asset] = useState("USDT");
  const [network] = useState("TRX");
  const [address, setAddress] = useState(initialAddress);
  const [memo, setMemo] = useState("");
  const [amount, setAmount] = useState("");
  const [confirmRisk, setConfirmRisk] = useState(false);
  const [securityCode, setSecurityCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState("form");
  const modalRef = useRef(null);
  const lastActiveRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    lastActiveRef.current = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    modalRef.current?.querySelector("input,button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      lastActiveRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setStep("form");
        setError("");
      }, 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isOpen]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!address.trim() || Number(amount) <= 0) {
      setError(t("dashboardCabinet.messages.invalidWithdrawalForm"));
      return;
    }
    if (Number(amount) > Number(withdrawableBalance || 0)) {
      setError(t("dashboardCabinet.messages.insufficientBalance", { defaultValue: "Insufficient balance." }));
      return;
    }
    if (!confirmRisk) {
      setError(t("dashboardCabinet.messages.confirmWithdrawalRisk", { defaultValue: "Confirm irreversible transaction risk first." }));
      return;
    }
    if (window.localStorage.getItem("cm_security_stepup") === "enabled" && securityCode.length < 6) {
      setError(t("dashboardCabinet.messages.invalidSecurityCode", { defaultValue: "Enter 6-digit security code." }));
      return;
    }
    if (step === "form") {
      setStep("review");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        asset,
        network,
        address: address.trim(),
        memo,
        amount: Number(amount),
      });
      onClose();
    } catch (submitError) {
      setError(submitError?.message || t("dashboardCabinet.messages.withdrawalFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    !isOpen ? null : (
    <div className="auth-modal-backdrop" onClick={onClose}>
      <div ref={modalRef} className="auth-modal-card topup-withdraw-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="auth-modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <h3 className="auth-modal-title">{t("dashboardCabinet.withdrawals.modalTitle", { defaultValue: "Withdraw funds" })}</h3>
        <form className="dash-form" onSubmit={submit}>
          {step === "form" ? (
            <>
              <label>{t("dashboardCabinet.table.asset")}</label>
              <input className="dash-input form-control" value={asset} disabled readOnly />
              <label>{t("dashboardCabinet.table.network")}</label>
              <input className="dash-input form-control" value={network} disabled readOnly />
              <label>{t("dashboardCabinet.withdrawals.address")}</label>
              <input className="dash-input form-control" value={address} onChange={(e) => setAddress(e.target.value)} />
              <label>{t("dashboardCabinet.withdrawals.memo")}</label>
              <input className="dash-input form-control" value={memo} onChange={(e) => setMemo(e.target.value)} />
              <label>{t("dashboardCabinet.table.amount")}</label>
              <input className="dash-input form-control" type="number" step="0.00000001" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {window.localStorage.getItem("cm_security_stepup") === "enabled" ? (
                <>
                  <label>{t("dashboardCabinet.withdrawals.securityCode", { defaultValue: "Security code" })}</label>
                  <input className="dash-input form-control" value={securityCode} onChange={(e) => setSecurityCode(e.target.value.replace(/\D/g, ""))} maxLength={6} />
                </>
              ) : null}
              <label className="dash-checkbox">
                <input type="checkbox" checked={confirmRisk} onChange={(e) => setConfirmRisk(e.target.checked)} />
                <span>{t("dashboardCabinet.withdrawals.riskConfirm", { defaultValue: "I understand withdrawals are irreversible after processing." })}</span>
              </label>
            </>
          ) : (
            <div className="dash-state-card">
              <p className="dash-state-title">{t("dashboardCabinet.withdrawals.reviewTitle", { defaultValue: "Review withdrawal request" })}</p>
              <p className="dash-state-description">{t("dashboardCabinet.table.asset", { defaultValue: "Asset" })}/{t("dashboardCabinet.table.network", { defaultValue: "Network" })}: {asset} / {network}</p>
              <p className="dash-state-description">{t("dashboardCabinet.withdrawals.address", { defaultValue: "Address" })}: {address}</p>
              <p className="dash-state-description">{t("dashboardCabinet.withdrawals.memo", { defaultValue: "Memo" })}: {memo || "-"}</p>
              <p className="dash-state-description">{t("dashboardCabinet.table.amount", { defaultValue: "Amount" })}: {amount}</p>
              <p className="dash-state-description">{t("dashboardCabinet.withdrawals.disclosure", { defaultValue: "Withdrawal requests are reviewed for security and compliance before execution." })}</p>
            </div>
          )}
          <p className="dash-help">{t("dashboardCabinet.withdrawals.available")}: ${Number(withdrawableBalance || 0).toFixed(2)}</p>
          <p className="dash-help">{t("dashboardCabinet.withdrawals.exactWithdrawable", { defaultValue: "Exact withdrawable amount" })}: ${Number(withdrawableBalance || 0).toFixed(2)}</p>
          <p className="dash-help">{t("dashboardCabinet.withdrawals.profitOnlyWithdrawableHint", { defaultValue: "Only profit/withdrawable balance can be withdrawn." })}</p>
          {Number(purchaseOnlyBalance || 0) > 0 ? (
            <p className="dash-alert is-warning">
              {t("dashboardCabinet.withdrawals.bonusNonWithdrawable", { defaultValue: "Bonus tokens are not withdrawable and can only be used for buying power/tariffs." })} (${Number(purchaseOnlyBalance || 0).toFixed(2)})
            </p>
          ) : null}
          <p className="dash-help">{t("dashboardCabinet.withdrawals.disclosure", { defaultValue: "Withdrawal requests are reviewed for security and compliance before execution." })}</p>
          {error ? <p className="dash-alert is-error">{error}</p> : null}
          <div className="dash-actions-cell">
            {step === "review" ? (
              <button className="dash-btn is-secondary is-sm" type="button" onClick={() => setStep("form")}>
                {t("dashboardCabinet.actions.back", { defaultValue: "Back" })}
              </button>
            ) : null}
            <button className="dash-btn is-warning" type="submit" disabled={busy}>
              {busy ? t("dashboardCabinet.actions.submitting") : step === "review" ? t("dashboardCabinet.actions.confirm", { defaultValue: "Confirm withdrawal" }) : t("dashboardCabinet.actions.continue", { defaultValue: "Continue" })}
            </button>
          </div>
        </form>
      </div>
    </div>
    )
  );
}
