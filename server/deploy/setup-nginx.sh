#!/usr/bin/env bash
# 更新前端到后端 API 所需的 nginx 反向代理配置（在服务器上以 sudo 执行）
#
# 用法：sudo ./deploy/setup-nginx.sh

set -euo pipefail

CONF_SRC="$(cd "$(dirname "$0")" && pwd)/nginx-ai.vutu.cc.conf"
CONF_DST=/etc/nginx/sites-available/ai.vutu.cc.conf

if [ ! -f "$CONF_SRC" ]; then
  echo "ERROR: 找不到 $CONF_SRC" >&2
  exit 1
fi

echo "==> 备份现有配置"
if [ -f "$CONF_DST" ]; then
  cp "$CONF_DST" "$CONF_DST.bak.$(date +%Y%m%d%H%M%S)"
fi

echo "==> 安装新配置"
cp "$CONF_SRC" "$CONF_DST"
ln -sf "$CONF_DST" /etc/nginx/sites-enabled/ai.vutu.cc.conf

echo "==> 校验配置"
nginx -t

echo "==> 重载 nginx"
systemctl reload nginx

echo "==> 验证 /api 反代"
sleep 1
curl -fsS https://ai.vutu.cc/api/health && echo
echo "完成。"
