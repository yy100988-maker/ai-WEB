-- xiaoye-adoption F3（docs/xiaoye-adoption-design.md §5）：积分兑换码
-- 只存 sha256(code)（code_hash 唯一），明文仅生成时返回一次；条件更新 redeemed_by 防双花。
CREATE TABLE "redeem_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code_hash" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "note" TEXT,
    "expires_at" TIMESTAMPTZ,
    "redeemed_by_id" UUID,
    "redeemed_at" TIMESTAMPTZ,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redeem_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "redeem_keys_code_hash_key" ON "redeem_keys"("code_hash");

CREATE INDEX "redeem_keys_batch_id_idx" ON "redeem_keys"("batch_id");
