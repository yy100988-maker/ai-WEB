import os
import urllib.request

base = r'D:\CODEX\WEB\ai-cloner\public\sites\deevid'
os.makedirs(base + r'\showcase', exist_ok=True)
os.makedirs(base + r'\avatars', exist_ok=True)
os.makedirs(base + r'\templates', exist_ok=True)

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

jobs = [
    (r'\showcase\show-1.mp4', 'https://cdn2.deevid.ai/user-video/v2_1776838700435-396634096.mp4'),
    (r'\showcase\show-2.mp4', 'https://cdn2.deevid.ai/user-video/v2_1776838934009-205212848.mp4'),
    (r'\showcase\show-3.mp4', 'https://cdn2.deevid.ai/user-video/v2_1776838548031-560798805.mp4'),
    (r'\avatars\linda.png', 'https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width=200/user-image/v2_1776752766469-310079426.png'),
    (r'\avatars\mia.png', 'https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width=200/user-image/v2_1776753130174-63271030.png'),
    (r'\avatars\jesse.png', 'https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width=200/user-image/v2_1776753168773-801501134.png'),
    (r'\avatars\lara.png', 'https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width=200/user-image/v2_1776753205474-720499570.png'),
    (r'\templates\tpl-1.png', 'https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width=520/user-image/v2_1776757597623-511061755.png'),
    (r'\templates\tpl-2.png', 'https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width=520/user-image/v2_1776755140980-919465703.png'),
    (r'\templates\tpl-3.jpg', 'https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width=520/user-image/v2_1776755998100-662925956.jpg'),
    (r'\templates\tpl-4.png', 'https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width=520/user-image/v2_1776756584094-938065460.png'),
    (r'\templates\tpl-5.png', 'https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width=520/user-image/v2_1776755308892-657723484.png'),
    (r'\templates\tpl-6.png', 'https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width=520/user-image/v2_1776755176626-29498404.png'),
    (r'\templates\tpl-7.png', 'https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width=520/user-image/v2_1776756607935-499119990.png'),
    (r'\templates\tpl-8.jpg', 'https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width=520/user-image/v2_1776759541472-52038524.jpg'),
]

ok = 0
for rel, url in jobs:
    dest = base + rel
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=90) as r, open(dest, 'wb') as f:
            f.write(r.read())
        size = os.path.getsize(dest)
        if size > 1024:
            ok += 1
        else:
            print('SMALL:', rel)
    except Exception as e:
        print('FAIL:', rel, str(e)[:120])

print(f'done ok={ok}/{len(jobs)}')
