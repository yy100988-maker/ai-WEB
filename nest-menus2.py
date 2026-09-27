import io
import os
import re

BASE = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu'
FILES = [os.path.join(BASE, 'site-data.ts')] + [
    os.path.join(BASE, 'locales', f)
    for f in sorted(os.listdir(os.path.join(BASE, 'locales')))
    if f.endswith('.ts')
]

pat = re.compile(r'  menus2: \[\n(.*?)\n  \],\n', re.S)
entry_pat = re.compile(r'\{\s*head: .*?\n\s*\]\s*\},', re.S)

for p in FILES:
    s = io.open(p, encoding='utf-8').read()
    m = pat.search(s)
    if not m:
        print('skip', os.path.basename(p))
        continue
    body = m.group(1)
    entries = entry_pat.findall(body)
    if not entries:
        print('no entries', os.path.basename(p))
        continue
    nested = []
    for e in entries:
        indented = '\n'.join('  ' + ln if ln.strip() else ln for ln in e.split('\n'))
        nested.append('    [\n' + indented + '\n    ],')
    new_body = '  menus2: [\n' + '\n'.join(nested) + '\n  ],\n'
    s = s[:m.start()] + new_body + s[m.end():]
    io.open(p, 'w', encoding='utf-8').write(s)
    print('nested', os.path.basename(p), len(entries))
