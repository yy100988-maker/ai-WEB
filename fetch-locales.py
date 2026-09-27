import re
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
req = urllib.request.Request('https://deevid.ai/', headers=UA)
with urllib.request.urlopen(req, timeout=60) as r:
    h = r.read().decode('utf-8', errors='replace')

print('bytes:', len(h))
tags = sorted(set(re.findall(r'hreflang="([^"]+)"', h)))
print('hreflang:', tags)
aloc = sorted(set(re.findall(r'href="(https://deevid\.ai/[a-zA-Z-]+)"', h)))
print('prefixes:', aloc[:40])
