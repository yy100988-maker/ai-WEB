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

def harvest(s):
    vals = {}
    for f in FIELDS:
        m = re.search(r'^\s*%s: "([^"]*)",*,?\s*$' % f, s, re.M)
        if m:
            vals[f] = m.group(1)
    return vals

for p in FILES:
    s = io.open(p, encoding='utf-8').read()
    vals = harvest(s)
    if not vals:
        print('SKIP (no values):', os.path.basename(p))
        continue

    # 1. strip every occurrence of these fields (both correct and double-comma forms)
    for f in FIELDS:
        s = re.sub(r'^\s*%s: "[^"]*",*,?\n' % f, '', s, flags=re.M)
    s = re.sub(r',\s*,(\s*\})', r',\1', s)
    s = s.replace(',,};', '};').replace(',,\n', ',\n')

    # 2. insert after each app block close, at dictionary level
    def repl(m):
        body = m.group(0)
        tail = body[:-1]  # drop the trailing newline
        add = ''.join('\n  %s: "%s",' % (f, vals[f]) for f in FIELDS if f in vals)
        return tail + add + '\n'

    s2, n = re.subn(r'  app: \{\n(?:.*?\n)*?  \},\n', repl, s)
    io.open(p, 'w', encoding='utf-8').write(s2)
    print(os.path.basename(p), 'app blocks fixed:', n, '| fields:', len(vals))
