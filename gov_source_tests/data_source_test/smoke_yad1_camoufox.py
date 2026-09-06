import os
import json

from dotenv import load_dotenv
from apify_client import ApifyClient


load_dotenv(override=True)

client = ApifyClient(os.environ["APIFY_TOKEN"])

URL = (
    "https://www.yad2.co.il/yad1/newprojects/south"
    "?area=21&category=1&city=7100"
)

page_function = r"""
async function pageFunction(context) {
    const { page, request, log } = context;

    // Give the JS application / protection layer time to settle.
    await page.waitForTimeout(8000);

    const title = await page.title();

    let bodyText = "";
    try {
        bodyText = await page.locator("body").innerText();
    } catch (e) {
        bodyText = "";
    }

    const projectLinks = await page
        .locator('a[href*="/yad1/project/"]')
        .evaluateAll((links) => {
            const seen = new Set();

            return links
                .map((a) => ({
                    url: a.href,
                    text: (a.innerText || "").trim(),
                }))
                .filter((x) => {
                    if (!x.url || seen.has(x.url)) return false;
                    seen.add(x.url);
                    return true;
                });
        });

    return {
        requestedUrl: request.url,
        loadedUrl: page.url(),
        title,
        bodyText: bodyText.slice(0, 20000),
        projectCount: projectLinks.length,
        projectLinks,
    };
}
"""

run_input = {
    "startUrls": [
        {"url": URL}
    ],

    # We only want this one page for the smoke test.
    "linkSelector": "",
    "maxRequestsPerCrawl": 1,
    "maxConcurrency": 1,

    "proxyConfiguration": {
        "useApifyProxy": True,
        "apifyProxyGroups": [
            "RESIDENTIAL"
        ],
    },

    "pageFunction": page_function,
}

print("=" * 70)
print("YAD1 CAMOUFOX SMOKE TEST")
print("=" * 70)
print("URL:", URL)

run = client.actor(
    "apify/camoufox-scraper"
).call(
    run_input=run_input
)

print("\nRun status:", run.status)
print("Dataset:", run.default_dataset_id)

items = list(
    client.dataset(
        run.default_dataset_id
    ).iterate_items()
)

print("\nDataset records:", len(items))

for item in items:
    print("\nTitle:", item.get("title"))
    print("Loaded URL:", item.get("loadedUrl"))
    print("Projects found:", item.get("projectCount"))

    print("\nBODY PREVIEW")
    print("-" * 70)
    print((item.get("bodyText") or "")[:5000])

    print("\nPROJECT LINKS")
    print("-" * 70)

    for i, project in enumerate(
        item.get("projectLinks", []),
        1,
    ):
        print(
            i,
            project.get("url"),
            " | ",
            project.get("text", "")[:150],
        )


with open(
    "yad1_camoufox_smoke.json",
    "w",
    encoding="utf-8",
) as f:
    json.dump(
        items,
        f,
        ensure_ascii=False,
        indent=2,
        default=str,
    )

print("\nSaved: yad1_camoufox_smoke.json")