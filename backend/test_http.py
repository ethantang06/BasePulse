import urllib.request
import urllib.error
import json

req = urllib.request.Request(
    "http://127.0.0.1:8000/generate",
    data=json.dumps({"prompt": "Make a base"}).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(req) as res:
        print("Success:", res.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP Error:", e.code)
    print("Response Body:", e.read().decode())
except Exception as e:
    print("Other Error:", e)
