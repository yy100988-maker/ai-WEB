"""确认 catalog 列表里图片模型的真实 id，并复现 :id 500 的边界（只读）。"""
import json
import sys
import urllib.request

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://ai.vutu.cc/api/v1"


def get(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "diag"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:300]


st, body = get("/catalog/models")
print(f"GET /catalog/models -> {st}")
if st == 200:
    items = body.get("data", [])
    print(f"共 {len(items)} 个模型\n")
    for m in items:
        caps = m.get("capabilities") or []
        print(f"  {m['displayName']:<22} id={m['id'][:8]}… caps={caps}")

    img = [m for m in items if any(c in ("text_to_image", "image_to_image") for c in (m.get("capabilities") or []))]
    print(f"\n图片类模型 {len(img)} 个")
    if img:
        mid = img[0]["id"]
        st2, b2 = get(f"/catalog/models/{mid}")
        print(f"\nGET /catalog/models/<真实UUID> -> {st2}")
        print(json.dumps(b2, ensure_ascii=False)[:900] if st2 == 200 else b2)

print("\n--- 边界：非 UUID 的 id（应 404，实际 500 = Bug）---")
st3, b3 = get("/catalog/models/demo-tt-image-2")
print(f"GET /catalog/models/demo-tt-image-2 -> {st3}")
print(str(b3)[:200])

print("\n--- 边界：合法 UUID 但不存在 ---")
st4, b4 = get("/catalog/models/00000000-0000-0000-0000-000000000000")
print(f"GET /catalog/models/<不存在UUID> -> {st4}")
print(str(b4)[:200])
