"""把 ai-cloner/ 的源码同步到远端前端目录（只同步源文件，不碰 node_modules/.next）。

用法：
    python sync-frontend.py            # 增量同步 src/public 等源码
    python sync-frontend.py --check    # 只打印差异，不上传
"""

import os
import sys
import posixpath
import paramiko
import hashlib

HOST = '13.229.183.21'
KEY = r'D:\文档\亚马逊\126.pem'
USER = 'ubuntu'
REMOTE_DIR = '/home/ubuntu/apps/ai-WEB/ai-cloner'
LOCAL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ai-cloner')

# 同步的顶层条目（源码 + 构建配置，不含依赖与构建产物）
SYNC_ENTRIES = {'src', 'public', 'package.json', 'package-lock.json',
                'next.config.ts', 'tsconfig.json', 'postcss.config.mjs',
                'components.json', 'eslint.config.mjs'}
EXCLUDE_DIRS = {'node_modules', '.next', '.git'}


def md5(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def iter_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root).replace(os.sep, '/')
            top = rel.split('/')[0]
            if top in SYNC_ENTRIES:
                yield full, rel


def main():
    check = '--check' in sys.argv

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=22, username=USER, key_filename=KEY,
              timeout=20, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()

    def ensure(path):
        try:
            sftp.stat(path)
        except IOError:
            parent = posixpath.dirname(path)
            if parent and parent != '/':
                ensure(parent)
            sftp.mkdir(path)

    diff, same = [], []
    for full, rel in iter_files(LOCAL_DIR):
        remote = posixpath.join(REMOTE_DIR, rel)
        try:
            with sftp.file(remote, 'r') as f:
                rhash = hashlib.md5(f.read()).hexdigest()
            if rhash == md5(full):
                same.append(rel)
                continue
        except IOError:
            pass
        diff.append(rel)
        if not check:
            ensure(posixpath.dirname(remote))
            sftp.put(full, remote)

    sftp.close()
    c.close()
    print(f'{"would upload" if check else "uploaded"}={len(diff)} unchanged={len(same)}')
    for rel in diff[:30]:
        print('  *', rel)
    if len(diff) > 30:
        print(f'  ... and {len(diff) - 30} more')


if __name__ == '__main__':
    main()
