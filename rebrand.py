import os
import shutil

ROOT = r'D:\CODEX\WEB\ai-cloner\src'
PUB = r'D:\CODEX\WEB\ai-cloner\public\sites'

# 1. rename directories
shutil.move(os.path.join(ROOT, 'components', 'sites', 'deevid'),
            os.path.join(ROOT, 'components', 'sites', 'vutu'))
shutil.move(os.path.join(PUB, 'deevid'), os.path.join(PUB, 'vutu'))
print('dirs renamed')

# 2. text replacements in src
count = 0
for dirpath, _, filenames in os.walk(ROOT):
    for fn in filenames:
        if not fn.endswith(('.ts', '.tsx')):
            continue
        p = os.path.join(dirpath, fn)
        with open(p, encoding='utf-8') as f:
            t = f.read()
        orig = t
        t = t.replace('sites/deevid', 'sites/vutu')
        t = t.replace('/sites/deevid/', '/sites/vutu/')
        t = t.replace('deevid.ai', 'ai.vutu.cc')
        t = t.replace('DeeVid', 'Vutu')
        t = t.replace('Deevid', 'Vutu')
        t = t.replace('前垔', '復刻')
        if t != orig:
            with open(p, 'w', encoding='utf-8') as f:
                f.write(t)
            count += 1
print(f'files updated: {count}')
