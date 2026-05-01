import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiActivity, FiAlertCircle, FiBarChart2, FiCheckCircle, FiClock, FiCreditCard, FiDollarSign, FiGrid, FiLifeBuoy, FiLoader, FiShield, FiShoppingBag, FiStar, FiTrendingUp, FiUserCheck, FiLock } from "react-icons/fi";
import { SectionHeading } from "../components/ui/SectionHeading";
import { apiGet, apiPost } from "../api/client";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/dashboard/StateBlocks";
import { ActionPopupCard } from "../components/dashboard/ActionPopupCard";

const DASHBOARD_LINKS = [
  { to: "/dashboard/overview", icon: FiGrid, i18nKey: "dashboardCabinet.tabs.overview" },
  { to: "/dashboard/balance", icon: FiBarChart2, i18nKey: "dashboardCabinet.tabs.balance" },
  { to: "/dashboard/topups", icon: FiCreditCard, i18nKey: "dashboardCabinet.tabs.topups" },
  { to: "/dashboard/buy-power", icon: FiShoppingBag, i18nKey: "dashboardCabinet.tabs.buyPower" },
  { to: "/dashboard/contracts", icon: FiTrendingUp, i18nKey: "dashboardCabinet.tabs.contracts" },
  { to: "/dashboard/staking", icon: FiStar, i18nKey: "dashboardCabinet.tabs.staking" },
  { to: "/dashboard/accruals", icon: FiActivity, i18nKey: "dashboardCabinet.tabs.accruals" },
  { to: "/dashboard/withdrawals", icon: FiDollarSign, i18nKey: "dashboardCabinet.tabs.withdrawals" },
  { to: "/dashboard/support", icon: FiLifeBuoy, i18nKey: "dashboardCabinet.tabs.support" },
  { to: "/dashboard/kyc", icon: FiUserCheck, i18nKey: "dashboardCabinet.tabs.kyc" },
  { to: "/dashboard/security", icon: FiLock, i18nKey: "dashboardCabinet.tabs.security" },
];

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [counters, setCounters] = useState({ topups: 0, withdrawals: 0, support: 0 });
  const [activityFeed, setActivityFeed] = useState([]);
  const [notificationFilters, setNotificationFilters] = useState({ category: "all", priority: "all", read: "all" });
  const [kycEnforcementActive, setKycEnforcementActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const [serverTimeBaseMs, setServerTimeBaseMs] = useState(null);
  const [serverTimeCapturedAtMs, setServerTimeCapturedAtMs] = useState(null);
  const [serverClockTick, setServerClockTick] = useState(0);
  const lastLoadAtRef = useRef(0);
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const [topups, withdrawals, tickets, kyc, notifications, balanceData] = await Promise.all([
        apiGet("/api/wallet/topups"),
        apiGet("/api/user/withdrawals"),
        apiGet("/api/user/support/tickets"),
        apiGet("/api/user/kyc"),
        apiGet(
          `/api/user/dashboard/notifications?category=${encodeURIComponent(notificationFilters.category)}&priority=${encodeURIComponent(
            notificationFilters.priority
          )}&read=${encodeURIComponent(notificationFilters.read)}`
        ),
        apiGet("/api/user/balance"),
      ]);
      const topupPending = (topups || []).filter((x) => ["pending", "queued", "running"].includes(String(x?.status || "").toLowerCase())).length;
      const withdrawalPending = (withdrawals || []).filter((x) => ["pending", "review"].includes(String(x?.status || "").toLowerCase())).length;
      const supportOpen = (tickets || []).filter((x) => String(x?.status || "").toLowerCase() !== "closed").length;
      setCounters({ topups: topupPending, withdrawals: withdrawalPending, support: supportOpen });

      const rawKyc = String(kyc?.rawStatus || kyc?.status || "not_started").toLowerCase();
      setKycEnforcementActive(Boolean(kyc?.verificationRequested) && rawKyc !== "approved");
      setActivityFeed(Array.isArray(notifications?.items) ? notifications.items : []);
      const parsedServerTime = Date.parse(String(balanceData?.serverTime || ""));
      if (Number.isFinite(parsedServerTime)) {
        setServerTimeBaseMs(parsedServerTime);
        setServerTimeCapturedAtMs(Date.now());
      }
      lastLoadAtRef.current = Date.now();
      setInitialLoaded(true);
    } catch {
      if (!silent) {
        setCounters({ topups: 0, withdrawals: 0, support: 0 });
        setActivityFeed([]);
        setKycEnforcementActive(false);
        setError(t("dashboardCabinet.messages.failedLoadOverview", { defaultValue: "Failed to load dashboard data." }));
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [notificationFilters.category, notificationFilters.priority, notificationFilters.read, t]);

  useEffect(() => {
    const timer = setTimeout(() => {
      load().catch(() => {});
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => {
      load({ silent: true }).catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => {
      setServerClockTick((v) => v + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/user/realtime/stream", { withCredentials: true });
    es.onopen = () => {};
    es.onerror = () => {};
    es.addEventListener("dashboard", () => {
      const now = Date.now();
      if (now - lastLoadAtRef.current < 60000) return;
      load({ silent: true }).catch(() => {});
    });
    return () => {
      es.close();
    };
  }, [load]);

  useEffect(() => {
    if (!status) return undefined;
    const timer = setTimeout(() => setStatus(""), 2200);
    return () => clearTimeout(timer);
  }, [status]);

  const badgeByRoute = useMemo(
    () => ({
      "/dashboard/topups": counters.topups,
      "/dashboard/withdrawals": counters.withdrawals,
      "/dashboard/support": counters.support,
    }),
    [counters]
  );

  const serverNowText = useMemo(() => {
    if (!Number.isFinite(serverTimeBaseMs) || !Number.isFinite(serverTimeCapturedAtMs)) {
      return t("dashboardCabinet.serverTime.loading", { defaultValue: "Syncing..." });
    }
    const elapsed = Math.max(0, Date.now() - serverTimeCapturedAtMs);
    const live = new Date(serverTimeBaseMs + elapsed);
    const locale = String(i18n?.language || "").toLowerCase().startsWith("ru") ? "ru-RU" : "en-GB";
    const datePart = live.toLocaleDateString(locale, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
    const timePart = live.toLocaleTimeString(locale, { timeZone: "UTC", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `${datePart} ${timePart} UTC`;
  }, [i18n?.language, serverClockTick, serverTimeBaseMs, serverTimeCapturedAtMs, t]);

  const contextualActions = useMemo(() => {
    const byPath = {
      "/dashboard/overview": [
        { to: "/dashboard/buy-power", label: t("dashboardCabinet.nextAction.buyPower", { defaultValue: "Start earning" }), icon: FiShoppingBag },
        { to: "/dashboard/topups", label: t("dashboardCabinet.nextAction.topup", { defaultValue: "Top up balance" }), icon: FiCreditCard },
        { to: "/dashboard/contracts", label: t("dashboardCabinet.nextAction.contracts", { defaultValue: "Review contracts" }), icon: FiTrendingUp },
        { to: "/dashboard/support", label: t("dashboardCabinet.nextAction.support", { defaultValue: "Check support updates" }), icon: FiLifeBuoy },
      ],
      "/dashboard/buy-power": [
        { to: "/dashboard/buy-power", label: t("dashboardCabinet.nextAction.buyPower", { defaultValue: "Start earning" }), icon: FiShoppingBag },
        { to: "/dashboard/topups", label: t("dashboardCabinet.nextAction.topup", { defaultValue: "Top up balance" }), icon: FiCreditCard },
        { to: "/dashboard/contracts", label: t("dashboardCabinet.nextAction.contracts", { defaultValue: "Review contracts" }), icon: FiTrendingUp },
      ],
      "/dashboard/topups": [
        { to: "/dashboard/topups", label: t("dashboardCabinet.topups.openModal", { defaultValue: "Open top-up modal" }), icon: FiCreditCard },
        { to: "/dashboard/balance", label: t("dashboardCabinet.tabs.balance"), icon: FiBarChart2 },
      ],
      "/dashboard/withdrawals": [
        { to: "/dashboard/withdrawals", label: t("dashboardCabinet.withdrawals.openModal", { defaultValue: "Open withdrawal modal" }), icon: FiDollarSign },
        { to: "/dashboard/support", label: t("dashboardCabinet.tabs.support"), icon: FiLifeBuoy },
      ],
      "/dashboard/support": [
        { to: "/dashboard/support", label: t("dashboardCabinet.support.createTicket", { defaultValue: "Create ticket" }), icon: FiLifeBuoy },
        { to: "/dashboard/overview", label: t("dashboardCabinet.tabs.overview"), icon: FiGrid },
      ],
      "/dashboard/kyc": [
        { to: "/dashboard/kyc", label: t("dashboardCabinet.tabs.kyc", { defaultValue: "KYC" }), icon: FiUserCheck },
        { to: "/dashboard/security", label: t("dashboardCabinet.tabs.security", { defaultValue: "Security" }), icon: FiLock },
      ],
      "/dashboard/security": [
        { to: "/dashboard/security", label: t("dashboardCabinet.tabs.security", { defaultValue: "Security" }), icon: FiLock },
        { to: "/dashboard/kyc", label: t("dashboardCabinet.tabs.kyc", { defaultValue: "KYC" }), icon: FiUserCheck },
      ],
    };
    return byPath[location.pathname] || byPath["/dashboard/overview"];
  }, [location.pathname, t]);

  return (
    <section className="why_section layout_padding dashboard_page">
      <div className="container-fluid dashboard-shell dashboard-shell-fluid">
        <SectionHeading title={t("sections.dashboardTitle")} />
        {kycEnforcementActive ? (
          <div className="dash-alert is-error">
            <strong><FiShield /> {t("dashboardCabinet.kyc.enforcementTitle", { defaultValue: "Please complete KYC verification." })}</strong>
            <p className="mb-0">
              {t("dashboardCabinet.kyc.enforcementMessage", {
                defaultValue:
                  "This is required for your safety. Withdrawal requests are temporarily frozen by administration until your verification is approved.",
              })}
            </p>
          </div>
        ) : null}
        <ErrorState message={error} onRetry={() => load().catch(() => {})} retryLabel={t("dashboardCabinet.actions.retry")} />
        {status ? <p className="dash-alert is-success">{status}</p> : null}
        {loading && !initialLoaded ? <LoadingSkeleton rows={2} /> : null}
        <p className="dash-help">
          {t("dashboardCabinet.serverTime.label", { defaultValue: "Server time" })}: <strong>{serverNowText}</strong>
        </p>
        <ActionPopupCard
          icon={FiTrendingUp}
          title={t("dashboardCabinet.nextAction.buyPower", { defaultValue: "Start earning!" })}
          description={t("dashboardCabinet.overview.buyPowerHint", { defaultValue: "Откройте экран тарифов и купите мощность прямо из кабинета." })}
          ctaLabel={t("dashboardCabinet.buyPower.open", { defaultValue: "Открыть покупку" })}
          onClick={() => navigate("/dashboard/buy-power")}
          tone="primary"
        />
        <div className="dashboard-layout">
          <aside className="dashboard-sidebar">
            <nav className="dashboard-subnav" aria-label="Dashboard modules">
              {DASHBOARD_LINKS.map((link) => (
                <NavLink
                  key={link.to}
                  className={({ isActive }) => `dashboard-subnav-link ${isActive ? "is-active" : ""}`}
                  to={link.to}
                >
                  <link.icon aria-hidden="true" />
                  <span>{t(link.i18nKey)}</span>
                  {badgeByRoute[link.to] ? (
                    <em className={`dashboard-subnav-counter ${link.to === "/dashboard/withdrawals" ? "is-danger" : "is-warning"}`}>
                      {badgeByRoute[link.to]}
                    </em>
                  ) : null}
                </NavLink>
              ))}
            </nav>
            <div className="dashboard-panel dashboard-sidebar-panel">
              <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.notifications", { defaultValue: "Notification center" })}</h5></div>
              <div className="dashboard-panel-body">
                <div className="dash-chip-row">
                  {["all", "payments", "withdrawals", "support", "compliance"].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`dash-chip ${notificationFilters.category === value ? "is-active" : ""}`}
                      onClick={() => setNotificationFilters((prev) => ({ ...prev, category: value }))}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                {activityFeed.length === 0 ? (
                  <EmptyState title={t("dashboardCabinet.empty.noNotifications", { defaultValue: "No notifications right now" })} />
                ) : (
                  activityFeed.map((item) => (
                    <button
                      key={item.id}
                      className={`dash-link-row ${item.isRead ? "" : "is-unread"}`}
                      type="button"
                      onClick={async () => {
                        try {
                          await apiPost(`/api/user/dashboard/notifications/${item.id}/read`, { isRead: true });
                        } catch (_err) {
                          void _err;
                        }
                        if (item.deepLink) navigate(item.deepLink);
                        load().catch(() => {});
                      }}
                    >
                      <strong>{item.title}</strong>
                      <span>{item.message}</span>
                    </button>
                  ))
                )}
                <button
                  className="dash-btn is-secondary is-sm"
                  type="button"
                  disabled={markAllBusy || activityFeed.every((item) => item.isRead)}
                  onClick={async () => {
                    setError("");
                    setMarkAllBusy(true);
                    try {
                      await apiPost("/api/user/dashboard/notifications/mark-all-read", {});
                      setActivityFeed((prev) => prev.map((item) => ({ ...item, isRead: true })));
                      setStatus(t("dashboardCabinet.messages.saved", { defaultValue: "Changes saved." }));
                      load({ silent: true }).catch(() => {});
                    } catch (err) {
                      setError(
                        err?.message ||
                          t("dashboardCabinet.messages.failedLoadOverview", {
                            defaultValue: "Failed to process request.",
                          })
                      );
                    } finally {
                      setMarkAllBusy(false);
                    }
                  }}
                >
                  {markAllBusy
                    ? t("dashboardCabinet.actions.submitting", { defaultValue: "Submitting..." })
                    : t("dashboardCabinet.notificationsMarkAllRead", { defaultValue: "Mark all read" })}
                </button>
              </div>
            </div>
          </aside>
          <div className="dashboard-content">
            <div className="dashboard-action-strip dashboard-action-strip-sticky">
              {contextualActions.map((action) => (
                <NavLink key={`${action.to}-${action.label}`} to={action.to} className="dashboard-action-pill">
                  {action.icon ? <action.icon aria-hidden="true" /> : null}
                  {action.label}
                </NavLink>
              ))}
            </div>
            <Outlet />
          </div>
        </div>
      </div>
      {kycEnforcementActive ? (
        <div className="auth-modal-backdrop" onClick={(e) => e.preventDefault()}>
          <div className="auth-modal-card topup-withdraw-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="auth-modal-title">
              <FiShield /> {t("dashboardCabinet.kyc.enforcementTitle", { defaultValue: "Please complete KYC verification." })}
            </h3>
            <p className="dash-help">
              {t("dashboardCabinet.kyc.enforcementMessage", {
                defaultValue:
                  "This is required for your safety. Withdrawal requests are temporarily frozen by administration until your verification is approved.",
              })}
            </p>
            <div className="dash-actions-cell">
              <NavLink className="dash-btn is-primary" to="/dashboard/overview">
                {t("dashboardCabinet.kyc.enforcementCta", { defaultValue: "Go to KYC verification" })}
              </NavLink>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
