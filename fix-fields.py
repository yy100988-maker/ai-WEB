import io
import os
import re

BASE = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu'
FILES = [os.path.join(BASE, 'site-data.ts')] + [
    os.path.join(BASE, 'locales', f)
    for f in sorted(os.listdir(os.path.join(BASE, 'locales')))
    if f.endswith('.ts')
]

FIELDS = ['recordTitle', 'filterAll', 'filterVideo', 'filterImage', 'filterAudio',
          'imageLead', 'imageHero', 'imageComposerPh', 'modelLabel']

for p in FILES:
    s = io.open(p, encoding='utf-8').read()
    # 1. remove the wrongly inserted trailing block (with double commas)
    pat = re.compile(r'\n(?:  %s: "[^"]*",,?\n)+' % '|'.join(FIELDS).replace('|', '|'))
    # simpler: remove any line '  field: "...",,' at file scope
    for f in FIELDS:
        s = re.sub(r'\n  %s: "[^"]*",,' % f, '', s)
    s = s.replace(',,};', '};')

    # 2. find each app block end and insert fields AFTER it, at dictionary level
    out = []
    idx = 0
    inserted = 0
    while True:
        m = re.compile(r'(  app: \{\n(?:.*?\n)*?  \},\n)').search(s, idx)
        if not m:
            break
        out.append(s[idx:m.end()])
        block = ''.join('  %s: "%s",\n' % (f, '__PLACEHOLDER__') for f in FIELDS)
        # take values from a stash if this dictionary already had them
        out.append(block)
        idx = m.end()
        inserted += 1
    out.append(s[idx:])
    s = ''.join(out)
    io.open(p, 'w', encoding='utf-8').write(s)
    print(os.path.basename(p), 'app blocks patched:', inserted)
