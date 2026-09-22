-- 补充迁移：内容审核表 + 返还幂等部分唯一索引
--
-- 1. moderation_keywords：L1 敏感词库（PRD §4.2），运营可配、无需发版。
--    代码内置基线词库（src/modules/moderation/blocklist.ts）作为兜底数据源，
--    本表用于运营增量配置。
-- 2. moderation_logs：审核审计（PRD §4.2）。**只存 prompt_hash，不存原文**（隐私）。
-- 3. credit_ledger 的 task_refund 部分唯一索引：返还幂等的第二道保险
--    （详细设计 §1.6 建议补充）。

-- ---------- 内容审核 ----------

CREATE TABLE IF NOT EXISTS "moderation_keywords" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "term"       TEXT         NOT NULL,
    "category"   TEXT         NOT NULL,
    "lang"       VARCHAR(8)   NOT NULL DEFAULT 'zh',
    "severity"   INTEGER      NOT NULL DEFAULT 1,
    "active"     BOOLEAN      NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_keywords_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "moderation_keywords_term_category_lang_key"
    ON "moderation_keywords" ("term", "category", "lang");

CREATE INDEX IF NOT EXISTS "moderation_keywords_active_lang_idx"
    ON "moderation_keywords" ("active", "lang");

CREATE TABLE IF NOT EXISTS "moderation_logs" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "prompt_hash" TEXT        NOT NULL,
    "verdict"     TEXT        NOT NULL,
    "layer"       TEXT        NOT NULL,
    "categories"  JSONB       NOT NULL DEFAULT '[]',
    "latency_ms"  INTEGER     NOT NULL DEFAULT 0,
    "task_id"     UUID,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "moderation_logs_created_at_idx" ON "moderation_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "moderation_logs_prompt_hash_idx" ON "moderation_logs" ("prompt_hash");
CREATE INDEX IF NOT EXISTS "moderation_logs_verdict_idx" ON "moderation_logs" ("verdict", "layer");

-- ---------- 返还幂等部分唯一索引 ----------
-- 同一 task 只允许一条 task_refund 流水，杜绝重放重复返还（详细设计 §1.6 / §3.4）。
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_task_refund_unique"
    ON "credit_ledger" ("task_id")
    WHERE "type" = 'task_refund';

-- 同一 task 只允许一条 task_deduct 流水，杜绝重复扣费（PRD §6.12 幂等）。
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_task_deduct_unique"
    ON "credit_ledger" ("task_id")
    WHERE "type" = 'task_deduct';
