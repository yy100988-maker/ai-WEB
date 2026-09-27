import os

BASE = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu'
MAIN = os.path.join(BASE, 'site-data.ts')
LOCDIR = os.path.join(BASE, 'locales')

FAQ_CLEAN = {
    'zh-CN': [
        ('，本站演示版提供同款操作面板的静态还原。', '。'),
        ('。本站为前端复刻，生成流程为本地模拟，不会真的调用后端。', '。'),
        ('。本复刻站仅供学习研究，不提供任何生成服务。', '。'),
    ],
    'ja': [
        ('このデモはローカル模拟のみです。', ''),
        ('このサイトは生成サービスを提供しません。', '詳しくは公式の利用規約をご確認ください。'),
    ],
    'ko': [
        ('이 데모는 로컬 시뮬레이션입니다.', ''),
        ('이 사이트는 생성 서비스를 제공하지 않습니다.', '자세한 내용은 공식 이용약관을 확인하세요.'),
    ],
    'es': [
        ('Esta demo solo simula en local.', ''),
        ('Este sitio no genera nada real.', 'Consulta los términos oficiales.'),
    ],
    'fr': [
        ('Démo locale uniquement.', ''),
        ('Ce site ne génère rien.', 'Voir les conditions officielles.'),
    ],
    'de': [
        ('Diese Demo simuliert nur lokal.', ''),
        ('Diese Seite generiert nichts.', 'Siehe offizielle Bedingungen.'),
    ],
    'it': [
        ('Solo demo locale.', ''),
        ('Questo sito non genera nulla.', 'Vedi i termini ufficiali.'),
    ],
    'pt': [
        ('Só demo local.', ''),
        ('Este site não gera nada.', 'Ver os termos oficiais.'),
    ],
    'ru': [
        ('Это только локальное демо.', ''),
        ('Этот сайт ничего не генерирует.', 'См. официальные условия.'),
    ],
}

SHORT = {
    'zh-CN': '描述你想要的影片…',
    'ja': '作りたい動画を記述…',
    'ko': '원하는 영상을 서술…',
    'es': 'Describe tu vídeo…',
    'fr': 'Décris ta vidéo…',
    'de': 'Video beschreiben…',
    'it': 'Descrivi il video…',
    'pt': 'Descreva seu vídeo…',
    'ru': 'Опишите видео…',
}

with open(MAIN, encoding='utf-8') as f:
    t = f.read()
t = t.replace('  dur5: string;\n  dur10: string;',
              '  dur5: string;\n  dur10: string;\n  composerShort: string;')
t = t.replace('''  dur5: "5秒",
  dur10: "10秒",''', '''  dur5: "5秒",
  dur10: "10秒",
  composerShort: "描述你想要的影片…",''')
t = t.replace('''  dur5: "5s",
  dur10: "10s",''', '''  dur5: "5s",
  dur10: "10s",
  composerShort: "Describe your video…",''')
with open(MAIN, 'w', encoding='utf-8') as f:
    f.write(t)
print('main composerShort done')

for loc, pairs in FAQ_CLEAN.items():
    p = os.path.join(LOCDIR, loc + '.ts')
    with open(p, encoding='utf-8') as f:
        s = f.read()
    for a, b in pairs:
        assert a in s, (loc, a[:30])
        s = s.replace(a, b)
    anchor = 'dur10: "'
    idx = s.find(anchor)
    assert idx > 0, loc
    end = s.find('",', idx)
    short = SHORT[loc]
    s = s[:end + 2] + '\n  composerShort: "%s",' % short + s[end + 2:]
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)
    print('cleaned:', loc)
