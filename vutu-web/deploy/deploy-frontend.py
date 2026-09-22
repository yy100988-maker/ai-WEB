"""部署 vutu 前端优化到生产（13.250.182.43: /home/ubuntu/apps/deevid-clone）。

流程：
  1. 备份远端当前源码（AppHomePage.tsx）+ 记录当前 BUILD_ID（回滚锚点）
  2. SFTP 同步改动文件（md5 比对，只传变化的）
  3. 远端 npm run build（产物 .next）
  4. pm2 reload deevid（零停机重载）
  5. 验证 https://ai.vutu.cc/ 与目标页面 200

用法：
    python deploy/deploy-frontend.py            # 完整部署
    python deploy/deploy-frontend.py upload     # 仅同步源码
    python deploy/deploy-frontend.py build      # 仅远端构建
    python deploy/deploy-frontend.py reload     # 仅 pm2 reload
    python deploy/deploy-frontend.py rollback   # 还原上一份源码并重建
"""
import hashlib
import os
import posixpath
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "13.250.182.43"
KEY = r"D:\文档\亚马逊\APP.pem"
USER = "ubuntu"
LOCAL_ROOT = r"D:\CODEX\WEB\ai-cloner"
REMOTE_DIR = "/home/ubuntu/apps/deevid-clone"
BACKUP_DIR = "/home/ubuntu/apps/deevid-backups"

# 只同步本次改动涉及的文件（不整树覆盖，避免误伤远端独有改动）
SYNC_FILES = [
    "src/components/sites/vutu/AppHomePage.tsx",
]


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=22, username=USER, key_filename=KEY,
              timeout=25, allow_agent=False, look_for_keys=False)
    return c


def run(c, cmd, timeout=1800, check=False):
    i, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    code = o.channel.recv_exit_status()
    print(f"$ {cmd}")
    if out.strip():
        print(out.rstrip()[:4000])
    if err.strip():
        print("[stderr]", err.rstrip()[:2000])
    if check and code != 0:
        raise SystemExit(f"命令失败（exit {code}）")
    return out, code


def md5_local(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def do_upload(c):
    print("\n== 1/4 备份 + 同步源码 ==")
    ts = time.strftime("%Y%m%d-%H%M%S")

    run(c, f"mkdir -p {BACKUP_DIR}/{ts}", check=True)
    for rel in SYNC_FILES:
        remote = posixpath.join(REMOTE_DIR, rel)
        run(c, f"cp {remote} {BACKUP_DIR}/{ts}/{posixpath.basename(rel)} 2>/dev/null || true")
    with open(os.path.join(LOCAL_ROOT, "_last-backup.txt"), "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"  -> 已备份到 {BACKUP_DIR}/{ts}")

    sftp = c.open_sftp()
    changed = 0
    for rel in SYNC_FILES:
        local = os.path.join(LOCAL_ROOT, rel.replace("/", os.sep))
        remote = posixpath.join(REMOTE_DIR, rel)
        try:
            with sftp.file(remote, "r") as f:
                rhash = hashlib.md5(f.read()).hexdigest()
            if rhash == md5_local(local):
                print(f"  = 未变化 {rel}")
                continue
        except IOError:
            pass
        sftp.put(local, remote)
        print(f"  ↑ {rel}")
        changed += 1
    sftp.close()
    print(f"  -> 上传 {changed} 个文件")


def do_build(c):
    print("\n== 2/4 远端构建 ==")
    # 用 login shell 保证 node/npm 在 PATH（nvm 环境）
    run(c, f"cd {REMOTE_DIR} && bash -lc 'npm run build' 2>&1 | tail -25", timeout=2400, check=True)
    run(c, f"cat {REMOTE_DIR}/.next/BUILD_ID")


def do_reload(c):
    print("\n== 3/4 pm2 reload ==")
    run(c, "pm2 reload deevid 2>&1 | tail -8", check=True)
    run(c, "sleep 3; pm2 list 2>&1 | grep -E 'deevid|status' | head -4")


def do_verify(c):
    print("\n== 4/4 验证 ==")
    run(c, "curl -s -m 15 -o /dev/null -w 'root          -> %{http_code}\\n' https://ai.vutu.cc/")
    run(c, "curl -s -m 15 -o /dev/null -w 'zh-CN/app     -> %{http_code}\\n' https://ai.vutu.cc/zh-CN/app")
    run(c, "curl -s -m 15 -o /dev/null -w 'image view    -> %{http_code}\\n' 'https://ai.vutu.cc/zh-CN/app?tool=image'")
    # 确认新标记已上线
    out, _ = run(c, "curl -s -m 15 'https://ai.vutu.cc/zh-CN/app?tool=image' | grep -o '上传参考图' | head -1")
    print(f"  -> 新标记「上传参考图」出现次数：{'有' if out.strip() else '无'}")


def do_rollback(c):
    print("\n== 回滚 ==")
    try:
        with open(os.path.join(LOCAL_ROOT, "_last-backup.txt"), encoding="utf-8") as f:
            ts = f.read().strip()
    except FileNotFoundError:
        raise SystemExit("找不到 _last-backup.txt，无法确定回滚点")
    print(f"  回滚点：{BACKUP_DIR}/{ts}")
    for rel in SYNC_FILES:
        run(c, f"cp {BACKUP_DIR}/{ts}/{posixpath.basename(rel)} {REMOTE_DIR}/{rel}", check=True)
    do_build(c)
    do_reload(c)
    do_verify(c)


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "all"
    c = connect()
    try:
        if action in ("upload", "all"):
            do_upload(c)
        if action in ("build", "all"):
            do_build(c)
        if action in ("reload", "all"):
            do_reload(c)
        if action in ("verify", "all"):
            do_verify(c)
        if action == "rollback":
            do_rollback(c)
    finally:
        c.close()
    print("\n[完成]")


if __name__ == "__main__":
    main()
