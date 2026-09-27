import os

APP = r'D:\CODEX\WEB\ai-cloner\src\app'

REPS = [
    ('Vutu AI 復刻 — ', 'Vutu AI — '),
    ('Vutu AI 复刻 — ', 'Vutu AI — '),
    ('Vutu AI Replica — ', 'Vutu AI — '),
    ('Réplica Vutu AI — ', 'Vutu AI — '),
    ('Réplique Vutu AI — ', 'Vutu AI — '),
    ('Replica Vutu AI — ', 'Vutu AI — '),
    ('Vutu AI 복제 — ', 'Vutu AI — '),
    ('Vutu AI Nachbau — ', 'Vutu AI — '),
    (' — Free AI Video Generator (study clone)',
     ' — Free AI Video Generator'),
    ('（學習研究）', ''),
    ('文字轉影片 AI｜Vutu 前端復刻', '文字轉影片 AI｜Vutu AI'),
    ('圖片轉影片｜Vutu 前端復刻', '圖片轉影片｜Vutu AI'),
    ('價格方案｜Vutu 前端復刻', '價格方案｜Vutu AI'),
    ('Vutu 工作台（演示）｜前端復刻', 'Vutu 工作台｜Vutu AI'),
]

n = 0
for dirpath, _, fns in os.walk(APP):
    for fn in fns:
        if not fn.endswith('.tsx'):
            continue
        p = os.path.join(dirpath, fn)
        with open(p, encoding='utf-8') as f:
            t = f.read()
        o = t
        for a, b in REPS:
            t = t.replace(a, b)
        if t != o:
            with open(p, 'w', encoding='utf-8') as f:
                f.write(t)
            n += 1
print('titles cleaned:', n)
