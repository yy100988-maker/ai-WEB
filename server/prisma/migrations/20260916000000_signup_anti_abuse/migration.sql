-- 反机器批量注册刷号：一次性邮箱域名库 + 注册风控审计
--
-- 背景：原有防护只有"同邮箱 1/min、同 IP 10/min"，换 IP 即可绕过。
-- 本迁移提供运营可配的**域名黑名单**与**注册决策审计**，配合代码侧的
-- IP 小时/天配额、全局日发送熔断、行为信号、Turnstile 人机验证构成纵深防护。

-- ---------- 一次性邮箱域名 ----------
-- 命中则拒绝注册发码（reason=disposable_domain）。
-- 运营可通过 admin 接口增删，无需发版。
CREATE TABLE IF NOT EXISTS "disposable_email_domains" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "domain"     TEXT         NOT NULL,
    "reason"     TEXT         NOT NULL DEFAULT 'disposable',
    "active"     BOOLEAN      NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disposable_email_domains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "disposable_email_domains_domain_key"
    ON "disposable_email_domains" ("domain");

CREATE INDEX IF NOT EXISTS "disposable_email_domains_active_idx"
    ON "disposable_email_domains" ("active");

-- ---------- 注册风控审计 ----------
-- 每次发码/验码/设密决策落一行，用于复盘刷号行为与误杀申诉。
-- ⚠️ 不存邮箱明文，只存 sha256 前 32 位（与 rate-limit 的 identifierKey 同源）。
CREATE TABLE IF NOT EXISTS "signup_risk_logs" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "identifier"  TEXT        NOT NULL,        -- 邮箱/手机 sha256 前 32 位
    "domain"      TEXT,                        -- 邮箱域（非敏感，便于统计）
    "ip"          TEXT,
    "stage"       TEXT        NOT NULL,        -- register | verify | set_password | recovery_*
    "verdict"     TEXT        NOT NULL,        -- allow | block | challenge
    "reason"      TEXT,                        -- disposable_domain | ip_hour_quota | ...
    "signals"     JSONB       NOT NULL DEFAULT '{}',  -- 行为信号明细（honeypot/elapsed/turnstile）
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_risk_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "signup_risk_logs_created_at_idx"
    ON "signup_risk_logs" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "signup_risk_logs_verdict_idx"
    ON "signup_risk_logs" ("verdict", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "signup_risk_logs_ip_idx"
    ON "signup_risk_logs" ("ip", "created_at" DESC);

-- ---------- 一次性域名基线数据 ----------
-- 覆盖主流临时邮箱服务。刻意用 domain 精确匹配 + 后缀匹配（代码侧实现），
-- 因此这里列的是**根域**，子域由代码的 endsWith 逻辑覆盖。
INSERT INTO "disposable_email_domains" ("domain", "reason") VALUES
    ('mailinator.com', 'disposable'),
    ('guerrillamail.com', 'disposable'),
    ('10minutemail.com', 'disposable'),
    ('tempmail.com', 'disposable'),
    ('temp-mail.org', 'disposable'),
    ('throwawaymail.com', 'disposable'),
    ('yopmail.com', 'disposable'),
    ('sharklasers.com', 'disposable'),
    ('getnada.com', 'disposable'),
    ('trashmail.com', 'disposable'),
    ('maildrop.cc', 'disposable'),
    ('dispostable.com', 'disposable'),
    ('fakeinbox.com', 'disposable'),
    ('mailnesia.com', 'disposable'),
    ('mintemail.com', 'disposable'),
    ('mytemp.email', 'disposable'),
    ('spamgourmet.com', 'disposable'),
    ('emailondeck.com', 'disposable'),
    ('moakt.com', 'disposable'),
    ('tempr.email', 'disposable')
ON CONFLICT ("domain") DO NOTHING;
