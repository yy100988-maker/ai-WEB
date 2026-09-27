"""把 server/ 目录同步到远端服务器（排除 node_modules/dist/.env）。

用法：
    python sync-server.py            # 同步代码
    python sync-server.py --with-env # 同时上传本地 .env（首次部署用）
"""

import os
import sys
import posixpath
import paramiko

HOST = '13.250.182.43'
KEY = r'D:\文档\亚马逊\APP.pem'
USER = 'ubuntu'
REMOTE_DIR = '/opt/vutu-backend'
LOCAL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'server')

EXCLUDE_DIRS = {'node_modules', 'dist', '.git', 'coverage', '.next', 'backup'}
EXCLUDE_FILES = {'.env', '.env.local'}
# 始终排除，即使 --with-env（测试产物）
ALWAYS_EXCLUDE = {'.env.local'}


def iter_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root).replace(os.sep, '/')
            yield full, rel


def main():
    with_env = '--with-env' in sys.argv

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=22, username=USER, key_filename=KEY,
              timeout=20, allow_agent=False, look_for_keys=False)

    sftp = c.open_sftp()

    # 确保远端目录存在
    def ensure(path):
        try:
            sftp.stat(path)
        except IOError:
            parent = posixpath.dirname(path)
            if parent and parent != '/':
                ensure(parent)
            sftp.mkdir(path)

    ensure(REMOTE_DIR)

    uploaded = 0
    skipped = 0
    for full, rel in iter_files(LOCAL_DIR):
        base = os.path.basename(rel)
        if base in ALWAYS_EXCLUDE:
            skipped += 1
            continue
        if base in EXCLUDE_FILES and not with_env:
            skipped += 1
            continue

        remote = posixpath.join(REMOTE_DIR, rel)
        ensure(posixpath.dirname(remote))

        # 本地 mtime 与远端一致则跳过（增量同步）
        try:
            rstat = sftp.stat(remote)
            lstat = os.stat(full)
            if abs(rstat.st_mtime - lstat.st_mtime) < 1 and rstat.st_size == lstat.st_size:
                skipped += 1
                continue
        except IOError:
            pass

        sftp.put(full, remote)
        uploaded += 1

    sftp.close()
    c.close()
    print(f'uploaded={uploaded} skipped={skipped} -> {REMOTE_DIR}')


if __name__ == '__main__':
    main()
