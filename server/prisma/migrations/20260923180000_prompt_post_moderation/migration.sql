-- xiaoye-adoption F4（docs/xiaoye-adoption-design.md §6）：广场帖子审核状态机
-- 存量 seed 行靠列默认值回填 published（决议 D3：默认自动通过，不刷数据）。
ALTER TABLE "prompt_posts" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'published';
ALTER TABLE "prompt_posts" ADD COLUMN "created_by" UUID;
ALTER TABLE "prompt_posts" ADD COLUMN "reject_reason" TEXT;
