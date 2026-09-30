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

BAK=""
echo "==> 备份现有配置"
if [ -f "$CONF_DST" ]; then
  BAK="$CONF_DST.bak.$(date +%Y%m%d%H%M%S)"
  cp "$CONF_DST" "$BAK"
  echo "    备份至 $BAK"
fi

echo "==> 安装新配置"
cp "$CONF_SRC" "$CONF_DST"
ln -sf "$CONF_DST" /etc/nginx/sites-enabled/ai.vutu.cc.conf

echo "==> 校验配置"
# ⚠️ 必须校验失败即回滚：原先是 set -e 直接退出，把**坏配置留在原地**。
# nginx 靠内存里的旧配置继续跑（表面正常），但此后任何 reload
# （certbot 自动续期、systemctl restart）都会失败 —— 故障被推迟到最坏的时刻爆发。
# 且上面生成的 .bak 从未被使用。
if ! nginx -t; then
  echo "ERROR: nginx 配置校验失败，正在回滚" >&2
  if [ -f "$BAK" ]; then
    cp "$BAK" "$CONF_DST"
    nginx -t >/dev/null 2>&1 || true
    echo "已回滚到 $BAK" >&2
  else
    rm -f "$CONF_DST"
    echo "无备份可回滚，已移除新配置（请手工确认 nginx 状态）" >&2
  fi
  exit 1
fi

echo "==> 重载 nginx"
systemctl reload nginx

echo "==> 验证 /api 反代"
sleep 1
curl -fsS https://ai.vutu.cc/api/health && echo
echo "完成。"
