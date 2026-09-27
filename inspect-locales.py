import re

h = open(r'C:\Users\y2ksk\AppData\Local\Temp\deevid-en.html', encoding='utf-8').read()
tags = sorted(set(re.findall(r'hreflang="([^"]+)"', h)))
print('hreflang:', tags)
urls = sorted(set(re.findall(r'href="(https://deevid\.ai/[a-zA-Z-]+)"', h)))
print('prefixes:', urls[:40])
