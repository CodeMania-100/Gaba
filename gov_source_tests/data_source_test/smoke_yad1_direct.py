import json
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup


URL = (
    "https://www.yad2.co.il/yad1/newprojects/south"
    "?area=21&category=1&city=7100"
)

headers = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/152.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
}

print("=" * 70)
print("YAD1 DIRECT TEST")
print("=" * 70)

response = requests.get(
    URL,
    headers=headers,
    timeout=30,
)

print("Status:", response.status_code)
print("Final URL:", response.url)
print("HTML length:", len(response.text))

with open(
    "yad1_raw.html",
    "w",
    encoding="utf-8",
) as f:
    f.write(response.text)

soup = BeautifulSoup(response.text, "html.parser")

projects = {}
for a in soup.find_all("a", href=True):
    href = a["href"]

    if "/yad1/project/" not in href:
        continue

    full_url = urljoin(URL, href)
    text = " ".join(a.stripped_strings)

    projects[full_url] = {
        "url": full_url,
        "text": text,
    }

projects = list(projects.values())

print("\nProject links found:", len(projects))

for i, project in enumerate(projects[:30], 1):
    print(f"\n--- {i} ---")
    print(project["url"])
    print(project["text"][:500])

with open(
    "yad1_projects_direct.json",
    "w",
    encoding="utf-8",
) as f:
    json.dump(
        projects,
        f,
        ensure_ascii=False,
        indent=2,
    )

print("\nSaved:")
print("- yad1_raw.html")
print("- yad1_projects_direct.json")