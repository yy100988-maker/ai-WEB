/**
 * 登录 / 注册弹窗
 * ------------------------------------------------------------------
 * 登录：邮箱 + 密码 → token 对。
 * 注册：三步（邮箱发码 → 6 位验证码 → 设密码建号），对齐后端
 * `POST /v1/auth/register|verify|set-password`。
 */
import { useState } from 'react';
import { ApiError, api, saveSession } from '../lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 登录/注册成功：调用方据此刷新 me/余额 */
  onAuthed: () => void;
  onNotify: (kind: 'ok' | 'err', text: string) => void;
}

type Mode = 'login' | 'register';
type RegStep = 1 | 2 | 3;

export function AuthDialog({ open, onClose, onAuthed, onNotify }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [step, setStep] = useState<RegStep>(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [verificationId, setVerificationId] = useState('');
  const [verifiedToken, setVerifiedToken] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const errText = (e: unknown, fallback: string) =>
    e instanceof ApiError ? e.message : fallback;

  const finishWithTokens = (tokens: { accessToken: string; refreshToken: string }) => {
    saveSession(tokens);
    onAuthed();
    onClose();
    onNotify('ok', '登录成功');
  };

  const doLogin = async () => {
    if (!email.trim() || !password) {
      onNotify('err', '请输入邮箱与密码');
      return;
    }
    setBusy(true);
    try {
      const data = await api.login({ email: email.trim(), password });
      finishWithTokens(data);
    } catch (e) {
      onNotify('err', errText(e, '登录失败'));
    } finally {
      setBusy(false);
    }
  };

  const regSendCode = async () => {
    if (!email.trim()) {
      onNotify('err', '请输入邮箱');
      return;
    }
    setBusy(true);
    try {
      const data = await api.register({ email: email.trim() });
      setVerificationId(data.verificationId);
      setStep(2);
      onNotify('ok', '验证码已发送，请查收邮箱');
    } catch (e) {
      onNotify('err', errText(e, '发送验证码失败'));
    } finally {
      setBusy(false);
    }
  };

  const regVerify = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      onNotify('err', '请输入 6 位数字验证码');
      return;
    }
    setBusy(true);
    try {
      const data = await api.verify({ verificationId, code: code.trim() });
      if (data.exists) {
        onNotify('err', '该邮箱已注册，请直接登录');
        setMode('login');
        setStep(1);
        return;
      }
      setVerifiedToken(data.verifiedToken ?? '');
      setStep(3);
    } catch (e) {
      onNotify('err', errText(e, '验证码错误'));
    } finally {
      setBusy(false);
    }
  };

  const regSetPassword = async () => {
    if (password.length < 6) {
      onNotify('err', '密码至少 6 位');
      return;
    }
    setBusy(true);
    try {
      const data = await api.setPassword({ verifiedToken, password });
      finishWithTokens(data);
    } catch (e) {
      onNotify('err', errText(e, '设置密码失败'));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setStep(1);
    setCode('');
    setPassword('');
  };

  return (
    <div className="auth-mask" onClick={onClose}>
      <div
        className="auth-card"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'login' ? '登录' : '注册'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === 'login' ? 'auth-tab--active' : ''}`}
            onClick={() => switchMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === 'register' ? 'auth-tab--active' : ''}`}
            onClick={() => switchMode('register')}
          >
            注册
          </button>
          <button type="button" className="auth-close" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>

        {mode === 'login' ? (
          <div className="auth-body">
            <label className="auth-field">
              <span>邮箱</span>
              <input
                type="email"
                value={email}
                placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>密码</span>
              <input
                type="password"
                value={password}
                placeholder="登录密码"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doLogin();
                }}
              />
            </label>
            <button type="button" className="cta" disabled={busy} onClick={() => void doLogin()}>
              {busy ? '登录中…' : '登录'}
            </button>
          </div>
        ) : (
          <div className="auth-body">
            <p className="auth-steps">第 {step} / 3 步</p>
            {step === 1 && (
              <>
                <label className="auth-field">
                  <span>邮箱</span>
                  <input
                    type="email"
                    value={email}
                    placeholder="you@example.com"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="cta"
                  disabled={busy}
                  onClick={() => void regSendCode()}
                >
                  {busy ? '发送中…' : '发送验证码'}
                </button>
              </>
            )}
            {step === 2 && (
              <>
                <label className="auth-field">
                  <span>6 位验证码</span>
                  <input
                    inputMode="numeric"
                    value={code}
                    placeholder="123456"
                    maxLength={6}
                    onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void regVerify();
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="cta"
                  disabled={busy}
                  onClick={() => void regVerify()}
                >
                  {busy ? '校验中…' : '下一步'}
                </button>
              </>
            )}
            {step === 3 && (
              <>
                <label className="auth-field">
                  <span>设置密码（≥6 位）</span>
                  <input
                    type="password"
                    value={password}
                    placeholder="设置登录密码"
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void regSetPassword();
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="cta"
                  disabled={busy}
                  onClick={() => void regSetPassword()}
                >
                  {busy ? '创建中…' : '完成注册并登录'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
