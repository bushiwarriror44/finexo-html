import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiActivity, FiAlertCircle, FiBarChart2, FiCheckCircle, FiClock, FiCreditCard, FiDollarSign, FiGrid, FiLifeBuoy, FiLoader, FiShield, FiShoppingBag, FiStar, FiTrendingUp } from "react-icons/fi";
import { SectionHeading } from "../components/ui/SectionHeading";
import { apiGet, apiPost } from "../api/client";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/dashboard/StateBlocks";

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
];

export function DashboardPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [counters, setCounters] = useState({ topups: 0, withdrawals: 0, support: 0 });
  const [nextAction, setNextAction] = useState({ key: "topup", to: "/dashboard/topups" });
  const [activityFeed, setActivityFeed] = useState([]);
  const [notificationFilters, setNotificationFilters] = useState({ category: "all", priority: "all", read: "all" });
  const [checklist, setChecklist] = useState([]);
  const [kycEnforcementActive, setKycEnforcementActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [topups, withdrawals, tickets, kyc, notifications, checklistData, workflow] = await Promise.all([
        apiGet("/api/wallet/topups"),
        apiGet("/api/user/withdrawals"),
        apiGet("/api/user/support/tickets"),
        apiGet("/api/user/kyc"),
        apiGet(
          `/api/user/dashboard/notifications?category=${encodeURIComponent(notificationFilters.category)}&priority=${encodeURIComponent(
            notificationFilters.priority
          )}&read=${encodeURIComponent(notificationFilters.read)}`
        ),
        apiGet("/api/user/dashboard/onboarding-checklist"),
        apiGet("/api/user/dashboard/workflow"),
      ]);
      const topupPending = (topups || []).filter((x) => ["pending", "queued", "running"].includes(String(x?.status || "").toLowerCase())).length;
      const withdrawalPending = (withdrawals || []).filter((x) => ["pending", "review"].includes(String(x?.status || "").toLowerCase())).length;
      const supportOpen = (tickets || []).filter((x) => String(x?.status || "").toLowerCase() !== "closed").length;
      setCounters({ topups: topupPending, withdrawals: withdrawalPending, support: supportOpen });

      if (workflow?.nextAction?.key && workflow?.nextAction?.deepLink) {
        setNextAction({ key: workflow.nextAction.key, to: workflow.nextAction.deepLink });
      } else if ((kyc?.status || "not_started") === "not_started") {
        setNextAction({ key: "kyc", to: "/dashboard/overview" });
      } else if (topupPending === 0) {
        setNextAction({ key: "topup", to: "/dashboard/topups" });
      } else {
        setNextAction({ key: "contracts", to: "/dashboard/contracts" });
      }
      const rawKyc = String(kyc?.rawStatus || kyc?.status || "not_started").toLowerCase();
      setKycEnforcementActive(Boolean(kyc?.verificationRequested) && rawKyc !== "approved");
      setChecklist(Array.isArray(checklistData?.items) ? checklistData.items : []);
      setActivityFeed(Array.isArray(notifications?.items) ? notifications.items : []);
    } catch {
      setCounters({ topups: 0, withdrawals: 0, support: 0 });
      setActivityFeed([]);
      setKycEnforcementActive(false);
      setError(t("dashboardCabinet.messages.failedLoadOverview", { defaultValue: "Failed to load dashboard data." }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {});
  }, [notificationFilters.category, notificationFilters.priority, notificationFilters.read]);

  useEffect(() => {
    const es = new EventSource("/api/user/realtime/stream", { withCredentials: true });
    es.onopen = () => setRealtimeConnected(true);
    es.onerror = () => setRealtimeConnected(false);
    es.addEventListener("dashboard", () => {
      load().catch(() => {});
    });
    return () => {
      es.close();
      setRealtimeConnected(false);
    };
  }, []);

  const badgeByRoute = useMemo(
    () => ({
      "/dashboard/topups": counters.topups,
      "/dashboard/withdrawals": counters.withdrawals,
      "/dashboard/support": counters.support,
    }),
    [counters]
  );

  const contextualActions = useMemo(() => {
    const byPath = {
      "/dashboard/overview": [
        { to: "/dashboard/buy-power", label: t("dashboardCabinet.nextAction.buyPower", { defaultValue: "Start earning" }) },
        { to: "/dashboard/topups", label: t("dashboardCabinet.nextAction.topup", { defaultValue: "Top up balance" }) },
        { to: "/dashboard/contracts", label: t("dashboardCabinet.nextAction.contracts", { defaultValue: "Review contracts" }) },
        { to: "/dashboard/support", label: t("dashboardCabinet.nextAction.support", { defaultValue: "Check support updates" }) },
      ],
      "/dashboard/buy-power": [
        { to: "/dashboard/buy-power", label: t("dashboardCabinet.nextAction.buyPower", { defaultValue: "Start earning" }) },
        { to: "/dashboard/topups", label: t("dashboardCabinet.nextAction.topup", { defaultValue: "Top up balance" }) },
        { to: "/dashboard/contracts", label: t("dashboardCabinet.nextAction.contracts", { defaultValue: "Review contracts" }) },
      ],
      "/dashboard/topups": [
        { to: "/dashboard/topups", label: t("dashboardCabinet.topups.openModal", { defaultValue: "Open top-up modal" }) },
        { to: "/dashboard/balance", label: t("dashboardCabinet.tabs.balance") },
      ],
      "/dashboard/withdrawals": [
        { to: "/dashboard/withdrawals", label: t("dashboardCabinet.withdrawals.openModal", { defaultValue: "Open withdrawal modal" }) },
        { to: "/dashboard/support", label: t("dashboardCabinet.tabs.support") },
      ],
      "/dashboard/support": [
        { to: "/dashboard/support", label: t("dashboardCabinet.support.createTicket", { defaultValue: "Create ticket" }) },
        { to: "/dashboard/overview", label: t("dashboardCabinet.tabs.overview") },
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
        {loading ? <LoadingSkeleton rows={2} /> : null}
        <div className="dashboard-next-action">
          <p>
            <strong>{t("dashboardCabinet.nextActionTitle", { defaultValue: "Next best action:" })}</strong>{" "}
            {t(`dashboardCabinet.nextAction.${nextAction.key}`, { defaultValue: "Complete your account workflow." })}
          </p>
          <NavLink to={nextAction.to} className="dash-btn is-primary is-sm">
            {t("dashboardCabinet.nextAction.open", { defaultValue: "Open" })}
          </NavLink>
        </div>
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
                        } catch {}
                        if (item.deepLink) navigate(item.deepLink);
                        load().catch(() => {});
                      }}
                    >
                      <strong>{item.title}</strong>
                      <span>{item.message}</span>
                    </button>
                  ))
                )}
                <button className="dash-btn is-secondary is-sm" type="button" onClick={() => apiPost("/api/user/dashboard/notifications/mark-all-read", {}).then(() => load().catch(() => {}))}>
                  {t("dashboardCabinet.notificationsMarkAllRead", { defaultValue: "Mark all read" })}
                </button>
              </div>
            </div>
            <div className="dashboard-panel dashboard-sidebar-panel">
              <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.savedPresets", { defaultValue: "Saved presets" })}</h5></div>
              <div className="dashboard-panel-body">
                {checklist.map((item) => (
                  <p key={item.id} className="dash-help">
                    <span className={item.done ? "dash-badge is-success" : "dash-badge is-warning"}>{item.done ? "Done" : "Todo"}</span>{" "}
                    <NavLink to={item.deepLink || "/dashboard/overview"}>{item.label}</NavLink>
                  </p>
                ))}
              </div>
            </div>
            <div className="dashboard-panel dashboard-sidebar-panel">
              <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.statusSemantics.title", { defaultValue: "Status semantics" })}</h5></div>
              <div className="dashboard-panel-body dashboard-status-legend">
                <p><span className="dash-badge is-warning"><FiClock className="status-legend-icon" />{t("dashboardCabinet.status.pending", { defaultValue: "Pending" })}</span>{t("dashboardCabinet.statusSemantics.pending", { defaultValue: "Queued or awaiting action." })}</p>
                <p><span className="dash-badge is-info"><FiLoader className="status-legend-icon is-spinning" />{t("dashboardCabinet.status.processing", { defaultValue: "Processing" })}</span>{t("dashboardCabinet.statusSemantics.processing", { defaultValue: "Under review or currently processing." })}</p>
                <p><span className="dash-badge is-success"><FiCheckCircle className="status-legend-icon" />{t("dashboardCabinet.status.completed", { defaultValue: "Completed" })}</span>{t("dashboardCabinet.statusSemantics.completed", { defaultValue: "Processed successfully." })}</p>
                <p><span className="dash-badge is-danger"><FiAlertCircle className="status-legend-icon" />{t("dashboardCabinet.status.failed", { defaultValue: "Failed" })}</span>{t("dashboardCabinet.statusSemantics.failed", { defaultValue: "Rejected, cancelled, or failed." })}</p>
              </div>
            </div>
          </aside>
          <div className="dashboard-content">
            <div className="dashboard-action-strip dashboard-action-strip-sticky">
              {contextualActions.map((action) => (
                <NavLink key={`${action.to}-${action.label}`} to={action.to} className="dashboard-action-pill">
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
