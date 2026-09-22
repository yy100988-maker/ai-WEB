/**
 * 认证上下文：token 持有 + 当前用户/余额 + 登录注册签到方法。
 *
 * 用法：在 app 的 layout（或 AppHomePage 外层）包 `<AuthProvider>`，
 * 组件内 `const { user, credits, loading, loginWithCode, ... } = useAuth()`。
 * 未登录时 user 为 null，各组件自行降级展示（保持 UI 1:1）。
 */
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, tokenStore } from "./client";
import { authApi, billingApi, checkinApi } from "./resources";
import type { AuthUser, PlanView, VerifyResult } from "./types";

interface AuthState {
  loading: boolean;
  user: AuthUser | null;
  plan: PlanView | null;
  credits: number | null;
  expiringSoon: number;
  checkedInToday: boolean;
  error: string | null;
  refresh(): Promise<void>;
  startRegister(input: {
    email?: string;
    phone?: string;
    locale?: string;
    honeypot?: string;
    formElapsedSec?: number;
    turnstileToken?: string;
  }): Promise<string>;
  /** 注册验码：已存在 → { exists: true }；不存在 → { verifiedToken }（拿去设密码） */
  verifyCode(verificationId: string, code: string): Promise<VerifyResult>;
  /** 注册设密码（建号 + 登录） */
  setPassword(verifiedToken: string, password: string): Promise<void>;
  /** 找回：申请 → 确认 → 重置（三步） */
  startRecovery(input: {
    email?: string;
    phone?: string;
    locale?: string;
    honeypot?: string;
    formElapsedSec?: number;
    turnstileToken?: string;
  }): Promise<string>;
  confirmRecovery(verificationId: string, code: string): Promise<string>;
  resetPassword(verifiedToken: string, newPassword: string): Promise<void>;
  /** Google 登录（GIS credential 直传，后端验签） */
  googleLogin(idToken: string, locale?: string): Promise<void>;
  /** 已启用的 OAuth 提供方（含 Google Client ID；空数组则隐藏按钮） */
  oauthProviders(): Promise<{ providers: Array<{ provider: string; clientId: string }> }>;
  login(input: { email?: string; phone?: string; password: string }): Promise<void>;
  logout(): Promise<void>;
  checkin(): Promise<number>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [expiringSoon, setExpiringSoon] = useState(0);
  const [checkedInToday, setCheckedInToday] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tokenStore.getAccess()) {
      setLoading(false);
      return;
    }
    try {
      const me = await authApi.me();
      setUser(me.user);
      setPlan(me.user.plan);
      setCredits(me.balance.credits);
      setExpiringSoon(me.balance.expiringSoon);
      setError(null);
      try {
        const t = await checkinApi.today();
        setCheckedInToday(t.checked_in);
      } catch {
        /* 签到状态拿不到不影响主流程 */
      }
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.code === "UNAUTHORIZED")) {
        tokenStore.clear();
        setUser(null);
        setPlan(null);
        setCredits(null);
      } else {
        setError(e instanceof Error ? e.message : "加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startRegister = useCallback(
    async (input: {
      email?: string;
      phone?: string;
      locale?: string;
      honeypot?: string;
      formElapsedSec?: number;
      turnstileToken?: string;
    }) => {
      const r = await authApi.register(input);
      return r.verificationId;
    },
    [],
  );

  const verifyCode = useCallback(
    async (verificationId: string, code: string): Promise<VerifyResult> => {
      return authApi.verify({ verificationId, code });
    },
    [],
  );

  const setPassword = useCallback(
    async (verifiedToken: string, password: string) => {
      const data = await authApi.setPassword({ verifiedToken, password });
      tokenStore.set(data.accessToken, data.refreshToken);
      await refresh();
    },
    [refresh],
  );

  const startRecovery = useCallback(
    async (input: {
      email?: string;
      phone?: string;
      locale?: string;
      honeypot?: string;
      formElapsedSec?: number;
      turnstileToken?: string;
    }) => {
      const r = await authApi.recoveryRequest(input);
      return r.verificationId;
    },
    [],
  );

  const confirmRecovery = useCallback(async (verificationId: string, code: string) => {
    const r = await authApi.recoveryConfirm({ verificationId, code });
    return r.verifiedToken;
  }, []);

  const resetPassword = useCallback(async (verifiedToken: string, newPassword: string) => {
    await authApi.recoveryReset({ verifiedToken, newPassword });
  }, []);

  const googleLogin = useCallback(
    async (idToken: string, locale?: string) => {
      const data = await authApi.googleLogin(idToken, locale);
      tokenStore.set(data.accessToken, data.refreshToken);
      await refresh();
    },
    [refresh],
  );

  const oauthProviders = useCallback(async () => {
    return authApi.oauthProviders();
  }, []);

  const login = useCallback(
    async (input: { email?: string; phone?: string; password: string }) => {
      const data = await authApi.login(input);
      tokenStore.set(data.accessToken, data.refreshToken);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      const rt = tokenStore.getRefresh();
      await authApi.logout(rt ?? undefined);
    } catch {
      /* 登出失败也清本地 */
    }
    tokenStore.clear();
    setUser(null);
    setPlan(null);
    setCredits(null);
  }, []);

  const checkin = useCallback(async () => {
    const r = await checkinApi.checkin();
    setCredits(r.balance);
    setCheckedInToday(true);
    return r.credits;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      user,
      plan,
      credits,
      expiringSoon,
      checkedInToday,
      error,
      refresh,
      startRegister,
      verifyCode,
      setPassword,
      startRecovery,
      confirmRecovery,
      resetPassword,
      googleLogin,
      oauthProviders,
      login,
      logout,
      checkin,
    }),
    [loading, user, plan, credits, expiringSoon, checkedInToday, error, refresh, startRegister, verifyCode, setPassword, startRecovery, confirmRecovery, resetPassword, googleLogin, oauthProviders, login, logout, checkin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 <AuthProvider> 内使用");
  return ctx;
}

/** 余额刷新（任务提交/完成后调用，保持侧栏宝石数准确） */
export async function refreshBalance(): Promise<number | null> {
  try {
    const b = await billingApi.balance();
    return b.credits;
  } catch {
    return null;
  }
}
