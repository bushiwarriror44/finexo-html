import { useEffect, useMemo, useRef, useState } from "react";

export function TopupModal({ isOpen, wallets, onClose, onSubmit, t }) {
  const quickAmounts = [100, 300, 500, 1000];
  const [walletId, setWalletId] = useState("");
  const [txHash, setTxHash] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState("form");
  const modalRef = useRef(null);
  const lastActiveRef = useRef(null);

  const selectedWallet = useMemo(
    () => wallets.find((w) => String(w.id) === String(walletId)) || wallets[0] || null,
    [walletId, wallets]
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    lastActiveRef.current = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    modalRef.current?.querySelector("input,select,button")?.focus();
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
    const targetWalletId = walletId || selectedWallet?.id;
    if (!targetWalletId || !txHash.trim() || Number(amount) <= 0) {
      setError(t("dashboardCabinet.messages.invalidTopupForm"));
      return;
    }
    if (step === "form") {
      setStep("review");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        walletId: Number(targetWalletId),
        txHash: txHash.trim(),
        amount: Number(amount),
      });
      setTxHash("");
      setAmount("");
      setWalletId("");
      onClose();
    } catch (submitError) {
      setError(submitError?.message || t("dashboardCabinet.messages.topupSubmitFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    !isOpen ? null : (
    <div className="auth-modal-backdrop" onClick={onClose}>
      <div ref={modalRef} className="auth-modal-card topup-withdraw-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="auth-modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <h3 className="auth-modal-title">{t("dashboardCabinet.topups.modalTitle", { defaultValue: "Top-up balance" })}</h3>
        {!selectedWallet ? (
          <p className="dash-alert is-error">{t("dashboardCabinet.topups.noWallet", { defaultValue: "USDT TRON wallet is not configured yet. Please contact support." })}</p>
        ) : null}
        <form className="dash-form" onSubmit={submit}>
          {step === "form" ? (
            <>
              <label htmlFor="modal-topup-wallet">{t("dashboardCabinet.topups.wallet")}</label>
              <input
                id="modal-topup-wallet"
                className="dash-input form-control"
                value={selectedWallet ? `${selectedWallet.asset} / ${selectedWallet.network}` : "USDT / TRX"}
                disabled
              />
              {selectedWallet ? <p className="dash-help">{t("dashboardCabinet.topups.sendTo")}: {selectedWallet.address}</p> : null}
              <label htmlFor="modal-topup-hash">{t("dashboardCabinet.topups.txHash")}</label>
              <input id="modal-topup-hash" className="dash-input form-control" value={txHash} onChange={(e) => setTxHash(e.target.value)} />
              <label htmlFor="modal-topup-amount">{t("dashboardCabinet.table.amount")}</label>
              <input id="modal-topup-amount" className="dash-input form-control" type="number" step="0.00000001" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <div className="d-flex flex-wrap gap-2 mt-2 mb-1">
                {quickAmounts.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="dash-btn is-secondary is-sm"
                    onClick={() => setAmount(String(value))}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="dash-state-card">
              <p className="dash-state-title">{t("dashboardCabinet.topups.reviewTitle", { defaultValue: "Review top-up request" })}</p>
              <p className="dash-state-description">{t("dashboardCabinet.topups.wallet", { defaultValue: "Wallet" })}: {selectedWallet?.asset} / {selectedWallet?.network}</p>
              <p className="dash-state-description">{t("dashboardCabinet.withdrawals.address", { defaultValue: "Address" })}: {selectedWallet?.address || "-"}</p>
              <p className="dash-state-description">{t("dashboardCabinet.topups.txHash", { defaultValue: "Transaction hash" })}: {txHash}</p>
              <p className="dash-state-description">{t("dashboardCabinet.table.amount", { defaultValue: "Amount" })}: {amount}</p>
            </div>
          )}
          <p className="dash-help">{t("dashboardCabinet.topups.disclosure", { defaultValue: "Funds are credited after blockchain confirmation and compliance checks." })}</p>
          {error ? <p className="dash-alert is-error">{error}</p> : null}
          <div className="dash-actions-cell">
            {step === "review" ? (
              <button className="dash-btn is-secondary is-sm" type="button" onClick={() => setStep("form")}>
                {t("dashboardCabinet.actions.back", { defaultValue: "Back" })}
              </button>
            ) : null}
            <button className="dash-btn is-primary" type="submit" disabled={busy || !selectedWallet}>
              {busy ? t("dashboardCabinet.actions.submitting") : step === "review" ? t("dashboardCabinet.actions.confirm", { defaultValue: "Confirm top-up" }) : t("dashboardCabinet.actions.continue", { defaultValue: "Continue" })}
            </button>
          </div>
        </form>
      </div>
    </div>
    )
  );
}
