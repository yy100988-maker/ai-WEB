import re

html = open(r'C:\Users\y2ksk\AppData\Local\Temp\deevid-home.html', encoding='utf-8').read()

want = ['Linda', 'Jesse', 'Lara', 'Mia'] + [f'模板 {n}' for n in range(1, 9)] + [
    'AI 廣告產生器', 'AI 圖片產生器', 'AI 虛擬分身', 'AI 音樂', '圖片轉影片', '文字轉語音']

seen = set()
for m in re.finditer(r'<img[^>]*>', html):
    tag = m.group(0)
    am = re.search(r'alt="([^"]+)"', tag)
    sm = re.search(r'src="([^"]+)"', tag)
    if am and sm and am.group(1) in want and am.group(1) not in seen:
        seen.add(am.group(1))
        print(f'{am.group(1)} :: {sm.group(1)}')
