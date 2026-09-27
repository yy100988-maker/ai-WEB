import io
import os

BASE = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu'
FILES = [os.path.join(BASE, 'site-data.ts')] + [
    os.path.join(BASE, 'locales', f)
    for f in sorted(os.listdir(os.path.join(BASE, 'locales')))
    if f.endswith('.ts')
]

for p in FILES:
    lines = io.open(p, encoding='utf-8').read().split('\n')
    bad = [i + 1 for i, l in enumerate(lines) if l.endswith(',,')]
    apps = [i + 1 for i, l in enumerate(lines) if l.strip() == 'app: {']
    print(os.path.basename(p), 'double-comma lines:', bad, 'app blocks at:', apps)
