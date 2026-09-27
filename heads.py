import io
import re

p = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu\site-data.ts'
s = io.open(p, encoding='utf-8').read()
m = re.search(r'  menus2: \[\n(.*?)\n  \],\n', s, re.S)
body = m.group(1)
for e in re.findall(r'\{ head: "([^"]+)"', body):
    print('HEAD:', e)
