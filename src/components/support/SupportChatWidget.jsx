import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../context/AuthContext";
import { apiPost } from "../../api/client";

export function SupportChatWidget() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [ticket, setTicket] = useState(null);
  const [draft, setDraft] = useState("");
  const [unread, setUnread] = useState(0);
  const [guestReady, setGuestReady] = useState(false);
  const [guestError, setGuestError] = useState("");
  const socketRef = useRef(null);
  const bottomRef = useRef(null);
  const openRef = useRef(open);

  const sortedMessages = useMemo(() => [...messages].sort((a, b) => a.id - b.id), [messages]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (user) {
      const timer = setTimeout(() => {
        setGuestReady(false);
        setGuestError("");
      }, 0);
      return () => clearTimeout(timer);
    }
    let mounted = true;
    const run = async () => {
      try {
        await apiPost("/api/user/support/guest-session", {});
        if (!mounted) return;
        setGuestReady(true);
        setGuestError("");
      } catch (err) {
        if (!mounted) return;
        setGuestReady(false);
        setGuestError(err.message || t("supportWidget.guestUnavailable"));
      }
    };
    const timer = setTimeout(run, 0);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [t, user]);

  useEffect(() => {
    if (!user && !guestReady) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      const timer = setTimeout(() => {
        setMessages([]);
        setTicket(null);
        setUnread(0);
      }, 0);
      return () => clearTimeout(timer);
    }
    const socket = io("/", { withCredentials: true, transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("support:user:init");
    });
    socket.on("support:user:state", (payload) => {
      setTicket(payload.ticket || null);
      setMessages(payload.messages || []);
    });
    socket.on("support:user:new_message", (message) => {
      setMessages((prev) => [...prev, message]);
      if (!openRef.current && message.senderType === "admin") {
        setUnread((v) => v + 1);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [guestReady, user]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setUnread(0), 0);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    return () => clearTimeout(timer);
  }, [open, sortedMessages.length]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!draft.trim() || !socketRef.current) return;
    socketRef.current.emit("support:user:message", { body: draft });
    setDraft("");
  };

  const openWidget = () => {
    setOpen((v) => !v);
  };
  useEffect(() => {
    const stored = window.localStorage.getItem("cm_support_active_ticket");
    if (!stored || !socketRef.current) return;
    socketRef.current.emit("support:user:watch_ticket", { ticketId: Number(stored) });
  }, [open]);

  return (
    <>
      <button className="support-fab" type="button" onClick={openWidget} aria-label={t("dashboardCabinet.support.chatTitle")}>
        <i className="fa fa-comment" aria-hidden="true" />
        {unread > 0 ? <span className="support-fab-badge">{unread}</span> : null}
      </button>

      {open ? (
        <div className="support-widget-card">
          <div className="support-widget-header">
            <strong>{t("dashboardCabinet.support.chatTitle")}</strong>
            <button type="button" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="support-widget-body">
            {ticket ? <p className="support-widget-meta">Ticket #{ticket.id}</p> : null}
            {!user && !guestError ? (
              <p className="support-widget-empty">{t("supportWidget.guestModeActive")}</p>
            ) : null}
            {!user && guestError ? (
              <p className="support-widget-empty">{guestError}</p>
            ) : sortedMessages.length === 0 ? (
              <p className="support-widget-empty">{t("supportWidget.firstMessageHint")}</p>
            ) : (
              sortedMessages.map((item) => (
                <div
                  className={`support-widget-message ${item.senderType === "admin" ? "is-admin" : "is-user"}`}
                  key={item.id}
                >
                  <span>{item.body}</span>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
          <form className="support-widget-form" onSubmit={sendMessage}>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("dashboardCabinet.support.typeMessage")}
              disabled={!user && (!guestReady || Boolean(guestError))}
            />
            <button type="submit" disabled={!user && (!guestReady || Boolean(guestError))}>{t("dashboardCabinet.actions.send")}</button>
          </form>
        </div>
      ) : null}
    </>
  );
}
