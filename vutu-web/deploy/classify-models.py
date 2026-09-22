"""用详情接口的 capability 字段确定每个模型类型，生成静态映射供前端使用。"""
import json
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://ai.vutu.cc/api/v1"


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=20) as r:
        return json.loads(r.read().decode())


models = get("/catalog/models")["data"]
print(f"共 {len(models)} 个模型\n")

image_models = []
for m in models:
    mid = m["id"]
    try:
        d = get(f"/catalog/models/{mid}")["data"]
        cap = d.get("capability", "?")
        kind = d.get("capabilityKind", "?")
        caps = d.get("capabilities") or []
        nprice = len(d.get("pricing") or [])
        print(f"{m['displayName']:<20} capability={cap:<16} kind={kind:<8} "
              f"caps={','.join(caps):<34} prices={nprice}")
        if kind == "image":
            image_models.append({
                "id": mid,
                "displayName": m["displayName"],
                "code": d.get("code"),
                "capabilities": caps,
            })
    except Exception as e:  # noqa: BLE001
        print(f"{m['displayName']:<20} ERROR {e}")

print(f"\n=> 图片类模型 {len(image_models)} 个：")
for m in image_models:
    print(f"   {m['displayName']}  ({m['code']})")

with open("deploy/image-models.json", "w", encoding="utf-8") as f:
    json.dump(image_models, f, ensure_ascii=False, indent=2)
print("\n已写入 deploy/image-models.json")
