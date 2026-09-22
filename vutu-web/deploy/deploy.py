"""部署 vutu-web 到生产服务器 13.250.182.43。

流程：
  1. 上传 dist/ → /opt/vutu-studio/（原子切换，保留上一版做回滚）
  2. 写入 nginx location /studio/（先备份当前配置）
  3. nginx -t 校验，通过才 reload；失败自动回滚配置

用法：
    python deploy/deploy.py            # 完整部署
    python deploy/deploy.py upload     # 仅上传前端
    python deploy/deploy.py nginx      # 仅配置 nginx
    python deploy/deploy.py rollback   # 回滚到上一版前端
"""
import os
import posixpath
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "13.250.182.43"
KEY = r"D:\文档\亚马逊\APP.pem"
USER = "ubuntu"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")

REMOTE_ROOT = "/opt/vutu-studio"
REMOTE_CURRENT = f"{REMOTE_ROOT}/current"
REMOTE_PREV = f"{REMOTE_ROOT}/previous"
NGINX_SITE = "/etc/nginx/sites-enabled/ai.vutu.cc.conf"

# 插入到 `location /api/` 之前的 nginx 片段（静态站点 + SPA 回退）
NGINX_SNIPPET = """
  # ---------------- Vutu 生图工作台（静态站点） ----------------
  # 由 server/deploy 同域托管：/studio/ → /opt/vutu-studio/current
  location /studio/ {
    alias /opt/vutu-studio/current/;
    index index.html;
    try_files $uri $uri/ /studio/index.html;
    access_log off;
  }
"""


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=22, username=USER, key_filename=KEY,
              timeout=25, allow_agent=False, look_for_keys=False)
    return c


def run(c, cmd, timeout=600, check=False):
    i, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    code = o.channel.recv_exit_status()
    print(f"$ {cmd}")
    if out.strip():
        print(out.rstrip()[:4000])
    if err.strip():
        print("[stderr]", err.rstrip()[:1500])
    if check and code != 0:
        raise SystemExit(f"命令失败（exit {code}）: {cmd}")
    return out, code


def upload_dir(c, stage):
    """把本地 dist/ 上传到远端 stage 目录。"""
    sftp = c.open_sftp()

    def ensure(path):
        try:
            sftp.stat(path)
        except IOError:
            parent = posixpath.dirname(path)
            if parent and parent != "/":
                ensure(parent)
            sftp.mkdir(path)

    ensure(stage)
    count = 0
    for dirpath, _dirnames, filenames in os.walk(DIST):
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, DIST).replace(os.sep, "/")
            remote = posixpath.join(stage, rel)
            ensure(posixpath.dirname(remote))
            sftp.put(full, remote)
            count += 1
            print(f"  ↑ {rel}")

    sftp.close()
    print(f"  -> 已上传 {count} 个文件到 {stage}")


def deploy_upload(c):
    print("\n== 1/3 上传前端产物 ==")
    ts = time.strftime("%Y%m%d-%H%M%S")
    stage = f"{REMOTE_ROOT}/release-{ts}"

    run(c, f"sudo -n mkdir -p {REMOTE_ROOT} && sudo -n chown -R {USER}:{USER} {REMOTE_ROOT}", check=True)
    upload_dir(c, stage)

    # 原子切换：current → 新 release，旧 current 存为 previous
    run(c, f"rm -rf {REMOTE_PREV} && "
           f"if [ -d {REMOTE_CURRENT} ] || [ -L {REMOTE_CURRENT} ]; then "
           f"  cp -a {REMOTE_CURRENT} {REMOTE_PREV} 2>/dev/null || true; fi")
    run(c, f"ln -sfn {stage} {REMOTE_CURRENT}", check=True)

    # 只保留最近 3 个 release，避免磁盘堆积
    run(c, f"ls -1dt {REMOTE_ROOT}/release-* 2>/dev/null | tail -n +4 | xargs -r rm -rf")

    run(c, f"ls -la {REMOTE_ROOT}/")
    run(c, f"cat {REMOTE_CURRENT}/index.html")


def deploy_nginx(c):
    print("\n== 2/3 配置 nginx ==")

    # 备份当前配置
    ts = time.strftime("%Y%m%d-%H%M%S")
    run(c, f"sudo -n cp {NGINX_SITE} /tmp/ai.vutu.cc.conf.bak-{ts}", check=True)

    # 幂等：已存在 /studio/ 就跳过插入
    out, _ = run(c, f"grep -c 'location /studio/' {NGINX_SITE} || true")
    if out.strip().isdigit() and int(out.strip()) > 0:
        print("  -> /studio/ 已存在，跳过插入")
    else:
        # 用 python 在 `location /api/` 前插入片段（避免 sed 转义地狱）
        snippet_path = "/tmp/studio-snippet.conf"
        sftp = c.open_sftp()
        with sftp.file(snippet_path, "w") as f:
            f.write(NGINX_SNIPPET)
        sftp.close()

        py = (
            "import io\n"
            f"p={NGINX_SITE!r}\n"
            f"s=open({snippet_path!r}).read()\n"
            "t=open(p).read()\n"
            "m='  # ---------------- Vutu 后端 API ----------------'\n"
            "i=t.find(m)\n"
            "assert i>0, 'anchor not found'\n"
            "t2=t[:i]+s.strip('\\n')+'\\n\\n'+t[i:]\n"
            "open(p,'w').write(t2)\n"
            "print('inserted')\n"
        )
        run(c, f"sudo -n python3 -c {chr(34)}{py}{chr(34)}", check=True)

    # 校验 + reload；失败回滚
    out, code = run(c, "sudo -n nginx -t 2>&1")
    if code != 0:
        print("  !! nginx -t 失败，回滚配置")
        run(c, f"sudo -n cp /tmp/ai.vutu.cc.conf.bak-{ts} {NGINX_SITE}")
        raise SystemExit("nginx 配置校验失败，已回滚，未 reload")

    print("  -> nginx -t 通过")
    run(c, "sudo -n systemctl reload nginx", check=True)
    print("  -> nginx 已 reload")


def verify(c):
    print("\n== 3/3 验证 ==")
    run(c, "curl -s -m 10 -o /dev/null -w 'studio page  -> %{http_code}\\n' https://ai.vutu.cc/studio/")
    run(c, "curl -s -m 10 -o /dev/null -w 'studio asset -> %{http_code}\\n' "
           "$(curl -s https://ai.vutu.cc/studio/ | grep -o '/studio/assets/[^\"]*\\.js' | head -1 | "
           "sed 's|^|https://ai.vutu.cc|')")
    run(c, "curl -s -m 10 -o /dev/null -w 'api health   -> %{http_code}\\n' https://ai.vutu.cc/api/v1/health")
    run(c, "curl -s -m 10 https://ai.vutu.cc/api/v1/health")
    run(c, "curl -s -m 10 -o /dev/null -w 'root (unchanged) -> %{http_code}\\n' https://ai.vutu.cc/")


def rollback(c):
    print("\n== 回滚前端 ==")
    run(c, f"test -d {REMOTE_PREV} && echo 'previous 存在' || echo 'previous 不存在'")
    run(c, f"rm -rf {REMOTE_ROOT}/broken && mv {REMOTE_CURRENT} {REMOTE_ROOT}/broken && "
           f"mv {REMOTE_PREV} {REMOTE_CURRENT}", check=True)
    run(c, "curl -s -m 10 -o /dev/null -w 'studio page -> %{http_code}\\n' https://ai.vutu.cc/studio/")


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "all"
    c = connect()
    try:
        if action in ("upload", "all"):
            deploy_upload(c)
        if action in ("nginx", "all"):
            deploy_nginx(c)
        if action in ("all", "verify"):
            verify(c)
        if action == "rollback":
            rollback(c)
    finally:
        c.close()
    print("\n[完成]")


if __name__ == "__main__":
    main()
