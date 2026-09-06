from pathlib import Path

from fastapi.testclient import TestClient

from app_api import create_app


MATRIX = [
    ["מס' קומה", "מספר דירה", "מס' חדרים", 'שטח דירה (מ"ר)', "שטח מרפסת", "כיווני אוויר", "הערות"],
    [1, 5, 3, 69, 12, "מזרח", None],
    [2, 9, 3, 69, 12, None, None],
]


def client(tmp_path: Path) -> TestClient:
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}")
    return TestClient(app)


def test_project_and_inventory_persist_unknowns_and_version(tmp_path):
    c = client(tmp_path)
    project = c.post("/api/v1/projects", json={"name": "Assignment Demo", "city": "אשקלון"}).json()
    r = c.post(
        f"/api/v1/projects/{project['id']}/inventory/import",
        json={"source_filename": "mix.xlsx", "matrix": MATRIX},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["version_number"] == 1
    assert body["units"][1]["orientation"] is None
    assert body["units"][1]["parking"] is None

    fetched = c.get(f"/api/v1/inventory/{body['id']}")
    assert fetched.status_code == 200
    assert len(fetched.json()["units"]) == 2


def test_identical_inventory_import_is_idempotent(tmp_path):
    c = client(tmp_path)
    project = c.post("/api/v1/projects", json={"name": "Assignment Demo", "city": "אשקלון"}).json()
    url = f"/api/v1/projects/{project['id']}/inventory/import"
    first = c.post(url, json={"source_filename": "mix.xlsx", "matrix": MATRIX}).json()
    second = c.post(url, json={"source_filename": "mix.xlsx", "matrix": MATRIX}).json()
    assert second["id"] == first["id"]
    assert second["version_number"] == 1
    assert second["reused_existing"] is True
