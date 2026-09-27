import io
import re

h = io.open(r'C:\Users\y2ksk\AppData\Local\Temp\live-zhcn-t2v.html', encoding='utf-8').read()
m = re.findall(r'placeholder="([^"]*)"', h)
got = m[0] if m else ''
print('codepoints:', [hex(ord(c)) for c in got])
print('len:', len(got))
# render as escaped ascii for safe console output
print('escaped:', got.encode('unicode_escape').decode('ascii'))
