-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timeout');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('grant_signup', 'grant_checkin', 'purchase', 'task_deduct', 'task_refund', 'refund', 'admin_adjust', 'promo', 'expire');

-- CreateEnum
CREATE TYPE "BillingMethod" AS ENUM ('per_call', 'per_token', 'per_second');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('free', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('upload', 'output');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('task_completed', 'task_failed', 'subscription_expiry', 'promo');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "password_hash" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "plan_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(50),
    "avatar_asset_id" UUID,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "provider_id" TEXT NOT NULL,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" "PlanCode" NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "list_price_usd" INTEGER NOT NULL,
    "monthly_credits" INTEGER NOT NULL,
    "checkin_credits" INTEGER NOT NULL,
    "max_concurrency" INTEGER NOT NULL,
    "plan_discount" DECIMAL(4,3),
    "features" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "current_period_start" TIMESTAMPTZ NOT NULL,
    "current_period_end" TIMESTAMPTZ NOT NULL,
    "external_ref" TEXT,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rate_limit_rpm" INTEGER NOT NULL DEFAULT 120,
    "timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "health_status" TEXT NOT NULL DEFAULT 'unknown',
    "circuit_state" TEXT NOT NULL DEFAULT 'closed',
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel_id" UUID NOT NULL,
    "key_ref" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT '价格优先',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "quota_limit" DECIMAL(18,6),
    "quota_used" DECIMAL(18,6) NOT NULL DEFAULT 0,

    CONSTRAINT "channel_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "capabilities" TEXT[],
    "param_mapping" JSONB NOT NULL,
    "required_params" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "quality_score" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_sec" INTEGER,
    "checksum" TEXT,
    "source_url" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "model_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "api_key_id" UUID,
    "status" "TaskStatus" NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "prompt" TEXT NOT NULL DEFAULT '',
    "negative_prompt" TEXT,
    "params" JSONB NOT NULL,
    "input_asset_ids" UUID[],
    "external_job_id" TEXT,
    "external_status" JSONB,
    "result_asset_ids" UUID[],
    "error" JSONB,
    "price_snapshot" JSONB NOT NULL,
    "quoted_credits" INTEGER NOT NULL,
    "deducted_credits" INTEGER NOT NULL,
    "settled_credits" INTEGER NOT NULL DEFAULT 0,
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "queued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "from_status" "TaskStatus",
    "to_status" "TaskStatus",
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_costs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "billing_method" "BillingMethod" NOT NULL,
    "cost_units" DECIMAL(18,6) NOT NULL,
    "channel_group" TEXT,
    "platform_refunded" BOOLEAN NOT NULL DEFAULT false,
    "refunded_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER,
    "raw_usage" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "type" "LedgerType" NOT NULL,
    "task_id" UUID,
    "order_id" UUID,
    "balance_after" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_checkins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "credits" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_balance_reset" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "reset_amount" INTEGER NOT NULL,

    CONSTRAINT "daily_balance_reset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "last_granted_at" TIMESTAMPTZ NOT NULL,
    "next_grant_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "external_ref" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ,
    "error" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "model_id" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "spec_hash" TEXT NOT NULL,
    "cost_units" DECIMAL(18,6) NOT NULL,
    "markup" DECIMAL(4,3) NOT NULL DEFAULT 1.3,
    "credits" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "price_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_sync_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "model_id" UUID NOT NULL,
    "old_cost_units" DECIMAL(18,6),
    "new_cost_units" DECIMAL(18,6),
    "old_credits" INTEGER,
    "new_credits" INTEGER,
    "triggered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,

    CONSTRAINT "price_sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_pricing_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "model_id" UUID NOT NULL,
    "group_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "billing_method" "BillingMethod" NOT NULL,
    "base_price" DECIMAL(18,6) NOT NULL,
    "min_price" DECIMAL(18,6) NOT NULL,
    "input_token_price" DECIMAL(18,6),
    "output_token_price" DECIMAL(18,6),
    "option_prices" JSONB NOT NULL,
    "time_discounts" JSONB,
    "success_rate_24h" DOUBLE PRECISION,
    "avg_response_seconds" DOUBLE PRECISION,
    "captured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_pricing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "capability" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "candidates" JSONB NOT NULL,
    "fallback_enabled" BOOLEAN NOT NULL DEFAULT true,
    "circuit_breaker" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "routing_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" TEXT NOT NULL,
    "target_id" TEXT,
    "discount" DECIMAL(4,3) NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_coupons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "discount" DECIMAL(18,2) NOT NULL,
    "used_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title_i18n" JSONB NOT NULL,
    "body_i18n" JSONB NOT NULL,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "email_notifications" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" JSONB NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_tabs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "label_i18n" JSONB NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "prompt_tabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tab_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "img_url" TEXT NOT NULL,
    "asset_id" UUID,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "copies" INTEGER NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_post_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_post_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remix_projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "source_asset_id" UUID,
    "source_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'analyzing',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remix_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remix_scenes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "idx" INTEGER NOT NULL,
    "start_sec" INTEGER NOT NULL,
    "end_sec" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "thumb_asset_id" UUID,
    "task_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "remix_scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remix_global_refs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "remix_global_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_public_id_key" ON "users"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_provider_id_key" ON "oauth_accounts"("provider", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "channels_code_key" ON "channels"("code");

-- CreateIndex
CREATE INDEX "models_enabled_active_idx" ON "models"("enabled", "active");

-- CreateIndex
CREATE UNIQUE INDEX "models_channel_id_code_key" ON "models"("channel_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "assets_public_id_key" ON "assets"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_storage_key_key" ON "assets"("storage_key");

-- CreateIndex
CREATE INDEX "assets_user_id_kind_created_at_idx" ON "assets"("user_id", "kind", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tasks_public_id_key" ON "tasks"("public_id");

-- CreateIndex
CREATE INDEX "tasks_user_id_status_created_at_idx" ON "tasks"("user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tasks_external_job_id_idx" ON "tasks"("external_job_id");

-- CreateIndex
CREATE INDEX "tasks_status_queued_at_idx" ON "tasks"("status", "queued_at");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_user_id_idempotency_key_key" ON "tasks"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "task_events_task_id_created_at_idx" ON "task_events"("task_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_costs_task_id_key" ON "task_costs"("task_id");

-- CreateIndex
CREATE INDEX "credit_ledger_user_id_created_at_idx" ON "credit_ledger"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "credit_ledger_task_id_idx" ON "credit_ledger"("task_id");

-- CreateIndex
CREATE INDEX "credit_ledger_user_id_expires_at_idx" ON "credit_ledger"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_user_id_idempotency_key_key" ON "credit_ledger"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "daily_checkins_user_id_date_key" ON "daily_checkins"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_balance_reset_user_id_date_key" ON "daily_balance_reset"("user_id", "date");

-- CreateIndex
CREATE INDEX "grants_next_grant_at_idx" ON "grants"("next_grant_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_public_id_key" ON "orders"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_source_external_id_key" ON "webhook_events"("source", "external_id");

-- CreateIndex
CREATE INDEX "price_items_capability_active_idx" ON "price_items"("capability", "active");

-- CreateIndex
CREATE UNIQUE INDEX "price_items_model_id_capability_spec_hash_key" ON "price_items"("model_id", "capability", "spec_hash");

-- CreateIndex
CREATE INDEX "price_sync_log_triggered_at_idx" ON "price_sync_log"("triggered_at");

-- CreateIndex
CREATE INDEX "model_pricing_snapshots_model_id_captured_at_idx" ON "model_pricing_snapshots"("model_id", "captured_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "routing_policies_capability_key" ON "routing_policies"("capability");

-- CreateIndex
CREATE INDEX "promotions_active_starts_at_ends_at_idx" ON "promotions"("active", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "user_coupons_user_id_used_at_idx" ON "user_coupons"("user_id", "used_at");

-- CreateIndex
CREATE INDEX "user_notifications_user_id_read_at_created_at_idx" ON "user_notifications"("user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_tabs_code_key" ON "prompt_tabs"("code");

-- CreateIndex
CREATE INDEX "prompt_posts_tab_code_active_sort_idx" ON "prompt_posts"("tab_code", "active", "sort");

-- CreateIndex
CREATE INDEX "prompt_post_events_post_id_date_idx" ON "prompt_post_events"("post_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_post_events_post_id_user_id_event_date_key" ON "prompt_post_events"("post_id", "user_id", "event", "date");

-- CreateIndex
CREATE UNIQUE INDEX "remix_scenes_project_id_idx_key" ON "remix_scenes"("project_id", "idx");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_api_keys" ADD CONSTRAINT "channel_api_keys_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_costs" ADD CONSTRAINT "task_costs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_costs" ADD CONSTRAINT "task_costs_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_costs" ADD CONSTRAINT "task_costs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_checkins" ADD CONSTRAINT "daily_checkins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_items" ADD CONSTRAINT "price_items_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_sync_log" ADD CONSTRAINT "price_sync_log_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_pricing_snapshots" ADD CONSTRAINT "model_pricing_snapshots_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_posts" ADD CONSTRAINT "prompt_posts_tab_code_fkey" FOREIGN KEY ("tab_code") REFERENCES "prompt_tabs"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_post_events" ADD CONSTRAINT "prompt_post_events_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "prompt_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remix_scenes" ADD CONSTRAINT "remix_scenes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "remix_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remix_global_refs" ADD CONSTRAINT "remix_global_refs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "remix_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

