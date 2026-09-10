import requests

X = 3883656.8267620653
Y = 3774202.2401155424

offsets = [
    (0, 0),
    (50, 0), (-50, 0), (0, 50), (0, -50),
    (100, 0), (-100, 0), (0, 100), (0, -100),
    (150, 0), (-150, 0), (0, 150), (0, -150),
    (250, 0), (-250, 0), (0, 250), (0, -250),
]

for dx, dy in offsets:
    x = X + dx
    y = Y + dy

    url = (
        f"https://www.govmap.gov.il/api/"
        f"real-estate/deals/{x},{y}/50"
    )

    try:
        r = requests.get(url, timeout=12)

        print(
            f"offset=({dx:+},{dy:+}) "
            f"status={r.status_code}",
            end=""
        )

        if r.ok:
            data = r.json()
            print(f" rows={len(data)}")

            for row in data[:5]:
                print(
                    "   ",
                    row.get("settlementNameHeb"),
                    row.get("streetNameHeb"),
                    row.get("houseNum"),
                    "polygon=",
                    row.get("polygon_id"),
                    "deals=",
                    row.get("dealscount"),
                )
        else:
            print()

    except Exception as e:
        print(
            f"offset=({dx:+},{dy:+}) ERROR {e}"
        )