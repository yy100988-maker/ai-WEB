-- xiaoye-adoption F5（docs/xiaoye-adoption-design.md §7）：批量生成分组键
-- 客户端扇出 + batchId 展示分组，不建批量原子接口（保持"一任务一扣一退"不变式）。
ALTER TABLE "tasks" ADD COLUMN "batch_id" TEXT;

CREATE INDEX "tasks_user_id_batch_id_idx" ON "tasks"("user_id", "batch_id");
