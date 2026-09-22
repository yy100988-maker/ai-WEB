"use client";

/**
 * 认证弹窗（四处复用：SiteHeader / HeroComposer / ToolComposer / AppHomePage）。
 *
 * 四条独立流程：
 *  - register：邮箱 → 验证码 → 两次设密码（≥6 位含字母数字）→ 自动登录
 *  - login   ：邮箱 + 密码
 *  - recovery：邮箱 → 验证码 → 两次新密码（成功后旧登录态全部失效）
 *  - google  ：GIS 按钮（后端公示 Client ID 才渲染；未配置则整块隐藏）
 *
 * 设计要点：
 *  - 必须 portal 到 body：调用方 header 带 backdrop-blur 会形成 fixed 包含块，
 *    直接渲染会导致弹窗相对父容器定位（被裁剪、遮罩盖不住全屏）。
 *  - 密码规则与后端 WEAK_PASSWORD 的 reason 一一对应，前端实时提示、后端兜底。
 *  - 所有错误按 ApiError.code 分支行内展示，不用 alert。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, Loader2, Mail, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { authApi } from "@/lib/api/resources";
import { useAuth } from "@/lib/api/auth-context";
import type { Locale } from "./site-data";
import { siteContent } from "./site-data";

export interface AuthDialogProps {
  locale: Locale;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** 初始流程（默认登录；Header 未登录点图标也走登录） */
  initialFlow?: Flow;
}

type Flow = "login" | "register" | "recovery";
type Step = "account" | "verify" | "password";

const PASSWORD_MIN = 6;

function isZh(locale: Locale): boolean {
  return locale === "zh-TW" || locale === "zh-CN";
}

/** 与后端 validatePasswordPolicy 同规则的前端校验（提前 feedback，不替代后端） */
export function passwordIssue(pw: string): "too_short" | "no_letter" | "no_digit" | null {
  if (pw.length < PASSWORD_MIN) return "too_short";
  if (!/[A-Za-z]/.test(pw)) return "no_letter";
  if (!/[0-9]/.test(pw)) return "no_digit";
  return null;
}

/** Google GIS 脚本按需加载（只加载一次） */
let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("no document"));
    if (document.getElementById("gsi-client")) return resolve();
    const s = document.createElement("script");
    s.id = "gsi-client";
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("gsi load failed"));
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** Turnstile 脚本按需加载（只加载一次；未配置 Site Key 时不会被调用） */
let turnstilePromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (turnstilePromise) return turnstilePromise;
  turnstilePromise = new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("no document"));
    if (document.getElementById("cf-turnstile-script")) return resolve();
    const s = document.createElement("script");
    s.id = "cf-turnstile-script";
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile load failed"));
    document.head.appendChild(s);
  });
  return turnstilePromise;
}

interface GsiCredentialResponse {
  credential?: string;
}
interface GsiApi {
  accounts: {
    id: {
      initialize(config: { client_id: string; callback: (r: GsiCredentialResponse) => void }): void;
      renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
    };
  };
}

export function AuthDialog({ locale, open, onClose, onSuccess, initialFlow = "login" }: AuthDialogProps) {
  const dict = siteContent[locale];
  const zh = isZh(locale);
  const {
    startRegister,
    verifyCode,
    setPassword: submitSetPassword,
    startRecovery,
    confirmRecovery,
    resetPassword,
    googleLogin,
    oauthProviders,
    login,
  } = useAuth();

  const [flow, setFlow] = useState<Flow>(initialFlow);
  const [step, setStep] = useState<Step>("account");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  // ---------------- 反刷号三件套：蜜罐 / 耗时 / Turnstile ----------------
  // 蜜罐：视觉隐藏但**不是** display:none（部分机器人会跳过 display:none 字段），
  // 配 tabIndex=-1 与 aria-hidden 保证键盘与读屏用户不会撞上它。
  const [honeypot, setHoneypot] = useState("");
  // 表单出现时刻 → 提交时算"人类耗时"，机器人通常 <1s
  const openedAtRef = useRef(0);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);

  // portal 挂载标记（rAF 回调内置位，避开 set-state-in-effect 规则）
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => {
      cancelAnimationFrame(id);
      setMounted(false);
    };
  }, []);

  // 打开时重置为初始流程
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      setFlow(initialFlow);
      setStep("account");
      setError(null);
      setNotice(null);
      setCode("");
      setPassword("");
      setPassword2("");
      setVerifiedToken(null);
      // 反刷号：每次打开重置蜜罐与计时起点（机器人不会重开弹窗，人类会）
      setHoneypot("");
      setTurnstileToken(null);
      openedAtRef.current = Date.now();
    });
    return () => cancelAnimationFrame(id);
  }, [open, initialFlow]);

  // 查询已启用的 OAuth 提供方（未配置则 Google 区块不渲染）
  useEffect(() => {
    if (!open || !mounted) return;
    let alive = true;
    void oauthProviders()
      .then((r) => {
        if (!alive) return;
        const g = r.providers.find((p) => p.provider === "google");
        setGoogleClientId(g?.clientId ?? null);
      })
      .catch(() => {
        if (alive) setGoogleClientId(null);
      });
    return () => {
      alive = false;
    };
  }, [open, mounted, oauthProviders]);

  const handleGoogleCredential = useCallback(
    async (idToken: string) => {
      setBusy(true);
      setError(null);
      try {
        await googleLogin(idToken, locale);
        onSuccess();
      } catch (e) {
        setError(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [googleLogin, locale, onSuccess],
  );

  // 拉取注册风控配置（Turnstile Site Key）；未配置则只靠服务端其他三层
  useEffect(() => {
    if (!open || !mounted) return;
    let alive = true;
    void authApi
      .signupConfig()
      .then((c) => {
        if (alive) setTurnstileSiteKey(c.turnstileSiteKey);
      })
      .catch(() => {
        if (alive) setTurnstileSiteKey(null);
      });
    return () => {
      alive = false;
    };
  }, [open, mounted]);

  // 渲染 Turnstile（显式模式：显式 execute 拿 token）
  useEffect(() => {
    if (!open || !mounted || !turnstileSiteKey || !turnstileRef.current) return;
    let cancelled = false;
    const w = window as unknown as {
      turnstile?: {
        render: (
          el: HTMLElement,
          opts: Record<string, unknown>,
        ) => string;
      };
    };
    void loadTurnstile()
      .then(() => {
        if (cancelled || !turnstileRef.current || !w.turnstile) return;
        turnstileRef.current.innerHTML = "";
        w.turnstile.render(turnstileRef.current, {
          sitekey: turnstileSiteKey,
          theme: "light",
          size: "flexible",
          callback: (token: string) => setTurnstileToken(token),
          "expired-callback": () => setTurnstileToken(null),
          "error-callback": () => setTurnstileToken(null),
        });
      })
      .catch(() => {
        if (!cancelled) setTurnstileSiteKey(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mounted, turnstileSiteKey]);

  // 渲染 Google 按钮（拿到 Client ID 后）
  useEffect(() => {
    if (!open || !mounted || !googleClientId || !googleBtnRef.current) return;
    let cancelled = false;
    void loadGis()
      .then(() => {
        if (cancelled || !googleBtnRef.current) return;
        const gsi = (window as unknown as { google?: GsiApi }).google;
        if (!gsi) return;
        gsi.accounts.id.initialize({
          client_id: googleClientId,
          callback: (r) => {
            if (r.credential) void handleGoogleCredential(r.credential);
          },
        });
        googleBtnRef.current.innerHTML = "";
        gsi.accounts.id.renderButton(googleBtnRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          width: 320,
        });
      })
      .catch(() => {
        if (!cancelled) setGoogleClientId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mounted, googleClientId, handleGoogleCredential]);

  // 账号含 @ 视为邮箱（当前只支持邮箱）
  function splitAccount(value: string): { email?: string; phone?: string } {
    const v = value.trim();
    if (v.includes("@")) return { email: v };
    return { phone: v };
  }

  function errorText(e: unknown): string {
    if (e instanceof ApiError) {
      if (e.code === "RATE_LIMITED" || e.code === "TOO_MANY_REQUESTS") {
        return zh ? "请求太频繁，请稍后再试" : "Too many requests, please try again later";
      }
      if (e.code === "WEAK_PASSWORD") {
        const reason = String((e.details as { reason?: string } | undefined)?.reason ?? "");
        if (reason === "too_short") {
          return zh ? `密码至少 ${PASSWORD_MIN} 位` : `Password must be at least ${PASSWORD_MIN} characters`;
        }
        if (reason === "no_letter") return zh ? "密码必须包含字母" : "Password must contain a letter";
        if (reason === "no_digit") return zh ? "密码必须包含数字" : "Password must contain a number";
        return e.message;
      }
      if (e.code === "EMAIL_NOT_CONFIGURED") {
        return zh ? "邮件服务暂未配置，请联系运营" : "Email service not configured, contact operations";
      }
      if (e.code === "SMS_NOT_CONFIGURED") {
        return zh ? "短信通道未开通，请使用邮箱" : "SMS unavailable, please use email";
      }
      // 反刷号拦截：统一话术，**不透露具体规则**（避免攻击者逐条试探），
      // 同时给正常用户一条可操作的出路（换网络/稍后再试/联系支持）。
      if (
        e.code === "FORBIDDEN" &&
        (e.details as { reason?: string } | undefined)?.reason === "signup_blocked"
      ) {
        return zh
          ? "注册暂时受限，请更换网络后重试，或稍后再试"
          : "Sign-up is temporarily restricted. Try again later or from another network.";
      }
      if (e.code === "UNAUTHORIZED" || e.status === 401) {
        return zh ? "账号或密码不正确" : "Invalid account or password";
      }
      // 验证码类错误的细节（后端 details.reason）
      const reason = String((e.details as { reason?: string } | undefined)?.reason ?? "");
      if (reason === "code_mismatch") {
        const left = (e.details as { attemptsLeft?: number } | undefined)?.attemptsLeft;
        return zh
          ? `验证码不正确${typeof left === "number" ? `，还可尝试 ${left} 次` : ""}`
          : `Incorrect code${typeof left === "number" ? `, ${left} attempts left` : ""}`;
      }
      if (reason === "verification_expired") {
        return zh ? "验证码已过期，请重新获取" : "Code expired, please request a new one";
      }
      if (reason === "verified_token_invalid") {
        return zh ? "验证已失效，请重新获取验证码" : "Verification expired, request a new code";
      }
      if (reason === "account_not_found") {
        return zh ? "该邮箱尚未注册" : "This email is not registered";
      }
      if (e.message) return e.message;
    }
    if (e instanceof Error && e.message) return e.message;
    return zh ? "操作失败，请稍后再试" : "Operation failed, please try again";
  }

  // ---------------- 步骤动作 ----------------

  async function sendCode(kind: "register" | "recovery"): Promise<void> {
    const v = account.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // 反刷号信号：蜜罐值 + 人类耗时 + Turnstile token（后两者无则不带）
      const formElapsedSec = openedAtRef.current
        ? Math.max(0, Math.round((Date.now() - openedAtRef.current) / 1000))
        : undefined;
      const antiAbuse = {
        honeypot,
        ...(formElapsedSec !== undefined ? { formElapsedSec } : {}),
        ...(turnstileToken ? { turnstileToken } : {}),
      };
      const id = kind === "register"
        ? await startRegister({ ...splitAccount(v), locale, ...antiAbuse })
        : await startRecovery({ ...splitAccount(v), locale, ...antiAbuse });
      setVerificationId(id);
      setStep("verify");
      setNotice(zh ? "验证码已发送，请查收邮件（5 分钟内有效）" : "Code sent — check your inbox (valid 5 min)");
    } catch (e) {
      setError(errorText(e));
      // Turnstile token 一次性：失败后清掉，让用户重新过验证
      setTurnstileToken(null);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(): Promise<void> {
    if (!verificationId || !code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (flow === "register") {
        const r = await verifyCode(verificationId, code.trim());
        if ("exists" in r && r.exists) {
          // 已注册邮箱：引导去登录/找回，不再静默登录
          setError(
            zh ? "该邮箱已注册，请直接登录或使用找回密码" : "Email already registered — sign in or reset your password",
          );
          return;
        }
        if (!("verifiedToken" in r)) return;
        setVerifiedToken(r.verifiedToken);
        setStep("password");
        setNotice(zh ? "邮箱已验证，请设置密码" : "Email verified — set your password");
      } else {
        const token = await confirmRecovery(verificationId, code.trim());
        setVerifiedToken(token);
        setStep("password");
        setNotice(zh ? "邮箱已验证，请设置新密码" : "Email verified — set a new password");
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(): Promise<void> {
    if (busy) return;
    if (password !== password2) {
      setError(zh ? "两次输入的密码不一致" : "Passwords do not match");
      return;
    }
    const issue = passwordIssue(password);
    if (issue) {
      setError(errorText(new ApiError("WEAK_PASSWORD", "weak", 422, { reason: issue })));
      return;
    }
    if (!verifiedToken) {
      setError(zh ? "验证已失效，请重新获取验证码" : "Verification expired, request a new code");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (flow === "register") {
        await submitSetPassword(verifiedToken, password);
        onSuccess();
      } else {
        await resetPassword(verifiedToken, password);
        setNotice(zh ? "密码已重置，请使用新密码登录" : "Password reset — sign in with your new password");
        setFlow("login");
        setStep("account");
        setPassword("");
        setPassword2("");
        setVerifiedToken(null);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitLogin(): Promise<void> {
    const v = account.trim();
    if (!v || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login({ ...splitAccount(v), password });
      onSuccess();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open || !mounted) return null;

  // ---------------- 文案 ----------------
  const t = {
    loginTitle: dict.login,
    registerTitle: zh ? "注册" : "Sign up",
    recoveryTitle: zh ? "找回密码" : "Reset password",
    accountPh: zh ? "邮箱" : "Email",
    passwordPh: zh ? "密码" : "Password",
    password2Ph: zh ? "再次输入密码" : "Confirm password",
    passwordHint: zh ? `至少 ${PASSWORD_MIN} 位，需含字母和数字` : `At least ${PASSWORD_MIN} chars with letters and numbers`,
    codePh: zh ? "6 位验证码" : "6-digit code",
    sendCode: zh ? "发送验证码" : "Send code",
    verify: zh ? "验证" : "Verify",
    setPassword: zh ? "设置密码并登录" : "Set password & sign in",
    resetPassword: zh ? "重置密码" : "Reset password",
    loginBtn: zh ? "登录" : "Sign in",
    toRegister: zh ? "没有账号？去注册" : "No account? Sign up",
    toLogin: zh ? "已有账号？去登录" : "Have an account? Sign in",
    toRecovery: zh ? "忘记密码？" : "Forgot password?",
    back: zh ? "返回修改邮箱" : "Edit email",
    or: zh ? "或" : "or",
  };

  const title = flow === "register" ? t.registerTitle : flow === "recovery" ? t.recoveryTitle : t.loginTitle;

  const inputCls =
    "w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm text-black outline-none focus:border-[#1f11ed] disabled:opacity-60";
  const primaryBtn =
    "inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#1f11ed] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
  const linkBtn = "w-full text-center text-xs text-black/50 hover:text-black disabled:opacity-50";

  // portal 到 body：见文件头说明（fixed 包含块问题）
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-black">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full text-black/60 hover:bg-black/5"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* ---------------- 登录 ---------------- */}
        {flow === "login" && (
          <div className="space-y-3">
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={t.accountPh}
              autoComplete="email"
              className={inputCls}
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.passwordPh}
              type="password"
              autoComplete="current-password"
              className={inputCls}
            />
            <button
              type="button"
              disabled={busy || !account.trim() || !password}
              onClick={() => void submitLogin()}
              className={primaryBtn}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              <KeyRound className="size-4" />
              {t.loginBtn}
            </button>
            <button type="button" disabled={busy} onClick={() => { setFlow("recovery"); setStep("account"); setError(null); setNotice(null); }} className={linkBtn}>
              {t.toRecovery}
            </button>
            <button type="button" disabled={busy} onClick={() => { setFlow("register"); setStep("account"); setError(null); setNotice(null); }} className="w-full text-center text-xs font-semibold text-[#1f11ed] hover:underline">
              {t.toRegister}
            </button>
          </div>
        )}

        {/* ---------------- 注册 / 找回：第一步 邮箱 ---------------- */}
        {(flow === "register" || flow === "recovery") && step === "account" && (
          <div className="space-y-3">
            {/* 蜜罐：正常用户看不见（离屏 + aria-hidden + tabIndex -1），
                但自动化脚本常无脑填充。命中只作为风控信号上报，不阻断用户。 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-[9999px] top-auto h-px w-px overflow-hidden"
            >
              <label htmlFor="vutu-company-website">Company website</label>
              <input
                id="vutu-company-website"
                name="company_website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </div>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={t.accountPh}
              autoComplete="email"
              className={inputCls}
            />
            {turnstileSiteKey && <div ref={turnstileRef} className="flex justify-center" />}
            <button
              type="button"
              disabled={busy || !account.trim()}
              onClick={() => void sendCode(flow === "register" ? "register" : "recovery")}
              className={primaryBtn}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              {t.sendCode}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setFlow("login"); setError(null); setNotice(null); }}
              className={linkBtn}
            >
              {t.toLogin}
            </button>
          </div>
        )}

        {/* ---------------- 注册 / 找回：第二步 验证码 ---------------- */}
        {(flow === "register" || flow === "recovery") && step === "verify" && (
          <div className="space-y-3">
            <p className="text-xs text-black/50">
              {account.trim()} · {zh ? "验证码" : "code"}
            </p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t.codePh}
              inputMode="numeric"
              maxLength={8}
              className={inputCls}
            />
            <button
              type="button"
              disabled={busy || !code.trim()}
              onClick={() => void submitCode()}
              className={primaryBtn}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t.verify}
            </button>
            <button type="button" disabled={busy} onClick={() => { setStep("account"); setCode(""); setError(null); setNotice(null); }} className={linkBtn}>
              {t.back}
            </button>
          </div>
        )}

        {/* ---------------- 注册 / 找回：第三步 两次设密码 ---------------- */}
        {(flow === "register" || flow === "recovery") && step === "password" && (
          <div className="space-y-3">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.passwordPh}
              type="password"
              autoComplete="new-password"
              className={inputCls}
            />
            <input
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              placeholder={t.password2Ph}
              type="password"
              autoComplete="new-password"
              className={inputCls}
            />
            <p className="text-[11px] text-black/45">{t.passwordHint}</p>
            <button
              type="button"
              disabled={busy || !password || !password2}
              onClick={() => void submitPassword()}
              className={primaryBtn}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              <KeyRound className="size-4" />
              {flow === "register" ? t.setPassword : t.resetPassword}
            </button>
          </div>
        )}

        {notice && !error && <p className="mt-3 text-xs leading-relaxed text-black/55">{notice}</p>}
        {error && <p className="mt-3 text-xs leading-relaxed text-red-600">{error}</p>}

        {/* ---------------- Google ---------------- */}
        {googleClientId && (
          <div className="mt-4">
            <div className="mb-3 flex items-center gap-3">
              <span className="h-px flex-1 bg-black/10" />
              <span className="text-[11px] text-black/40">{t.or}</span>
              <span className="h-px flex-1 bg-black/10" />
            </div>
            <div ref={googleBtnRef} className="flex justify-center" />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
