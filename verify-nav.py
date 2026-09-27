import io
import re
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0'}
checks = [
    ('zh-CN home nav-dropdown', 'https://ai.vutu.cc/zh-CN', ['AI 影片', 'AI 圖像', '畫布']),
    ('zh-CN app record', 'https://ai.vutu.cc/zh-CN/app', ['AI 视频', 'AI 图像', '模型']),
    ('zh-TW app', 'https://ai.vutu.cc/zh-TW/app', ['創作紀錄', 'AI 圖像']),
    ('ja app', 'https://ai.vutu.cc/ja/app', ['AI 画像']),
]

for name, url, needles in checks:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            h = r.read().decode('utf-8', errors='replace')
        res = {n: (n in h) for n in needles}
        print(f'{name}: {res}')
    except Exception as e:
        print(f'{name}: ERROR {str(e)[:70]}')
