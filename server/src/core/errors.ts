/**
 * 统一错误码与异常类型（PRD §8.9 错误码表 / 详细设计 §2.1 通用约定）。
 *
 * 所有业务异常一律 throw AppError；HTTP 层统一序列化为
 *   { ok:false, error:{ code, message, details? }, requestId }
 */

import type { Locale } from './types.js';

/** HTTP 状态码 ↔ 业务错误码（PRD §8.9，按 HTTP 排序） */
export const ERROR_STATUS: Record<string, number> = {
  INVALID_PARAMS: 400,
  UNAUTHORIZED: 401,
  INSUFFICIENT_CREDITS: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  MODEL_UNAVAILABLE: 409,
  DUPLICATE_REQUEST: 409,
  ALREADY_CHECKED_IN: 409,
  TASK_FINAL: 409,
  ACCOUNT_DELETION_PENDING: 409,
  ASSET_IN_USE: 409,
  PAYLOAD_TOO_LARGE: 413,
  CONTENT_REJECTED: 422,
  PASSWORD_REQUIRED: 422,
  WEAK_PASSWORD: 422,
  UNFETCHABLE_URL: 422,
  RATE_LIMITED: 429,
  TOO_MANY_TASKS: 429,
  INTERNAL_ERROR: 500,
  NO_HEALTHY_PROVIDER: 503,
  EMAIL_NOT_CONFIGURED: 503,
  SMS_NOT_CONFIGURED: 503,
  SERVICE_UNAVAILABLE: 503,
};

export type ErrorCode = keyof typeof ERROR_STATUS;

/** 错误消息 11 语种表（PRD §9 i18n）。缺失回落 en。 */
type MsgTable = Partial<Record<Locale, string>> & { en: string };

const MESSAGES: Record<string, MsgTable> = {
  INVALID_PARAMS: {
    en: 'Invalid parameters',
    'zh-CN': '参数不合法',
    'zh-TW': '參數不合法',
    ja: 'パラメータが不正です',
    ko: '매개변수가 올바르지 않습니다',
    es: 'Parámetros no válidos',
    fr: 'Paramètres invalides',
    de: 'Ungültige Parameter',
    it: 'Parametri non validi',
    pt: 'Parâmetros inválidos',
    ru: 'Недопустимые параметры',
  },
  UNAUTHORIZED: {
    en: 'Authentication required',
    'zh-CN': '请先登录',
    'zh-TW': '請先登入',
    ja: 'ログインが必要です',
    ko: '로그인이 필요합니다',
    es: 'Se requiere autenticación',
    fr: 'Authentification requise',
    de: 'Authentifizierung erforderlich',
    it: 'Autenticazione richiesta',
    pt: 'Autenticação necessária',
    ru: 'Требуется авторизация',
  },
  INSUFFICIENT_CREDITS: {
    en: 'Insufficient credits',
    'zh-CN': '积分不足',
    'zh-TW': '積分不足',
    ja: 'クレジットが不足しています',
    ko: '크레딧이 부족합니다',
    es: 'Créditos insuficientes',
    fr: 'Crédits insuffisants',
    de: 'Unzureichende Credits',
    it: 'Crediti insufficienti',
    pt: 'Créditos insuficientes',
    ru: 'Недостаточно кредитов',
  },
  FORBIDDEN: {
    en: 'Not permitted for your plan',
    'zh-CN': '当前方案不支持该能力',
    'zh-TW': '目前方案不支援該能力',
    ja: '現在のプランでは利用できません',
    ko: '현재 요금제에서 지원되지 않습니다',
    es: 'No permitido en su plan',
    fr: 'Non autorisé pour votre offre',
    de: 'Für Ihren Tarif nicht verfügbar',
    it: 'Non consentito dal tuo piano',
    pt: 'Não permitido no seu plano',
    ru: 'Недоступно для вашего тарифа',
  },
  NOT_FOUND: {
    en: 'Not found',
    'zh-CN': '资源不存在',
    'zh-TW': '資源不存在',
    ja: '見つかりません',
    ko: '찾을 수 없습니다',
    es: 'No encontrado',
    fr: 'Introuvable',
    de: 'Nicht gefunden',
    it: 'Non trovato',
    pt: 'Não encontrado',
    ru: 'Не найдено',
  },
  MODEL_UNAVAILABLE: {
    en: 'Model unavailable',
    'zh-CN': '该模型暂不可用',
    'zh-TW': '該模型暫不可用',
    ja: 'モデルは利用できません',
    ko: '모델을 사용할 수 없습니다',
    es: 'Modelo no disponible',
    fr: 'Modèle indisponible',
    de: 'Modell nicht verfügbar',
    it: 'Modello non disponibile',
    pt: 'Modelo indisponível',
    ru: 'Модель недоступна',
  },
  DUPLICATE_REQUEST: {
    en: 'Duplicate request',
    'zh-CN': '重复请求',
    'zh-TW': '重複請求',
    ja: '重複したリクエストです',
    ko: '중복 요청입니다',
    es: 'Solicitud duplicada',
    fr: 'Requête en double',
    de: 'Doppelte Anfrage',
    it: 'Richiesta duplicata',
    pt: 'Pedido duplicado',
    ru: 'Дублирующийся запрос',
  },
  ALREADY_CHECKED_IN: {
    en: 'Already checked in today',
    'zh-CN': '今日已签到',
    'zh-TW': '今日已簽到',
    ja: '本日はすでにチェックイン済みです',
    ko: '오늘 이미 출석했습니다',
    es: 'Ya registrado hoy',
    fr: 'Déjà pointé aujourd’hui',
    de: 'Heute bereits eingecheckt',
    it: 'Già effettuato oggi',
    pt: 'Já registado hoje',
    ru: 'Сегодня уже отмечено',
  },
  TASK_FINAL: {
    en: 'Task already finished',
    'zh-CN': '任务已结束，无法取消',
    'zh-TW': '任務已結束，無法取消',
    ja: 'タスクは既に終了しています',
    ko: '작업이 이미 종료되었습니다',
    es: 'La tarea ya finalizó',
    fr: 'Tâche déjà terminée',
    de: 'Aufgabe bereits beendet',
    it: 'Attività già conclusa',
    pt: 'Tarefa já concluída',
    ru: 'Задача уже завершена',
  },
  ACCOUNT_DELETION_PENDING: {
    en: 'Account deletion in progress',
    'zh-CN': '账号注销处理中',
    'zh-TW': '帳號註銷處理中',
    ja: 'アカウント削除を処理中です',
    ko: '계정 삭제 처리 중입니다',
    es: 'Eliminación de cuenta en curso',
    fr: 'Suppression du compte en cours',
    de: 'Kontolöschung läuft',
    it: 'Eliminazione account in corso',
    pt: 'Eliminação de conta em curso',
    ru: 'Удаление аккаунта выполняется',
  },
  ASSET_IN_USE: {
    en: 'Asset is used by a task',
    'zh-CN': '资产已被任务引用，无法删除',
    'zh-TW': '資產已被任務引用，無法刪除',
    ja: 'アセットはタスクで使用中です',
    ko: '자산이 작업에서 사용 중입니다',
    es: 'El recurso está en uso',
    fr: 'Ressource utilisée par une tâche',
    de: 'Asset wird von einer Aufgabe verwendet',
    it: 'Risorsa in uso da un’attività',
    pt: 'Recurso em uso por uma tarefa',
    ru: 'Ресурс используется задачей',
  },
  PAYLOAD_TOO_LARGE: {
    en: 'Payload too large',
    'zh-CN': '文件超出大小限制',
    'zh-TW': '檔案超出大小限制',
    ja: 'ファイルサイズが上限を超えています',
    ko: '파일 크기가 제한을 초과했습니다',
    es: 'Archivo demasiado grande',
    fr: 'Fichier trop volumineux',
    de: 'Datei zu groß',
    it: 'File troppo grande',
    pt: 'Ficheiro demasiado grande',
    ru: 'Файл слишком большой',
  },
  CONTENT_REJECTED: {
    en: 'Prompt violates content policy',
    'zh-CN': '提示词包含违规内容，无法生成',
    'zh-TW': '提示詞包含違規內容，無法生成',
    ja: 'プロンプトがポリシーに違反しています',
    ko: '프롬프트가 콘텐츠 정책을 위반했습니다',
    es: 'El prompt infringe las normas',
    fr: 'Le prompt enfreint les règles',
    de: 'Prompt verstößt gegen Richtlinien',
    it: 'Il prompt viola le norme',
    pt: 'O prompt viola as normas',
    ru: 'Запрос нарушает правила',
  },
  PASSWORD_REQUIRED: {
    en: 'Current password required',
    'zh-CN': '需要提供当前密码',
    'zh-TW': '需要提供目前密碼',
    ja: '現在のパスワードが必要です',
    ko: '현재 비밀번호가 필요합니다',
    es: 'Se requiere la contraseña actual',
    fr: 'Mot de passe actuel requis',
    de: 'Aktuelles Passwort erforderlich',
    it: 'Password attuale richiesta',
    pt: 'Palavra-passe atual necessária',
    ru: 'Требуется текущий пароль',
  },
  UNFETCHABLE_URL: {
    en: 'URL could not be fetched',
    'zh-CN': '无法拉取该 URL',
    'zh-TW': '無法拉取該 URL',
    ja: 'URL を取得できませんでした',
    ko: 'URL을 가져올 수 없습니다',
    es: 'No se pudo obtener la URL',
    fr: 'URL inaccessible',
    de: 'URL konnte nicht geladen werden',
    it: 'Impossibile recuperare l’URL',
    pt: 'Não foi possível obter o URL',
    ru: 'Не удалось загрузить URL',
  },
  RATE_LIMITED: {
    en: 'Too many requests',
    'zh-CN': '请求过于频繁',
    'zh-TW': '請求過於頻繁',
    ja: 'リクエストが多すぎます',
    ko: '요청이 너무 많습니다',
    es: 'Demasiadas solicitudes',
    fr: 'Trop de requêtes',
    de: 'Zu viele Anfragen',
    it: 'Troppe richieste',
    pt: 'Demasiados pedidos',
    ru: 'Слишком много запросов',
  },
  TOO_MANY_TASKS: {
    en: 'Too many concurrent tasks',
    'zh-CN': '并发任务数已达上限',
    'zh-TW': '並行任務數已達上限',
    ja: '同時実行タスクの上限に達しました',
    ko: '동시 작업 수가 한도에 도달했습니다',
    es: 'Demasiadas tareas simultáneas',
    fr: 'Trop de tâches simultanées',
    de: 'Zu viele gleichzeitige Aufgaben',
    it: 'Troppe attività contemporanee',
    pt: 'Demasiadas tarefas simultâneas',
    ru: 'Слишком много одновременных задач',
  },
  INTERNAL_ERROR: {
    en: 'Internal server error',
    'zh-CN': '服务器内部错误',
    'zh-TW': '伺服器內部錯誤',
    ja: 'サーバー内部エラー',
    ko: '서버 내부 오류',
    es: 'Error interno del servidor',
    fr: 'Erreur interne du serveur',
    de: 'Interner Serverfehler',
    it: 'Errore interno del server',
    pt: 'Erro interno do servidor',
    ru: 'Внутренняя ошибка сервера',
  },
  NO_HEALTHY_PROVIDER: {
    en: 'No available provider',
    'zh-CN': '当前无可用渠道，请稍后重试',
    'zh-TW': '目前無可用渠道，請稍後重試',
    ja: '利用可能なプロバイダーがありません',
    ko: '사용 가능한 공급자가 없습니다',
    es: 'No hay proveedor disponible',
    fr: 'Aucun fournisseur disponible',
    de: 'Kein Anbieter verfügbar',
    it: 'Nessun fornitore disponibile',
    pt: 'Nenhum fornecedor disponível',
    ru: 'Нет доступного провайдера',
  },
  SERVICE_UNAVAILABLE: {
    en: 'Service temporarily unavailable',
    'zh-CN': '服务暂时不可用',
    'zh-TW': '服務暫時無法使用',
    ja: 'サービスは一時的に利用できません',
    ko: '서비스를 일시적으로 사용할 수 없습니다',
    es: 'Servicio no disponible temporalmente',
    fr: 'Service temporairement indisponible',
    de: 'Dienst vorübergehend nicht verfügbar',
    it: 'Servizio temporaneamente non disponibile',
    pt: 'Serviço temporariamente indisponível',
    ru: 'Сервис временно недоступен',
  },
  WEAK_PASSWORD: {
    en: 'Password must be at least 6 characters and contain both letters and numbers',
    'zh-CN': '密码至少 6 位，且必须同时包含字母和数字',
    'zh-TW': '密碼至少 6 位，且必須同時包含字母和數字',
    ja: 'パスワードは6文字以上で、英字と数字の両方を含めてください',
    ko: '비밀번호는 6자 이상이며 영문과 숫자를 모두 포함해야 합니다',
    es: 'La contraseña debe tener al menos 6 caracteres e incluir letras y números',
    fr: 'Le mot de passe doit comporter au moins 6 caractères avec lettres et chiffres',
    de: 'Das Passwort muss mindestens 6 Zeichen lang sein und Buchstaben und Zahlen enthalten',
    it: 'La password deve avere almeno 6 caratteri e includere lettere e numeri',
    pt: 'A palavra-passe deve ter pelo menos 6 caracteres e incluir letras e números',
    ru: 'Пароль должен содержать минимум 6 символов, включая буквы и цифры',
  },
  EMAIL_NOT_CONFIGURED: {
    en: 'Email service is not configured, please contact operations',
    'zh-CN': '邮件服务暂未配置，请联系运营开通',
    'zh-TW': '郵件服務暫未配置，請聯繫運營開通',
    ja: 'メールサービスが未設定です。運営にお問い合わせください',
    ko: '이메일 서비스가 설정되지 않았습니다. 운영팀에 문의하세요',
    es: 'El servicio de correo no está configurado, contacte con operaciones',
    fr: 'Service e-mail non configuré, contactez les opérations',
    de: 'E-Mail-Dienst nicht konfiguriert, bitte an den Betrieb wenden',
    it: 'Servizio e-mail non configurato, contattare le operazioni',
    pt: 'Serviço de e-mail não configurado, contacte as operações',
    ru: 'Почтовый сервис не настроен, обратитесь к операторам',
  },
  SMS_NOT_CONFIGURED: {
    en: 'SMS service is not configured, please use email instead',
    'zh-CN': '短信服务暂未配置，请改用邮箱',
    'zh-TW': '短信服務暫未配置，請改用郵箱',
    ja: 'SMSサービスが未設定です。メールをご利用ください',
    ko: 'SMS 서비스가 설정되지 않았습니다. 이메일을 이용하세요',
    es: 'El servicio SMS no está configurado, use el correo electrónico',
    fr: 'Service SMS non configuré, utilisez l’e-mail',
    de: 'SMS-Dienst nicht konfiguriert, bitte E-Mail verwenden',
    it: 'Servizio SMS non configurato, usare l’e-mail',
    pt: 'Serviço SMS não configurado, use o e-mail',
    ru: 'SMS-сервис не настроен, используйте e-mail',
  },
};

export function messageFor(code: string, locale: Locale = 'en'): string {
  const table = MESSAGES[code];
  if (!table) return MESSAGES.INTERNAL_ERROR!.en;
  return table[locale] ?? table.en;
}

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, details?: Record<string, unknown>, messageOverride?: string) {
    super(messageOverride ?? messageFor(code, 'en'));
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code] ?? 500;
    this.details = details;
  }

  toBody(locale: Locale, requestId: string) {
    return {
      ok: false as const,
      error: {
        code: this.code,
        message: messageFor(this.code, locale),
        ...(this.details ? { details: this.details } : {}),
      },
      requestId,
    };
  }
}

// 便捷构造器（业务代码统一用这些，避免拼错 code）
export const err = {
  invalidParams: (details?: Record<string, unknown>) => new AppError('INVALID_PARAMS', details),
  unauthorized: (details?: Record<string, unknown>) => new AppError('UNAUTHORIZED', details),
  insufficientCredits: (required: number, balance: number, topupUrl = '/pricing') =>
    new AppError('INSUFFICIENT_CREDITS', { required, balance, topupUrl }),
  forbidden: (details?: Record<string, unknown>) => new AppError('FORBIDDEN', details),
  notFound: (details?: Record<string, unknown>) => new AppError('NOT_FOUND', details),
  modelUnavailable: (alternatives: string[] = []) =>
    new AppError('MODEL_UNAVAILABLE', { alternatives }),
  duplicateRequest: (details?: Record<string, unknown>) => new AppError('DUPLICATE_REQUEST', details),
  alreadyCheckedIn: () => new AppError('ALREADY_CHECKED_IN'),
  taskFinal: () => new AppError('TASK_FINAL'),
  accountDeletionPending: () => new AppError('ACCOUNT_DELETION_PENDING'),
  assetInUse: () => new AppError('ASSET_IN_USE'),
  payloadTooLarge: (details?: Record<string, unknown>) => new AppError('PAYLOAD_TOO_LARGE', details),
  contentRejected: (layer: 'blocklist' | 'llm', categories: string[]) =>
    new AppError('CONTENT_REJECTED', { layer, categories }),
  passwordRequired: () => new AppError('PASSWORD_REQUIRED'),
  weakPassword: (reason: 'too_short' | 'no_letter' | 'no_digit') =>
    new AppError('WEAK_PASSWORD', { reason }),
  emailNotConfigured: () => new AppError('EMAIL_NOT_CONFIGURED'),
  smsNotConfigured: () => new AppError('SMS_NOT_CONFIGURED'),
  serviceUnavailable: (reason?: string) =>
    new AppError('SERVICE_UNAVAILABLE', reason ? { reason } : undefined),
  unfetchableUrl: (reason: string) => new AppError('UNFETCHABLE_URL', { reason }),
  rateLimited: (retryAfter?: number) =>
    new AppError('RATE_LIMITED', retryAfter ? { retryAfter } : undefined),
  tooManyTasks: (limit: number, retryAfter?: number) =>
    new AppError('TOO_MANY_TASKS', { limit, ...(retryAfter ? { retryAfter } : {}) }),
  noHealthyProvider: (estimatedRecoverySec: number, reason?: string) =>
    new AppError('NO_HEALTHY_PROVIDER', {
      estimatedRecoverySec,
      ...(reason ? { reason } : {}),
    }),
  internal: (details?: Record<string, unknown>) => new AppError('INTERNAL_ERROR', details),
};
