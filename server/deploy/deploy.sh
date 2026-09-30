#!/usr/bin/env bash
# Vutu 后端部署脚本（在服务器上执行）
#
# 用法：
#   cd /opt/vutu-backend && ./deploy/deploy.sh
#
# 前置：/opt/vutu-backend/.env 已配置（权限 600）

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/vutu-backend}"
cd "$APP_DIR"

echo "==> 1/7 检查 .env"
if [ ! -f .env ]; then
  echo "ERROR: $APP_DIR/.env 不存在。请先 cp .env.example .env 并填写密钥。" >&2
  exit 1
fi
chmod 600 .env

echo "==> 2/7 构建镜像"
docker compose build

echo "==> 3/7 启动基础设施（postgres/redis/minio）"
docker compose up -d postgres redis minio minio-init

echo "==> 4/7 等待 postgres 就绪"
for i in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U vutu -d vutu >/dev/null 2>&1; then
    echo "    postgres ready"
    break
  fi
  sleep 2
  if [ "$i" -eq 60 ]; then
    echo "ERROR: postgres 未就绪" >&2
    exit 1
  fi
done

echo "==> 5/7 执行数据库迁移"
docker compose run --rm api npx prisma migrate deploy

echo "==> 6/7 灌入 seed 数据"
docker compose run --rm api npx tsx prisma/seed.ts

echo "==> 7/7 启动 api + worker"
docker compose up -d api worker

echo "==> 等待 api 健康检查"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/v1/health >/dev/null 2>&1; then
    echo "    api healthy"
    curl -s http://127.0.0.1:8080/v1/health
    echo
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    # ⚠️ 原先这里只 echo WARN 就继续，脚本仍以 0 退出 —— 部署"成功"但服务不可用，
    # 调用方无从察觉。健康检查失败必须让部署失败，否则告警永远收不到。
    echo "ERROR: api 健康检查未通过（30 次重试 x 2s），部署失败" >&2
    echo "请查看日志：docker compose logs api" >&2
    exit 1
  fi
done

echo
echo "==> 部署完成。状态："
docker compose ps
