import re

html = open(r'C:\Users\y2ksk\AppData\Local\Temp\deevid-home.html', encoding='utf-8').read()

qs = ['DeeVid 2.0', '自訂影片輸出', '免費試用', '開始使用', '商業用途']
for q in qs:
    i = html.find(q)
    if i < 0:
        print('NOT FOUND:', q)
        continue
    seg = html[i:i + 2500]
    texts = re.findall(r'>([^<>]{30,600})<', seg)
    print(f'=== {q} ===')
    for t in texts[1:4]:
        print('-', t[:220])
