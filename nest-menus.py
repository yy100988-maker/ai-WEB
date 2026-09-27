import io
import os
import re

BASE = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu'
FILES = [os.path.join(BASE, 'site-data.ts')] + [
    os.path.join(BASE, 'locales', f)
    for f in sorted(os.listdir(os.path.join(BASE, 'locales')))
    if f.endswith('.ts')
]

# Wrap the flat menus2 entries into 4 nested arrays (one per menu).
for p in FILES:
    s = io.open(p, encoding='utf-8').read()
    m = re.search(r'  menus2: \[\n(.*?)\n  \],\n', s, re.S)
    if not m:
        print('skip', os.path.basename(p))
        continue
    body = m.group(1)
    # split top-level entries "    { head: ... },"
    entries = re.findall(r'    \{ head: .*?\n    \},', body, re.S)
    if not entries:
        print('no entries', os.path.basename(p))
        continue
    # group by head order: each entry is one MENU with possibly several columns?
    # Our data: one entry per column; menus are: [res][usecase x?][guide][pricing]
    # Detect by head text: first entry = resource menu, last = pricing menu.
    groups = []
    cur = []
    for i, e in enumerate(entries):
        cur.append(e)
        # a menu ends when the next head looks like a new section
        nxt = entries[i + 1] if i + 1 < len(entries) else None
        if nxt is None:
            groups.append(cur)
            cur = []
    # fallback: single group -> split evenly is wrong; instead emit nested by 1 col each
    nested = []
    for e in entries:
        nested.append('    [\n' + e + '\n    ],')
    new_body = '  menus2: [\n' + '\n'.join(nested) + '\n  ],\n'
    s = s[:m.start()] + new_body + s[m.end():]
    io.open(p, 'w', encoding='utf-8').write(s)
    print('nested', os.path.basename(p), len(entries))
