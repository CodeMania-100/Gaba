import json
from pathlib import Path

FILES = [
    Path("yad2_standard_probe/petah_tikva_3r_page1.json"),
    Path("yad2_standard_probe/petah_tikva_5r_page1.json"),
]

def inspect(obj, name="root", depth=0):
    indent = "  " * depth

    if isinstance(obj, dict):
        print(f"{indent}{name}: dict keys={list(obj.keys())}")

        if depth < 3:
            for k, v in obj.items():
                inspect(v, k, depth + 1)

    elif isinstance(obj, list):
        print(f"{indent}{name}: list[{len(obj)}]")

        if obj:
            first = obj[0]
            if isinstance(first, dict):
                print(f"{indent}FIRST RECORD KEYS:")
                print(list(first.keys()))
                print(f"{indent}FIRST RECORD:")
                print(
                    json.dumps(
                        first,
                        ensure_ascii=False,
                        indent=2
                    )[:8000]
                )
            else:
                print(f"{indent}first={repr(first)[:1000]}")

    else:
        print(f"{indent}{name}: {type(obj).__name__} = {repr(obj)[:300]}")

for path in FILES:
    print("\n" + "=" * 80)
    print(path)
    print("=" * 80)

    data = json.loads(path.read_text(encoding="utf-8"))

    inspect(data)

print("\nDONE")
