import os
import re

BASE = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu'
MAIN = os.path.join(BASE, 'site-data.ts')
LOCDIR = os.path.join(BASE, 'locales')

TRIAL = {
    'zh-CN': '免费试用',
    'ja': '無料で試す',
    'ko': '무료 체험',
    'es': 'Prueba gratis',
    'fr': 'Essai gratuit',
    'de': 'Gratis testen',
    'it': 'Prova gratis',
    'pt': 'Teste grátis',
    'ru': 'Попробовать',
}

with open(MAIN, encoding='utf-8') as f:
    t = f.read()

t = t.replace(
    '  backV1: string;\n}',
    '  backV1: string;\n  trial: string;\n}')
t = t.replace(
    '    inspTitle: "靈感",\n    backV1: "Vutu 1.0",',
    '    inspTitle: "靈感",\n    backV1: "Vutu 1.0",\n    trial: "免費試用",')
t = t.replace(
    '    inspTitle: "Inspiration",\n    backV1: "Vutu 1.0",',
    '    inspTitle: "Inspiration",\n    backV1: "Vutu 1.0",\n    trial: "Free trial",')

with open(MAIN, 'w', encoding='utf-8') as f:
    f.write(t)

for loc, word in TRIAL.items():
    p = os.path.join(LOCDIR, loc + '.ts')
    with open(p, encoding='utf-8') as f:
        s = f.read()
    pat = re.compile(r'(    inspTitle: "[^"]*",\n    backV1: "Vutu 1\.0",)')
    s2, n = pat.subn(r'\1\n    trial: "%s",' % word, s, count=1)
    assert n == 1, loc
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s2)
    print('trial added:', loc)
