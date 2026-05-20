import json
import urllib.request

url = "http://127.0.0.1:8080/config"

with urllib.request.urlopen(url, timeout=10) as r:
    data = json.loads(r.read().decode("utf-8"))

named = []
for dep in data.get("dependencies", []):
    api_name = dep.get("api_name")
    if api_name:
        named.append({
            "id": dep.get("id"),
            "api_name": api_name,
            "inputs": dep.get("inputs", []),
            "outputs": dep.get("outputs", []),
        })

print(json.dumps(named, indent=2))
