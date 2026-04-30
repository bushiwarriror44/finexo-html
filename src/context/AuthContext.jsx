/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet("/api/auth/me");
      setUser(data.user || null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      refresh();
    }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const login = async (email, password, rememberMe = false, captchaId = "", captchaAnswer = "") => {
    const data = await apiPost("/api/auth/login", { email, password, rememberMe, captchaId, captchaAnswer });
    setUser(data.user || null);
    return data;
  };

  const register = async ({
    email,
    password,
    referralCode = "",
    firstName = "",
    lastName = "",
    countryCode = "",
    captchaId = "",
    captchaAnswer = "",
  }) => {
    return apiPost("/api/auth/register", {
      email,
      password,
      referralCode,
      firstName,
      lastName,
      countryCode,
      captchaId,
      captchaAnswer,
    });
  };

  const logout = async () => {
    await apiPost("/api/auth/logout", {});
    setUser(null);
  };

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, refresh]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
