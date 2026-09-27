"""验证image生成能力与报价。"""
import json
import urllib.request

BASE = 'https://ai.vutu.cc/api/v1'

# 检查 image 模型
req = urllib.request.Request(f'{BASE}/catalog/models?capability=text_to_image')
with urllib.request.urlopen(req, timeout=30) as r:
    d = json.loads(r.read().decode())
    models = d['data']
    print(f'text_to_image models: {len(models)}')
    for m in models:
        print(f'  {m["id"][:12]}  displayName={m["displayName"]}  res={m.get("resolutions",[])}')

# 检查 quote (tt-image-2)
for mid in ['tt-image-2', 'tt-image-2.5']:
    for spec, label in [({"size":"1024x1024"}, "1024x1024"), ({"size":"2048x2048"}, "2048x2048"), ({"size":"4096x4096"}, "4096x4096")]:
        body = json.dumps({"capability":"text_to_image","modelId":mid,"params":spec}).encode()
        req = urllib.request.Request(f'{BASE}/pricing/quote', data=body, headers={'content-type':'application/json'})
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read().decode())
            print(f'{mid} {label}: credits={d["data"]["credits"]}')
