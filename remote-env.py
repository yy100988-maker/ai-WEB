"""在远端 .env 中确保某个 KEY=value 存在（不存在则追加）。

用法：python remote-env.py KEY=VALUE [KEY2=VALUE2 ...]
"""

import sys
import paramiko

HOST = '13.229.183.21'
KEY = r'D:\文档\亚马逊\126.pem'
USER = 'ubuntu'
ENV_PATH = '/opt/vutu-backend/.env'


def main():
    pairs = {}
    for arg in sys.argv[1:]:
        k, _, v = arg.partition('=')
        if k:
            pairs[k] = v

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=22, username=USER, key_filename=KEY,
              timeout=20, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    with sftp.file(ENV_PATH, 'r') as f:
        content = f.read().decode('utf-8')
    sftp.close()

    lines = content.split('\n')
    remaining = dict(pairs)
    out = []
    for line in lines:
        key = line.split('=', 1)[0].strip()
        if key in remaining:
            out.append(f"{key}={remaining.pop(key)}")
        else:
            out.append(line)

    for k, v in remaining.items():
        out.append(f"{k}={v}")

    new_content = '\n'.join(out)
    if not new_content.endswith('\n'):
        new_content += '\n'

    sftp = c.open_sftp()
    with sftp.file(ENV_PATH, 'w') as f:
        f.write(new_content)
    sftp.chmod(ENV_PATH, 0o600)
    sftp.close()

    i, o, e = c.exec_command(f'grep -E "MOCK_|PG_PASSWORD" {ENV_PATH}')
    print(o.read().decode())
    err = e.read().decode()
    if err.strip():
        print('ERR:', err)
    c.close()
    print('updated', len(pairs), 'keys')


if __name__ == '__main__':
    main()
