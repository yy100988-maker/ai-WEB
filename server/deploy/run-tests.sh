#!/usr/bin/env bash
# 在服务器上跑集成 + E2E 测试（真 PG/Redis + MockProvider，零上游费用）
#
# 用法：cd /opt/vutu-backend && ./deploy/run-tests.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# 从 .env 取数据库密码，拼出宿主机可达的测试连接串
PG_PASS="$(grep -oP '(?<=vutu:)[^@]+(?=@postgres)' .env)"
export TEST_DATABASE_URL="postgresql://vutu:${PG_PASS}@postgres:5432/vutu?schema=public"
export TEST_REDIS_URL="redis://redis:6379"
export MOCK_PROVIDER=true
export MOCK_LATENCY_MS=200
export MOCK_FAIL_INJECTION=true
export POLL_INTERVAL_SEC=1
export NODE_ENV=test
export LOG_LEVEL=silent
export JWT_SECRET="test-secret-at-least-32-bytes-long-xxxxx"
export ADMIN_TOKEN="test-admin-token"
export BCRYPT_ROUNDS=4

echo "==> 构建测试镜像（含 devDependencies + tests/）"
docker compose --profile test build test

echo "==> 运行集成 + E2E 测试（容器内，连接 compose 内的 PG/Redis）"
docker compose --profile test run --rm test \
  npx vitest run --config vitest.integration.config.ts "$@"
