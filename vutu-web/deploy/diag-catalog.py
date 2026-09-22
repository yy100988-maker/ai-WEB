"""诊断 /v1/catalog/models/:id 返回 500 的原因（只读）。"""
import sys

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("13.250.182.43", 22, "ubuntu",
          key_filename=r"D:\文档\亚马逊\APP.pem",
          timeout=25, allow_agent=False, look_for_keys=False)


def run(cmd, timeout=120):
    i, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    print(f"\n$ {cmd}")
    if out.strip():
        print(out.rstrip()[:3500])
    if err.strip():
        print("[stderr]", err.rstrip()[:800])


run("curl -s -m 10 -o /dev/null -w 'list   -> %{http_code}\\n' https://ai.vutu.cc/api/v1/catalog/models")
run("curl -s -m 10 https://ai.vutu.cc/api/v1/catalog/models | head -c 1200")
print("\n" + "=" * 70)
run("curl -s -m 10 -i https://ai.vutu.cc/api/v1/catalog/models/demo-tt-image-2 2>&1 | head -25")
print("\n" + "=" * 70)
run("docker logs vutu-api --tail 60 2>&1 | grep -iE 'error|catalog|prisma|exception' | tail -25")

c.close()
