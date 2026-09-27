import io
import re

p = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu\site-data.ts'
s = io.open(p, encoding='utf-8').read()
i = s.find('const en: SiteDictionary')
head, tail = s[:i], s[i:]
for f in ['recordTitle', 'imageHero', 'modelLabel', 'filterAudio']:
    m = re.search(r'%s: "([^"]*)"' % f, tail)
    print(f, '=>', m.group(1) if m else 'MISSING')

# fix component: a.xxx -> dict.xxx for the record fields
cp = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu\AppHomePage.tsx'
c = io.open(cp, encoding='utf-8').read()
for f in ['recordTitle', 'filterAll', 'filterVideo', 'filterImage', 'filterAudio',
          'imageLead', 'imageHero', 'imageComposerPh', 'modelLabel']:
    c = c.replace('a.%s' % f, 'dict.%s' % f)
io.open(cp, 'w', encoding='utf-8').write(c)
print('component refs fixed')
