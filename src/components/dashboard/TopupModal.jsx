import { useEffect, useMemo, useRef, useState } from "react";
import { FiCopy } from "react-icons/fi";
import { copyTextWithFeedback } from "../../pages/dashboard/utils";

export function TopupModal({ isOpen, wallets, onClose, onSubmit, t }) {
  const quickAmounts = [100, 300, 500, 1000];
  const [walletId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState("form");
  const [reservedTopup, setReservedTopup] = useState(null);
  const [copyToastVisible, setCopyToastVisible] = useState(false);
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
        setReservedTopup(null);
        setCopyToastVisible(false);
      }, 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isOpen]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (step === "review") {
      setAmount("");
      onClose();
      return;
    }
    const targetWalletId = walletId || selectedWallet?.id;
    if (!targetWalletId || Number(amount) <= 0) {
      setError(t("dashboardCabinet.messages.invalidTopupForm"));
      return;
    }
    setBusy(true);
    try {
      const result = await onSubmit({
        walletId: Number(targetWalletId),
        amount: Number(amount),
      });
      setReservedTopup(result?.topup || null);
      setStep("review");
    } catch (submitError) {
      setError(submitError?.message || t("dashboardCabinet.messages.topupSubmitFailed"));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!copyToastVisible) return undefined;
    const timer = setTimeout(() => setCopyToastVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [copyToastVisible]);

  const expectedAmount = useMemo(() => {
    if (reservedTopup?.expectedAmount) return Number(reservedTopup.expectedAmount).toFixed(8);
    return Number(amount || 0).toFixed(8);
  }, [amount, reservedTopup]);

  const qrValue = useMemo(() => {
    if (!selectedWallet?.address) return "";
    return `tron:${selectedWallet.address}?amount=${expectedAmount}&token=USDT`;
  }, [expectedAmount, selectedWallet]);

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
              <label htmlFor="modal-topup-address">{t("dashboardCabinet.topups.sendTo")}</label>
              <div style={{ position: "relative" }}>
                <input
                  id="modal-topup-address"
                  className="dash-input form-control"
                  value={selectedWallet?.address || ""}
                  readOnly
                  disabled
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  className="dash-btn is-secondary is-sm"
                  aria-label={t("dashboardCabinet.actions.copy", { defaultValue: "Copy" })}
                  onClick={async () => {
                    const ok = await copyTextWithFeedback(selectedWallet?.address || "");
                    if (ok) setCopyToastVisible(true);
                  }}
                  style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", padding: "4px 8px" }}
                >
                  <FiCopy />
                </button>
              </div>
              <label htmlFor="modal-topup-amount">{t("dashboardCabinet.table.amount")}</label>
              <input id="modal-topup-amount" className="dash-input form-control" type="number" step="0.00000001" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className="dash-help">
                {t("dashboardCabinet.topups.amountToPay", { defaultValue: "Amount to pay" })}: <strong>{expectedAmount} USDT</strong>
              </p>
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
              <p className="dash-state-title">{t("dashboardCabinet.topups.reviewTitle", { defaultValue: "Top-up payment details" })}</p>
              <p className="dash-state-description">{t("dashboardCabinet.topups.wallet", { defaultValue: "Wallet" })}: {selectedWallet?.asset} / {selectedWallet?.network}</p>
              <p className="dash-state-description">{t("dashboardCabinet.withdrawals.address", { defaultValue: "Address" })}: {selectedWallet?.address || "-"}</p>
              <p className="dash-state-description">{t("dashboardCabinet.table.amount", { defaultValue: "Base amount" })}: {Number(reservedTopup?.baseAmount || amount || 0).toFixed(8)} USDT</p>
              <p className="dash-state-description"><strong>{t("dashboardCabinet.topups.amountToPay", { defaultValue: "Amount to pay" })}: {expectedAmount} USDT</strong></p>
              <p className="dash-state-description">{t("dashboardCabinet.topups.paymentWindow", { defaultValue: "Payment window" })}: 60 min</p>
              {qrValue ? (
                <div className="text-center mt-2">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrValue)}`}
                    alt="Top-up QR"
                    width="180"
                    height="180"
                  />
                </div>
              ) : null}
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
              {busy ? t("dashboardCabinet.actions.submitting") : step === "review" ? t("dashboardCabinet.actions.close", { defaultValue: "Close" }) : t("dashboardCabinet.actions.continue", { defaultValue: "Continue" })}
            </button>
          </div>
        </form>
        {copyToastVisible ? (
          <div className="dash-copy-toast" role="status" aria-live="polite">
            адресс скопирован
          </div>
        ) : null}
      </div>
    </div>
    )
  );
}
