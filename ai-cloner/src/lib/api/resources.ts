/**
 * 后端资源函数（纯函数，组件只调这些，不直接拼 URL）。
 * 分组与后端路由模块一一对应，便于按 PRD §10 清单核对覆盖。
 */
import { api } from "./client";
import type {
  AssetDetailData,
  AssetItem,
  BalanceData,
  CatalogCapability,
  CatalogModel,
  CatalogTemplate,
  CheckinData,
  CheckinRecord,
  CheckinToday,
  CreditPack,
  ImportUrlData,
  LedgerEntry,
  MeData,
  ModelDetail,
  NotificationItem,
  Page,
  PlanView,
  PromptCard,
  PromptTab,
  QuoteData,
  RegisterData,
  SkuModel,
  SubscriptionData,
  TaskDetail,
  TaskListItem,
  UploadUrlData,
  VerifyData,
  VerifyResult,
} from "./types";

function qs(params: Record<string, string | number | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) s.set(k, String(v));
  }
  const str = s.toString();
  return str ? `?${str}` : "";
}

// ---------------------------------------------------------------- 认证

export const authApi = {
  register(input: {
    email?: string;
    phone?: string;
    locale?: string;
    honeypot?: string;
    formElapsedSec?: number;
    turnstileToken?: string;
  }): Promise<RegisterData> {
    return api<RegisterData>("/auth/register", { method: "POST", body: input });
  },
  /** 公开：注册风控配置（Turnstile Site Key；未配置返回 null） */
  signupConfig(): Promise<{ turnstileSiteKey: string | null; minFormElapsedSec: number }> {
    return api("/auth/signup-config");
  },
  verify(input: { verificationId: string; code: string }): Promise<VerifyResult> {
    return api<VerifyResult>("/auth/verify", { method: "POST", body: input });
  },
  /** 注册第三步：凭 verifiedToken 设密码 → 建号 + token 对 */
  setPassword(input: { verifiedToken: string; password: string }): Promise<VerifyData> {
    return api<VerifyData>("/auth/set-password", { method: "POST", body: input });
  },
  /** 找回第一步：申请验证码（用户不存在也成功返回，防枚举） */
  recoveryRequest(input: { email?: string; phone?: string; locale?: string }): Promise<RegisterData> {
    return api<RegisterData>("/auth/recovery/request", { method: "POST", body: input });
  },
  /** 找回第二步：验证码 → verifiedToken */
  recoveryConfirm(input: { verificationId: string; code: string }): Promise<{
    verifiedToken: string;
    expiresInSec: number;
  }> {
    return api("/auth/recovery/confirm", { method: "POST", body: input });
  },
  /** 找回第三步：凭 token 设新密码（踢掉全部登录态） */
  recoveryReset(input: { verifiedToken: string; newPassword: string }): Promise<{ reset: boolean }> {
    return api("/auth/recovery/reset", { method: "POST", body: input });
  },
  /** 公开：已启用的 OAuth 提供方（无配置时为空数组，前端隐藏对应按钮） */
  oauthProviders(): Promise<{ providers: Array<{ provider: string; clientId: string }> }> {
    return api("/auth/oauth-providers");
  },
  /** Google 登录：GIS 回调的 credential（idToken）直接透传，后端验签 */
  googleLogin(idToken: string, locale?: string): Promise<VerifyData> {
    return api<VerifyData>("/auth/oauth/google", { method: "POST", body: { idToken, locale } });
  },
  login(input: { email?: string; phone?: string; password: string }): Promise<VerifyData> {
    return api<VerifyData>("/auth/login", { method: "POST", body: input });
  },
  refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    return api("/auth/refresh", { method: "POST", body: { refreshToken } });
  },
  logout(refreshToken?: string): Promise<unknown> {
    return api("/auth/logout", { method: "POST", body: { refreshToken } });
  },
  me(): Promise<MeData> {
    return api<MeData>("/auth/me", { auth: true });
  },
  updateProfile(input: { displayName?: string; avatarAssetId?: string; timezone?: string }): Promise<{ user: unknown }> {
    return api("/users/me", { method: "PATCH", auth: true, body: input });
  },
};

// ---------------------------------------------------------------- 目录 / 模板

export const catalogApi = {
  capabilities(): Promise<CatalogCapability[]> {
    return api("/catalog/capabilities");
  },
  models(capability?: string): Promise<CatalogModel[]> {
    return api(`/catalog/models${capability ? qs({ capability }) : ""}`);
  },
  model(id: string): Promise<ModelDetail> {
    return api(`/catalog/models/${encodeURIComponent(id)}`);
  },
  templates(): Promise<CatalogTemplate[]> {
    return api("/catalog/templates");
  },
};

// ---------------------------------------------------------------- 定价 / 计费

export const billingApi = {
  plans(): Promise<{ plans: PlanView[] }> {
    return api("/plans");
  },
  creditPacks(): Promise<{ packs: CreditPack[] }> {
    return api("/billing/credit-packs");
  },
  balance(): Promise<BalanceData> {
    return api("/billing/balance", { auth: true });
  },
  ledger(cursor?: string, limit?: number): Promise<Page<LedgerEntry>> {
    return api(`/billing/ledger${qs({ cursor, limit })}`, { auth: true });
  },
  subscription(): Promise<SubscriptionData> {
    return api("/billing/subscription", { auth: true });
  },
  quote(input: {
    capability: string;
    modelId?: string;
    params: Record<string, string | number | boolean | string[]>;
  }): Promise<QuoteData> {
    return api<QuoteData>("/pricing/quote", { method: "POST", body: input });
  },
  skus(capability?: string): Promise<{ skus: SkuModel[] }> {
    return api(capability ? `/pricing/skus/${encodeURIComponent(capability)}` : "/pricing/skus");
  },
  promotions(): Promise<unknown[]> {
    return api("/pricing/promotions");
  },
};

// ---------------------------------------------------------------- 任务

export interface SubmitTaskInput {
  capability: string;
  modelId?: string;
  prompt: string;
  negativePrompt?: string;
  inputAssetIds?: string[];
  params?: Record<string, string | number | boolean | string[]>;
  idempotencyKey: string;
}

export const tasksApi = {
  submit(input: SubmitTaskInput): Promise<{
    task: {
      id: string;
      status: string;
      progress: number;
      capability: string;
      model: { id: string; displayName: string };
      quotedCredits: number;
      remainingCredits: number;
      createdAt: string;
      estimatedSec: number;
    };
  }> {
    return api("/tasks", {
      method: "POST",
      auth: true,
      body: {
        ...input,
        inputAssetIds: input.inputAssetIds ?? [],
        params: input.params ?? {},
      },
      headers: { "Idempotency-Key": input.idempotencyKey },
    });
  },
  list(opts: { capability?: string; status?: string; type?: string; cursor?: string; limit?: number } = {}): Promise<Page<TaskListItem>> {
    return api(`/tasks${qs(opts)}`, { auth: true });
  },
  get(id: string): Promise<TaskDetail> {
    return api(`/tasks/${encodeURIComponent(id)}`, { auth: true });
  },
  cancel(id: string): Promise<{ status: string; refundedCredits: number }> {
    return api(`/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST", auth: true });
  },
  retry(id: string, idempotencyKey: string): Promise<unknown> {
    return api(`/tasks/${encodeURIComponent(id)}/retry`, {
      method: "POST",
      auth: true,
      body: { idempotencyKey },
      headers: { "Idempotency-Key": idempotencyKey },
    });
  },
};

// ---------------------------------------------------------------- 资产

export const assetsApi = {
  uploadUrl(input: { mimeType: string; sizeBytes: number; kind: "upload" | "output"; filename?: string }): Promise<UploadUrlData> {
    return api("/assets/upload-url", { method: "POST", auth: true, body: input });
  },
  confirm(assetId: string): Promise<{ asset: AssetItem }> {
    return api("/assets", { method: "POST", auth: true, body: { assetId } });
  },
  importUrl(input: { url: string; kind: "upload" | "output" }): Promise<ImportUrlData> {
    return api("/assets/import-url", { method: "POST", auth: true, body: input });
  },
  list(opts: { kind?: string; cursor?: string; limit?: number } = {}): Promise<Page<AssetItem>> {
    return api(`/assets${qs(opts)}`, { auth: true });
  },
  /**
   * 作品库列表（个人中心「我的作品」用）。
   *
   * - `mediaType`：image / video / audio（服务端按 mime 前缀在 DB 层过滤，
   *   不是取一页再内存筛，避免翻页漏数据）
   * - `createdFrom` / `createdTo`：ISO 8601，下界含、上界不含
   */
  listWorks(
    opts: {
      mediaType?: "image" | "video" | "audio";
      createdFrom?: string;
      createdTo?: string;
      cursor?: string;
      limit?: number;
    } = {},
  ): Promise<Page<AssetItem>> {
    return api(`/assets${qs(opts)}`, { auth: true });
  },
  /** 批量软删除；逐条独立处理，部分失败（如被创作记录引用）不影响其余 */
  batchRemove(assetIds: string[]): Promise<{
    deleted: string[];
    skipped: Array<{ id: string; reason: string; message: string }>;
  }> {
    return api("/assets/batch-delete", { method: "POST", auth: true, body: { assetIds } });
  },
  get(id: string): Promise<AssetDetailData> {
    return api(`/assets/${encodeURIComponent(id)}`, { auth: true });
  },
  remove(id: string): Promise<unknown> {
    return api(`/assets/${encodeURIComponent(id)}`, { method: "DELETE", auth: true });
  },
  /**
   * 直传文件到对象存储（预签名 PUT，Content-Type 必须与签发时一致）。
   * @returns 确认后的资产
   */
  async uploadFile(file: File): Promise<{ asset: AssetItem }> {
    const kind = file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/")
      ? "upload"
      : "upload";
    const issued = await this.uploadUrl({
      mimeType: file.type,
      sizeBytes: file.size,
      kind,
      filename: file.name,
    });
    const put = await fetch(issued.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type, ...(issued.requiredHeaders ?? {}) },
      body: file,
    });
    if (!put.ok) throw new Error(`upload failed (${put.status})`);
    return this.confirm(issued.assetId);
  },
};

// ---------------------------------------------------------------- 签到 / 通知 / 提示词库

export const checkinApi = {
  checkin(): Promise<CheckinData> {
    return api("/checkin", { method: "POST", auth: true });
  },
  today(): Promise<CheckinToday> {
    return api("/checkin/today", { auth: true });
  },
  history(limit = 30): Promise<{ records: CheckinRecord[] }> {
    return api(`/checkin/history${qs({ limit })}`, { auth: true });
  },
};

export const notificationsApi = {
  list(cursor?: string, limit?: number): Promise<Page<NotificationItem>> {
    return api(`/notifications${qs({ cursor, limit })}`, { auth: true });
  },
  markRead(id: string): Promise<unknown> {
    return api(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST", auth: true });
  },
  markAllRead(): Promise<unknown> {
    return api("/notifications/read-all", { method: "POST", auth: true });
  },
  unreadCount(): Promise<{ count: number }> {
    return api("/notifications/unread-count", { auth: true });
  },
};

export const promptsApi = {
  library(cat?: string): Promise<{ tabs: PromptTab[]; cards: PromptCard[] }> {
    return api(`/prompt-library${cat ? qs({ cat }) : ""}`);
  },
  view(id: string): Promise<unknown> {
    return api(`/prompt-library/${encodeURIComponent(id)}/view`, { method: "POST" });
  },
  copy(id: string): Promise<{ copies: number; title: string }> {
    return api(`/prompt-library/${encodeURIComponent(id)}/copy`, { method: "POST" });
  },
  like(id: string): Promise<{ liked: boolean; likes: number }> {
    return api(`/prompt-library/${encodeURIComponent(id)}/like`, { method: "POST" });
  },
};
