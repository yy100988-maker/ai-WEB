import sys
sys.path.insert(0, r'D:\CODEX\WEB')
import paramiko

HOST = '13.229.183.21'
KEY = r'D:\文档\亚马逊\126.pem'
USER = 'ubuntu'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, port=22, username=USER, key_filename=KEY, timeout=15,
          allow_agent=False, look_for_keys=False)

cmd = (
    "grep -c 'prompt-library' /home/ubuntu/apps/ai-WEB/ai-cloner/.next/server/app/zh-TW/index.html; "
    "grep -c 'clipboard' /home/ubuntu/apps/ai-WEB/ai-cloner/.next/server/app/zh-TW/index.html; "
    "grep -c 'navigator' /home/ubuntu/apps/ai-WEB/ai-cloner/.next/server/app/zh-TW/index.html; "
    "grep -c 'alert' /home/ubuntu/apps/ai-WEB/ai-cloner/.next/server/app/zh-TW/index.html"
)
stdin, stdout, stderr = c.exec_command(cmd, timeout=30)
sys.stdout.reconfigure(encoding='utf-8', errors='backslashreplace')
print(stdout.read().decode(errors='replace'))
c.close()
