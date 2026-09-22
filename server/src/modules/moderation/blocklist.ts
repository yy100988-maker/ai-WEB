/**
 * L1 本地敏感词基线库（PRD §4.2 / 详细设计 §1.9 对应的 `moderation_keywords` 表语义）。
 *
 * ⚠️ 为什么是**代码内置**而不是读 DB：
 *   PRD §4.2 设计的是 `moderation_keywords` 表（运营可配、无需发版），
 *   但该表**在 prisma/schema.prisma 中尚未定义**，而 schema 已冻结、由主代理统一管理迁移。
 *   因此本期把基线词库内置在代码里，并通过 `KeywordSource` 接口保证**可替换**：
 *   Phase 后续补上 migration 后，只需实现一个 `DbKeywordSource` 并在 index.ts 换掉默认实现，
 *   审核链路其余代码（预编译正则、去重、分类聚合）完全不用动。
 *
 * 六类（PRD §4.2 固定枚举）：
 *   political  政治
 *   porn       色情
 *   violence   暴力
 *   illegal    违法
 *   traffic    引流
 *   ads        广告
 *
 * 维护约定：
 *  - 中英文**分开维护**（`lang: 'zh' | 'en'`），11 语种前端共用同一套词库，小语种靠 L2 覆盖；
 *  - 词条一律小写存放，英文匹配时先 lower-case 输入；
 *  - 词条是**字面子串/正则片段**，不再是正则本身 —— 由 index.ts 统一编译成预编译 RegExp（P50 < 10ms 要求）；
 *  - 中文用子串匹配即可（中文无词形变化），英文用词边界包裹避免 "ass" 命中 "class"。
 */

export const MODERATION_CATEGORIES = [
  'political',
  'porn',
  'violence',
  'illegal',
  'traffic',
  'ads',
] as const;

export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

/** 分类 → 对客展示名（错误响应 details.categories 用中文，前端也可自行本地化） */
export const CATEGORY_LABEL_ZH: Record<ModerationCategory, string> = {
  political: '政治',
  porn: '色情',
  violence: '暴力',
  illegal: '违法',
  traffic: '引流',
  ads: '广告',
};

export interface KeywordEntry {
  /** 匹配片段：中文子串 / 英文词根 */
  term: string;
  category: ModerationCategory;
  lang: 'zh' | 'en';
  /** 1 = 直接命中即拒；2 = 需与上下文共现（本期简单实现为同样命中） */
  severity: 1 | 2;
}

/**
 * 词库基线。
 *
 * ⚠️ 这里刻意使用**规避型/组合型**词条而不是罗列真实敏感人名与事件名：
 *  1. 直接罗列真实政治人物姓名会让词库文件本身成为敏感资产，且极易误杀正常创作（"画一张某某的肖像"）；
 *  2. 实际拦截面主要来自"描述性违规意图"（涉政恶搞、擦边、违法教程、引流二维码），
 *     这些用模式词条表达更稳、误杀更低；
 *  3. 真实高危词由运营在 `moderation_keywords` 表补齐（Phase），本文件是**可用的安全基线**。
 */
export const BASELINE_KEYWORDS: readonly KeywordEntry[] = [
  // ---------------------------------------------------------------- 政治 political / zh
  { term: '国家领导人', category: 'political', lang: 'zh', severity: 1 },
  { term: '国家主席', category: 'political', lang: 'zh', severity: 1 },
  { term: '总书记', category: 'political', lang: 'zh', severity: 1 },
  { term: '政治局常委', category: 'political', lang: 'zh', severity: 1 },
  { term: '中南海', category: 'political', lang: 'zh', severity: 1 },
  { term: '天安门事件', category: 'political', lang: 'zh', severity: 1 },
  { term: '六四事件', category: 'political', lang: 'zh', severity: 1 },
  { term: '文化大革命', category: 'political', lang: 'zh', severity: 2 },
  { term: '法轮功', category: 'political', lang: 'zh', severity: 1 },
  { term: '台独', category: 'political', lang: 'zh', severity: 1 },
  { term: '港独', category: 'political', lang: 'zh', severity: 1 },
  { term: '藏独', category: 'political', lang: 'zh', severity: 1 },
  { term: '疆独', category: 'political', lang: 'zh', severity: 1 },
  { term: '反华', category: 'political', lang: 'zh', severity: 1 },
  { term: '颠覆国家政权', category: 'political', lang: 'zh', severity: 1 },
  { term: '推翻政府', category: 'political', lang: 'zh', severity: 1 },
  { term: '游行示威', category: 'political', lang: 'zh', severity: 2 },
  { term: '抗议活动', category: 'political', lang: 'zh', severity: 2 },
  // 涉政擦边：恶搞/讽刺国家象征
  { term: '恶搞国旗', category: 'political', lang: 'zh', severity: 1 },
  { term: '焚烧国旗', category: 'political', lang: 'zh', severity: 1 },
  { term: '侮辱国徽', category: 'political', lang: 'zh', severity: 1 },
  { term: '丑化领导人', category: 'political', lang: 'zh', severity: 1 },
  { term: '政治讽刺', category: 'political', lang: 'zh', severity: 2 },
  { term: '党政军', category: 'political', lang: 'zh', severity: 2 },
  { term: '敏感政治', category: 'political', lang: 'zh', severity: 1 },

  // ---------------------------------------------------------------- 政治 political / en
  { term: 'tiananmen square massacre', category: 'political', lang: 'en', severity: 1 },
  { term: 'free tibet', category: 'political', lang: 'en', severity: 1 },
  { term: 'free hong kong', category: 'political', lang: 'en', severity: 1 },
  { term: 'falun gong', category: 'political', lang: 'en', severity: 1 },
  { term: 'overthrow the government', category: 'political', lang: 'en', severity: 1 },
  { term: 'political propaganda', category: 'political', lang: 'en', severity: 2 },
  { term: 'burn the flag', category: 'political', lang: 'en', severity: 1 },
  { term: 'anti-china', category: 'political', lang: 'en', severity: 1 },

  // ---------------------------------------------------------------- 色情 porn / zh
  { term: '色情', category: 'porn', lang: 'zh', severity: 1 },
  { term: '裸体', category: 'porn', lang: 'zh', severity: 1 },
  { term: '全裸', category: 'porn', lang: 'zh', severity: 1 },
  { term: '裸露', category: 'porn', lang: 'zh', severity: 1 },
  { term: '性行为', category: 'porn', lang: 'zh', severity: 1 },
  { term: '做爱', category: 'porn', lang: 'zh', severity: 1 },
  { term: '口交', category: 'porn', lang: 'zh', severity: 1 },
  { term: '性器官', category: 'porn', lang: 'zh', severity: 1 },
  { term: '生殖器', category: 'porn', lang: 'zh', severity: 1 },
  { term: '乳房特写', category: 'porn', lang: 'zh', severity: 1 },
  { term: '未成年性', category: 'porn', lang: 'zh', severity: 1 },
  { term: '儿童色情', category: 'porn', lang: 'zh', severity: 1 },
  { term: '萝莉控', category: 'porn', lang: 'zh', severity: 1 },
  { term: '擦边', category: 'porn', lang: 'zh', severity: 2 },
  { term: '情色', category: 'porn', lang: 'zh', severity: 1 },
  { term: '三级片', category: 'porn', lang: 'zh', severity: 1 },
  { term: '淫秽', category: 'porn', lang: 'zh', severity: 1 },
  { term: '露点', category: 'porn', lang: 'zh', severity: 2 },
  { term: '走光', category: 'porn', lang: 'zh', severity: 2 },
  { term: '脱衣舞', category: 'porn', lang: 'zh', severity: 1 },

  // ---------------------------------------------------------------- 色情 porn / en
  { term: 'porn', category: 'porn', lang: 'en', severity: 1 },
  { term: 'pornography', category: 'porn', lang: 'en', severity: 1 },
  { term: 'nsfw', category: 'porn', lang: 'en', severity: 1 },
  { term: 'nude', category: 'porn', lang: 'en', severity: 1 },
  { term: 'naked', category: 'porn', lang: 'en', severity: 1 },
  { term: 'topless', category: 'porn', lang: 'en', severity: 1 },
  { term: 'explicit sex', category: 'porn', lang: 'en', severity: 1 },
  { term: 'sexual intercourse', category: 'porn', lang: 'en', severity: 1 },
  { term: 'genitalia', category: 'porn', lang: 'en', severity: 1 },
  { term: 'nipples', category: 'porn', lang: 'en', severity: 1 },
  { term: 'erotic', category: 'porn', lang: 'en', severity: 1 },
  { term: 'hentai', category: 'porn', lang: 'en', severity: 1 },
  { term: 'child porn', category: 'porn', lang: 'en', severity: 1 },
  { term: 'loli', category: 'porn', lang: 'en', severity: 1 },
  { term: 'striptease', category: 'porn', lang: 'en', severity: 1 },
  { term: 'fetish', category: 'porn', lang: 'en', severity: 2 },

  // ---------------------------------------------------------------- 暴力 violence / zh
  { term: '血腥', category: 'violence', lang: 'zh', severity: 1 },
  { term: '虐杀', category: 'violence', lang: 'zh', severity: 1 },
  { term: '肢解', category: 'violence', lang: 'zh', severity: 1 },
  { term: '斩首', category: 'violence', lang: 'zh', severity: 1 },
  { term: '割喉', category: 'violence', lang: 'zh', severity: 1 },
  { term: '内脏外露', category: 'violence', lang: 'zh', severity: 1 },
  { term: '残肢', category: 'violence', lang: 'zh', severity: 1 },
  { term: '自杀', category: 'violence', lang: 'zh', severity: 1 },
  { term: '上吊', category: 'violence', lang: 'zh', severity: 1 },
  { term: '自残', category: 'violence', lang: 'zh', severity: 1 },
  { term: '虐待动物', category: 'violence', lang: 'zh', severity: 1 },
  { term: '校园枪击', category: 'violence', lang: 'zh', severity: 1 },
  { term: '恐怖袭击', category: 'violence', lang: 'zh', severity: 1 },
  { term: '制造炸弹', category: 'violence', lang: 'zh', severity: 1 },
  { term: '爆炸物制作', category: 'violence', lang: 'zh', severity: 1 },
  { term: '打死人', category: 'violence', lang: 'zh', severity: 2 },
  { term: '酷刑', category: 'violence', lang: 'zh', severity: 1 },

  // ---------------------------------------------------------------- 暴力 violence / en
  { term: 'gore', category: 'violence', lang: 'en', severity: 1 },
  { term: 'gory', category: 'violence', lang: 'en', severity: 1 },
  { term: 'beheading', category: 'violence', lang: 'en', severity: 1 },
  { term: 'decapitation', category: 'violence', lang: 'en', severity: 1 },
  { term: 'dismemberment', category: 'violence', lang: 'en', severity: 1 },
  { term: 'mutilation', category: 'violence', lang: 'en', severity: 1 },
  { term: 'massacre', category: 'violence', lang: 'en', severity: 1 },
  { term: 'torture', category: 'violence', lang: 'en', severity: 1 },
  { term: 'suicide', category: 'violence', lang: 'en', severity: 1 },
  { term: 'self-harm', category: 'violence', lang: 'en', severity: 1 },
  { term: 'animal cruelty', category: 'violence', lang: 'en', severity: 1 },
  { term: 'terrorist attack', category: 'violence', lang: 'en', severity: 1 },
  { term: 'how to make a bomb', category: 'violence', lang: 'en', severity: 1 },
  { term: 'school shooting', category: 'violence', lang: 'en', severity: 1 },

  // ---------------------------------------------------------------- 违法 illegal / zh
  { term: '毒品', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '冰毒', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '海洛因', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '大麻', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '制毒', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '贩毒', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '吸毒', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '枪支买卖', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '军火交易', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '假钞', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '洗钱', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '人口贩卖', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '拐卖儿童', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '诈骗话术', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '赌博网站', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '开设赌场', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '私彩', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '偷拍', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '黑客攻击', category: 'illegal', lang: 'zh', severity: 1 },
  { term: '盗刷信用卡', category: 'illegal', lang: 'zh', severity: 1 },

  // ---------------------------------------------------------------- 违法 illegal / en
  { term: 'cocaine', category: 'illegal', lang: 'en', severity: 1 },
  { term: 'heroin', category: 'illegal', lang: 'en', severity: 1 },
  { term: 'methamphetamine', category: 'illegal', lang: 'en', severity: 1 },
  { term: 'drug trafficking', category: 'illegal', lang: 'en', severity: 1 },
  { term: 'how to cook meth', category: 'illegal', lang: 'en', severity: 1 },
  { term: 'counterfeit money', category: 'illegal', lang: 'en', severity: 1 },
  { term: 'money laundering', category: 'illegal', lang: 'en', severity: 1 },
  { term: 'human trafficking', category: 'illegal', lang: 'en', severity: 1 },
  { term: 'illegal gambling', category: 'illegal', lang: 'en', severity: 1 },
  { term: 'credit card fraud', category: 'illegal', lang: 'en', severity: 1 },
  { term: 'hack into', category: 'illegal', lang: 'en', severity: 2 },
  { term: 'buy firearms', category: 'illegal', lang: 'en', severity: 1 },

  // ---------------------------------------------------------------- 引流 traffic / zh
  { term: '加微信', category: 'traffic', lang: 'zh', severity: 1 },
  { term: '加我微信', category: 'traffic', lang: 'zh', severity: 1 },
  { term: '微信号', category: 'traffic', lang: 'zh', severity: 1 },
  { term: '扫码加', category: 'traffic', lang: 'zh', severity: 1 },
  { term: '扫码进群', category: 'traffic', lang: 'zh', severity: 1 },
  { term: '加qq群', category: 'traffic', lang: 'zh', severity: 1 },
  { term: '私聊我', category: 'traffic', lang: 'zh', severity: 2 },
  { term: '私信我', category: 'traffic', lang: 'zh', severity: 2 },
  { term: '点击链接', category: 'traffic', lang: 'zh', severity: 2 },
  { term: '关注公众号', category: 'traffic', lang: 'zh', severity: 1 },
  { term: 'telegram群', category: 'traffic', lang: 'zh', severity: 1 },
  { term: '电报群', category: 'traffic', lang: 'zh', severity: 1 },
  { term: '引流', category: 'traffic', lang: 'zh', severity: 1 },
  { term: '拉人头', category: 'traffic', lang: 'zh', severity: 1 },
  { term: '二维码推广', category: 'traffic', lang: 'zh', severity: 1 },

  // ---------------------------------------------------------------- 引流 traffic / en
  { term: 'dm me', category: 'traffic', lang: 'en', severity: 2 },
  { term: 'click the link', category: 'traffic', lang: 'en', severity: 2 },
  { term: 'join my telegram', category: 'traffic', lang: 'en', severity: 1 },
  { term: 'scan the qr code', category: 'traffic', lang: 'en', severity: 1 },
  { term: 'whatsapp me', category: 'traffic', lang: 'en', severity: 1 },
  { term: 'link in bio', category: 'traffic', lang: 'en', severity: 2 },

  // ---------------------------------------------------------------- 广告 ads / zh
  { term: '免费领取', category: 'ads', lang: 'zh', severity: 2 },
  { term: '限时秒杀', category: 'ads', lang: 'zh', severity: 2 },
  { term: '低价代充', category: 'ads', lang: 'zh', severity: 1 },
  { term: '代刷', category: 'ads', lang: 'zh', severity: 1 },
  { term: '刷单', category: 'ads', lang: 'zh', severity: 1 },
  { term: '兼职日结', category: 'ads', lang: 'zh', severity: 1 },
  { term: '高额返利', category: 'ads', lang: 'zh', severity: 1 },
  { term: '稳赚不赔', category: 'ads', lang: 'zh', severity: 1 },
  { term: '投资理财群', category: 'ads', lang: 'zh', severity: 1 },
  { term: '办证刻章', category: 'ads', lang: 'zh', severity: 1 },
  { term: '开发票', category: 'ads', lang: 'zh', severity: 2 },
  { term: '无门槛贷款', category: 'ads', lang: 'zh', severity: 1 },

  // ---------------------------------------------------------------- 广告 ads / en
  { term: 'buy followers', category: 'ads', lang: 'en', severity: 1 },
  { term: 'cheap viagra', category: 'ads', lang: 'en', severity: 1 },
  { term: 'get rich quick', category: 'ads', lang: 'en', severity: 1 },
  { term: 'guaranteed returns', category: 'ads', lang: 'en', severity: 1 },
  { term: 'work from home earn', category: 'ads', lang: 'en', severity: 2 },
  { term: 'free giveaway click', category: 'ads', lang: 'en', severity: 2 },
];

/**
 * 涉政擦边模式（PRD §4.2 "涉政擦边 prompt" 验收点 §13 #23 的第二类输入）。
 *
 * 为什么单独一组：单纯词表命中不了"把某国领导人做成 XX 风格"这类**组合式**表达，
 * 而这类表达恰恰是审核系统最该拦的。这里用「称谓/机构 + 贬损/戏谑动作」的共现模式表达，
 * 既是 L1 的兜底，也是 L2 启发式分类器的核心特征来源。
 */
export interface CooccurrencePattern {
  /** 主体侧（称谓 / 机构 / 国家象征） */
  subject: RegExp;
  /** 动作侧（贬损 / 戏谑 / 恶搞） */
  action: RegExp;
  category: ModerationCategory;
}

export const COOCCURRENCE_PATTERNS: readonly CooccurrencePattern[] = [
  {
    subject: /(主席|总统|总书记|总理|首相|领导人|国家元首|prime minister|president|chairman|leader)/i,
    action: /(恶搞|丑化|嘲讽|讽刺|搞笑|滑稽|卡通化|鬼畜|变装|跳舞|跳科目三|meme|parody|mocked|clown|dancing|cosplay|cartoon)/i,
    category: 'political',
  },
  {
    subject: /(国旗|国徽|国歌|党旗|军旗|national flag|emblem|anthem)/i,
    action: /(焚烧|烧毁|涂鸦|踩踏|撕毁|恶搞|burn|burning|trample|defac|graffiti)/i,
    category: 'political',
  },
  {
    subject: /(解放军|军队|军人|武警|警察|公安|police|army|soldier|military)/i,
    action: /(血腥|屠杀|镇压|虐杀|侮辱|羞辱|slaughter|massacre|suppress|humiliat)/i,
    category: 'political',
  },
  {
    subject: /(宗教|清真寺|教堂|佛|耶稣|真主|religion|mosque|church|buddha|jesus|allah)/i,
    action: /(亵渎|侮辱|焚烧|恶搞|blasphem|desecrat|insult|mock)/i,
    category: 'political',
  },
  {
    subject: /(儿童|小孩|幼女|未成年|child|kid|minor|teen)/i,
    action: /(裸露|裸体|色情|性|内衣|nude|naked|sexy|lingerie|underwear)/i,
    category: 'porn',
  },
];

/** 按语言分组（预编译用）：中文词条直接子串，英文词条加词边界 */
export function keywordsByLang(lang: 'zh' | 'en', entries: readonly KeywordEntry[] = BASELINE_KEYWORDS): KeywordEntry[] {
  return entries.filter((e) => e.lang === lang);
}
