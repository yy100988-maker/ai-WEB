import urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
for prefix in ['ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'zh-CN', 'zh-TW', 'en']:
    url = f'https://deevid.ai/{prefix}'
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            final = r.geturl()
            print(f'{prefix}: {r.status} -> {final}')
    except Exception as e:
        print(f'{prefix}: FAIL {str(e)[:100]}')
