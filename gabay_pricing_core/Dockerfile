# Production image for the Gabay pricing-demo FastAPI backend.
#
# Build context MUST be the repository root (not gabay_pricing_core/) so this
# Dockerfile can also reach the one small cross-repo file the workspace
# endpoint optionally reads (see NEARBY_DEALS_EXAMPLE_FILE below) --
# docker-compose.production.yml sets `context: .` + `dockerfile:
# gabay_pricing_core/Dockerfile` accordingly.
#
# Only the runtime-required code and the frozen/diagnostic datasets that
# GET /api/v1/demo/petah-tikva/workspace (and the small demo-project/
# inventory-preview endpoints it ships alongside) actually read are copied
# in -- not the one-time research/audit scripts, not data/raw (1.7GB of raw
# GIS source parcels), not the local dev SQLite file. No live collection
# (Tax Authority / Madlan / Yad2 / geocoding) ever runs at import time or
# startup: the demo serves the already-reviewed frozen snapshot only.

FROM python:3.12-slim AS runtime
WORKDIR /app

COPY gabay_pricing_core/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Runtime code -- mirrors gabay_pricing_core/'s own layout under backend/ so
# `app_api` and `pricing_core` remain importable as top-level packages the
# same way local dev does it (see gabay_pricing_core/README.md: `PYTHONPATH=.
# uvicorn app_api.main:app`).
COPY gabay_pricing_core/app_api ./backend/app_api
COPY gabay_pricing_core/pricing_core ./backend/pricing_core
COPY gabay_pricing_core/petah_tikva_pricing.py ./backend/petah_tikva_pricing.py
COPY gabay_pricing_core/inventory_source_rows.json ./backend/inventory_source_rows.json

# Canonical frozen datasets the petah-tikva workspace endpoint reads
# directly: standard sold/asking/competitor evidence, market ranges, price
# list, competitor register seed, special-unit master data, standard
# attribute enrichment, and the one-time map-geocoding pass.
COPY gabay_pricing_core/data/frozen ./backend/data/frozen

# Small diagnostic inputs used by the demo-project/inventory-preview flow
# (app_api/demo_snapshot.py) -- three specific files, not the diagnostics/
# directory's one-time sold/parcel audit dumps alongside them.
COPY gabay_pricing_core/data/diagnostics/three_room_program_overlap_parcels.json ./backend/data/diagnostics/three_room_program_overlap_parcels.json
COPY gabay_pricing_core/data/diagnostics/five_room_program_overlap_parcels.json ./backend/data/diagnostics/five_room_program_overlap_parcels.json
COPY gabay_pricing_core/data/diagnostics/three_room_verified_demo_scope_v1.json ./backend/data/diagnostics/three_room_verified_demo_scope_v1.json

# One already-collected, saved example response (see
# app_api/petah_tikva_workspace.py: NEARBY_DEALS_EXAMPLE_FILE) -- purely a
# methodology illustration surfaced in the workspace payload; the code
# degrades gracefully (record_count stays null) if this is ever missing, but
# keeping it lands the container's response byte-for-byte identical to local
# dev. Kept at its real repo-relative path (one level above backend/) so
# root.parent / NEARBY_DEALS_EXAMPLE_FILE still resolves exactly as it does
# outside Docker.
COPY gov_source_tests/data_source_test/yad2_petah_special/nearby_deals/apt3_garden.json ./gov_source_tests/data_source_test/yad2_petah_special/nearby_deals/apt3_garden.json

WORKDIR /app/backend
ENV PYTHONPATH=. \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).read()" || exit 1

# Binds inside the container only -- 0.0.0.0:8000 is reached over the Docker
# network by the existing reverse proxy, never published on the host.
CMD ["uvicorn", "app_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
