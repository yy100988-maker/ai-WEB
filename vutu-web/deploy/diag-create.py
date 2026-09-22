"""复现「点 Create 不生成」：直接打 /v1/tasks 看后端到底回什么。

未登录时预期 401 UNAUTHORIZED → 前端应弹登录框。
若返回其它错误码（如上一轮发现的 409 MODEL_UNAVAILABLE），
说明前端把参数发错了，任务根本没进队列。
"""
import json
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
B = "https://ai.vutu.cc/api/v1"


def post(path, body, headers=None):
    h = {"Content-Type": "application/json", "User-Agent": "diag"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(B + path, data=json.dumps(body).encode(),
                                headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:300]


# 取图片模型详情，复刻前端实际会发的 body
with urllib.request.urlopen(B + "/catalog/models", timeout=20) as r:
    models = json.loads(r.read().decode())["data"]

img = None
for m in models:
    with urllib.request.urlopen(f"{B}/catalog/models/{m['id']}", timeout=20) as r:
        d = json.loads(r.read().decode())["data"]
    if d.get("capabilityKind") == "image":
        img = d
        break

print(f"模型: {img['displayName']} ({img['id']})")

# 前端 params 构造：resolution/size/quality/version/background 只在有值时带上
# 截图默认：比例=auto, 分辨率=1K, 画质=auto
body = {
    "capability": "text_to_image",
    "modelId": img["id"],
    "prompt": "生成一个小猫照片",
    "params": {"resolution": "1K", "aspectRatio": "auto", "quality": "auto"},
}
print("\n--- 未登录直接 POST /v1/tasks（复刻前端首次点击）---")
st, resp = post("/tasks", body, {"Idempotency-Key": "diag_0000000000000001"})
print(f"status={st}")
print(json.dumps(resp, ensure_ascii=False, indent=2)[:700] if isinstance(resp, dict) else resp)

print("\n--- 对照：/v1/auth/me ---")
try:
    with urllib.request.urlopen(B + "/auth/me", timeout=20) as r:
        print(r.status, r.read().decode()[:200])
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode()[:200])
