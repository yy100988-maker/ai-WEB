import os
import sys
import paramiko

HOST = '13.250.182.43'
KEY = r'D:\文档\亚马逊\APP.pem'
USER = 'ubuntu'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, port=22, username=USER, key_filename=KEY,
          timeout=15, allow_agent=False, look_for_keys=False)

TIMEOUT = int(os.environ.get('SSH_TIMEOUT', '120'))

cmd = ' && '.join(sys.argv[1:]) if len(sys.argv) > 1 else 'whoami'
stdin, stdout, stderr = c.exec_command(cmd, timeout=TIMEOUT)
out = stdout.read().decode(errors='replace')
err = stderr.read().decode(errors='replace')
sys.stdout.reconfigure(encoding='utf-8', errors='backslashreplace')
print(out, end='')
if err.strip():
    print('--- STDERR ---')
    print(err, end='')
c.close()
