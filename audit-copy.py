import io
import re
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0'}
PAGES = [
    ('zh-TW', '/zh-TW/text-to-video'),
    ('zh-CN', '/zh-CN/text-to-video'),
    ('ja', '/ja/text-to-video'),
    ('ko', '/ko/text-to-video'),
    ('ru', '/ru/text-to-video'),
    ('de', '/de/text-to-video'),
]

BAD = [
    '\u524d\u7aef\u5fa9\u523b', '\u524d\u7aef\u590d\u523b',  # 前端復刻 / 前端复刻
    '\u6f14\u793a\u7248',                                     # 演示版
    '\u672c\u5730\u6a21\u64ec', '\u672c\u5730\u6a21\u62df',   # 本地模擬 / 本地模拟
    'Front-end replica', 'front-end replica', 'Study-only', 'study-only',
    '\u30d5\u30ed\u30f3\u30c8\u30a8\u30f3\u30c9\u518d\u73fe', # フロントエンド再現
    'Nachbau', 'R\u00e9plica frontal', 'Replica frontale',
    '\u041d\u0435\u043e\u0444\u0438\u0446\u0438\u0430\u043b\u044c\u043d\u044b\u0439',
]

for code, path in PAGES:
    url = 'https://ai.vutu.cc' + path
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            h = r.read().decode('utf-8', errors='replace')
        hits = [b for b in BAD if b in h]
        print(f'{code}: {"CLEAN" if not hits else "STALE " + str(hits)}')
    except Exception as e:
        print(f'{code}: ERROR {str(e)[:60]}')
