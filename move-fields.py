import io
import os
import re

BASE = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu'
FILES = [os.path.join(BASE, 'site-data.ts')] + [
    os.path.join(BASE, 'locales', f) for f in os.listdir(os.path.join(BASE, 'locales'))
]

FIELDS = ['recordTitle', 'filterAll', 'filterVideo', 'filterImage', 'filterAudio',
          'imageLead', 'imageHero', 'imageComposerPh', 'modelLabel']

for p in FILES:
    if not p.endswith('.ts'):
        continue
    s = io.open(p, encoding='utf-8').read()
    moved = []
    for f in FIELDS:
        pat = re.compile(r'\n    %s: "[^"]*",' % f)
        m = pat.search(s)
        if m:
            moved.append(m.group(0).strip())
            s = pat.sub('', s, count=1)
    if not moved:
        continue
    # insert at top level: right before the closing of the dictionary object.
    # Anchor: the line '  supBody: "..."' is inside app; instead anchor on app block end.
    anchor = re.compile(r'(  app: \{.*?\n  \},\n)', re.S)
    am = anchor.search(s)
    if not am:
        # site-data.ts has two dicts; append fields before '};' of each dictionary
        print('  no app anchor in', os.path.basename(p))
        continue
    block = ''.join('\n  %s,' % f for f in moved)
    s = s[:am.end()] + block + s[am.end():]
    # de-dup: app block ends with '  },'
    io.open(p, 'w', encoding='utf-8').write(s)
    print('moved in', os.path.basename(p), len(moved))
