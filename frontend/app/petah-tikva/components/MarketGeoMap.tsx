"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { PetahTikvaWorkspace, SpecialUnitIndication } from "@/lib/api";
import {
  deriveAskingPoints,
  deriveCompetitorPoints,
  deriveProjectAreaPoint,
  deriveSoldFamilyCoverage,
  deriveSoldPoints,
  deriveSpecialAskingPoints,
  deriveSpecialCompetitorPoints,
  deriveSpecialSoldPoints,
  deriveSpecialTypologyContextPoints,
  deriveSpecialUnitMapCoverage,
  deriveSpecialUnitSubjectFacts,
  MarketMapFamily,
  MarketMapPoint,
  MarketMapSelection,
  pointContributesForFamily,
  SPECIAL_UNIT_NUMBERS,
  SpecialUnitMapCoverage,
  SpecialUnitNumber,
  specialUnitDropdownLabel,
  SpecialUnitSubjectFacts,
} from "@/lib/marketMap";
import { ils, num } from "@/lib/format";
import { CONFIDENCE_COLORS, CONFIDENCE_LABELS } from "@/lib/family";

// MapLibre's default worker-URL detection reads import.meta.url of its own
// bundled module to locate its sibling tile-parsing worker script; Turbopack
// serves that module from a non-http(s) URL in dev, so the auto-detected
// worker URL resolves empty and no vector tiles are ever fetched (no error
// is thrown -- the map just stays visually blank). Pointing at a static copy
// of the worker (public/maplibre-gl/, copied from node_modules/maplibre-gl's
// dist at the pinned installed version) sidesteps that bundler limitation.
maplibregl.setWorkerUrl("/maplibre-gl/maplibre-gl-worker.mjs");

// A free, no-API-key, light/gray vector basemap -- roads, street names, and
// neighborhood context without satellite imagery or saturated colors (see
// task item 1). OpenStreetMap + CARTO attribution is rendered automatically
// by MapLibre's built-in attribution control (never removed, see item 43).
const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const COLORS = {
  project_area: "#0f172a",
  sold: "#5f8a72",
  asking: "#3b6ea5",
  competitor_direct: "#c2760c",
  competitor_other: "#d9a765",
};

// Special-unit mode gives every point a three-tier opacity so an excluded
// comparable never looks identical to a voting one (task item 25) --
// without inventing new marker colors. Standard mode (specialStatus absent
// on the feature) falls back to each layer's ORIGINAL look, unchanged: the
// asking/sold binary contributesToPricing opacity, or full opacity for
// competitors (which never had opacity-based dimming before).
const SPECIAL_STATUS_OPACITY_EXPRESSION = [
  "case",
  ["==", ["get", "specialStatus"], "participating"],
  0.9,
  ["==", ["get", "specialStatus"], "context_only"],
  0.55,
  ["==", ["get", "specialStatus"], "excluded"],
  0.22,
  ["get", "contributesToPricing"],
  0.9,
  0.45,
];
const COMPETITOR_OPACITY_EXPRESSION = [
  "case",
  ["==", ["get", "specialStatus"], "participating"],
  1,
  ["==", ["get", "specialStatus"], "context_only"],
  0.7,
  ["==", ["get", "specialStatus"], "excluded"],
  0.3,
  1,
];

// Individual per-point ₪/m² labels only appear once the map is zoomed close
// enough to read them without turning the map into a wall of numbers (task
// feedback item 8) -- shared by the source-layer minzoom and the "תוויות:
// מחיר למ״ר" context badge (item 7), which only makes sense to show when
// those labels are actually on screen.
const PRICE_LABEL_MIN_ZOOM = 15.5;

type LayerKey = "sold" | "asking" | "competitor";
type ViewMode = "source" | "ppsm";

interface Props {
  workspace: PetahTikvaWorkspace;
  // Standard 3R/5R family selection is owned by the page (shared with
  // Competitive Intelligence / Research), but a special-unit map selection
  // is a completely separate concept -- see lib/marketMap.ts's
  // MarketMapSelection and task item 20. The map owns which of the two
  // modes it's showing; the page only needs to know about family for the
  // *other* sections.
  selection: MarketMapSelection;
  onSelectionChange: (s: MarketMapSelection) => void;
}

/** Real geographic decision-support map (MapLibre GL JS + a free light
 * basemap) -- replaces the earlier schematic scatter plot entirely. Every
 * point comes from lib/marketMap.ts, which only ever re-reads real
 * coordinates (current-asking listings) or the frozen, one-time geocoding
 * pass (build_map_geocodes_v1.py); nothing is geocoded live and nothing is
 * invented. Filtering (family / evidence-only) never touches pricing --
 * it only changes which already-computed points are drawn.
 *
 * Special-unit mode reuses the exact same point types (sold/asking/
 * competitor) and the exact same "כל נתוני השוק" / "רק ראיות שנכנסו לחישוב"
 * toggle -- only the underlying derivation (lib/marketMap.ts's
 * deriveSpecial*Points) and the detail-panel content differ, since a
 * special apartment's evidence is a unit-specific basket
 * (workspace.special_unit_market_context), never a generic room-count
 * family (see task "Map Batch -- special apartments"). */
export default function MarketGeoMap({ workspace, selection, onSelectionChange }: Props) {
  const isSpecial = selection.kind === "special_unit";
  const family: MarketMapFamily = selection.kind === "standard_family" ? selection.family : "3R";
  const specialUnitNumber: SpecialUnitNumber | null = selection.kind === "special_unit" ? selection.unitNumber : null;
  // Remembered so switching away from and back to "דירות מיוחדות" restores
  // whichever unit was last explicitly selected, instead of always
  // snapping back to the default (task item 2: "Default special selection:
  // דירה 1 unless an apartment was opened elsewhere and explicitly selected").
  const [lastSpecialUnit, setLastSpecialUnit] = useState<SpecialUnitNumber>(1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pointsById = useRef<Map<string, MarketMapPoint>>(new Map());
  const initialBoundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [fitted, setFitted] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(13);

  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ sold: true, asking: true, competitor: true });
  const [onlyEvidence, setOnlyEvidence] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("source");
  const [selected, setSelected] = useState<MarketMapPoint | null>(null);
  const [hover, setHover] = useState<{ point: MarketMapPoint; x: number; y: number } | null>(null);

  // Standard-family derivations -- unchanged from before, only ever used
  // when selection.kind === "standard_family".
  const askingAll = useMemo(() => deriveAskingPoints(workspace), [workspace]);
  const soldAll = useMemo(() => deriveSoldPoints(workspace), [workspace]);
  const competitorAll = useMemo(() => deriveCompetitorPoints(workspace), [workspace]);
  const projectAreaLabel = workspace.market_context && !workspace.market_context.slug.includes("petah_tikva")
    ? (workspace.project.commercial_area || workspace.project.official_neighborhood)
    : undefined;
  const projectArea = useMemo(() => deriveProjectAreaPoint(askingAll, projectAreaLabel), [askingAll, projectAreaLabel]);

  const askingByFamily = useMemo(() => askingAll.filter((p) => p.family === family), [askingAll, family]);
  const soldByFamily = useMemo(() => soldAll.filter((p) => p.family === family), [soldAll, family]);
  const soldFamilyCoverage = useMemo(() => deriveSoldFamilyCoverage(workspace, family, soldByFamily), [workspace, family, soldByFamily]);
  const askingRelevantCount = useMemo(() => askingByFamily.filter((p) => p.contributesToPricing).length, [askingByFamily]);

  // Special-unit derivations -- only ever used when selection.kind ===
  // "special_unit". Empty arrays otherwise so the rest of the component can
  // stay branch-free.
  const specialSoldAll = useMemo(
    () => (specialUnitNumber != null ? deriveSpecialSoldPoints(workspace, specialUnitNumber) : []),
    [workspace, specialUnitNumber]
  );
  const specialAskingAll = useMemo(
    () => (specialUnitNumber != null ? deriveSpecialAskingPoints(workspace, specialUnitNumber) : []),
    [workspace, specialUnitNumber]
  );
  // Newly-researched triplex-product context (task item 9) -- kept as its
  // own memo (not merged into specialAskingAll's derivation) since it's a
  // distinct, always-non-voting source, but flows through the exact same
  // asking-layer rendering/toggle below.
  const specialTypologyContextAll = useMemo(
    () => (specialUnitNumber != null ? deriveSpecialTypologyContextPoints(workspace, specialUnitNumber) : []),
    [workspace, specialUnitNumber]
  );
  const specialCompetitorAll = useMemo(
    () => (specialUnitNumber != null ? deriveSpecialCompetitorPoints(workspace, specialUnitNumber) : []),
    [workspace, specialUnitNumber]
  );
  const specialCoverage = useMemo(
    () => (specialUnitNumber != null ? deriveSpecialUnitMapCoverage(workspace, specialUnitNumber, specialSoldAll, specialAskingAll) : null),
    [workspace, specialUnitNumber, specialSoldAll, specialAskingAll]
  );
  const subjectFacts = useMemo(
    () => (specialUnitNumber != null ? deriveSpecialUnitSubjectFacts(workspace, specialUnitNumber) : null),
    [workspace, specialUnitNumber]
  );
  const specialIndication = specialUnitNumber != null ? workspace.special_unit_market_context.units[String(specialUnitNumber)]?.market_indication ?? null : null;

  // The one set the rest of the component (rendering, fitBounds, etc.)
  // actually works with, picked by mode.
  const activeAsking = isSpecial ? [...specialAskingAll, ...specialTypologyContextAll] : askingByFamily;
  const activeSold = isSpecial ? specialSoldAll : soldByFamily;
  const activeCompetitor = isSpecial ? specialCompetitorAll : competitorAll;

  // Same toggle, same semantics, for both modes: contributesToPricing is
  // already status==="participating" for special points (see
  // lib/marketMap.ts), so this filter needs no branching at all.
  const askingVisible = useMemo(
    () => (layers.asking ? activeAsking.filter((p) => !onlyEvidence || p.contributesToPricing) : []),
    [activeAsking, layers.asking, onlyEvidence]
  );
  const soldVisible = useMemo(
    () => (layers.sold ? activeSold.filter((p) => !onlyEvidence || p.contributesToPricing) : []),
    [activeSold, layers.sold, onlyEvidence]
  );
  const competitorVisible = useMemo(
    () =>
      layers.competitor
        ? activeCompetitor.filter((p) => !onlyEvidence || (isSpecial ? p.contributesToPricing : pointContributesForFamily(p, workspace, family)))
        : [],
    [activeCompetitor, layers.competitor, onlyEvidence, workspace, family, isSpecial]
  );

  // Keep "last special unit" synced so leaving and returning to "דירות
  // מיוחדות" (or a fresh external selection, e.g. from UnitDrawer) restores
  // the right unit rather than always defaulting to 1.
  useEffect(() => {
    if (specialUnitNumber != null) setLastSpecialUnit(specialUnitNumber);
  }, [specialUnitNumber]);

  // Re-fit the initial viewport whenever the selection itself changes (a
  // different special unit, or switching between standard/special) -- see
  // task item 24, "for each special unit, fit initially to..." -- not only
  // on first mount.
  const selectionKey = selection.kind === "standard_family" ? `family:${selection.family}` : `special:${selection.unitNumber}`;
  useEffect(() => {
    setFitted(false);
    setSelected(null);
  }, [selectionKey]);

  // ---- map init (once per mount) ----
  // Reads the workspace's own per-market-context center/zoom when present
  // (see workspace.map, populated from that context's location.json),
  // falling back to Petah Tikva's original hardcoded literal only when
  // absent -- keeps Petah Tikva's own render byte-identical. This effect
  // itself still only runs once per mount (empty deps, unchanged); a market-
  // context switch re-centers correctly because the page gives this
  // component's subtree a `key={marketContext}`, forcing a full remount
  // (and therefore a fresh run of this effect) rather than relying on this
  // effect reacting to a workspace prop change.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const fallbackCenter: [number, number] = [34.887, 32.082];
    const center = workspace.map?.center ?? fallbackCenter;
    const zoom = workspace.map?.zoom ?? 13;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: BASEMAP_STYLE,
        center,
        zoom,
        attributionControl: { compact: true },
      });
    } catch {
      setMapError(true);
      return;
    }
    map.on("error", (e: { error?: { message?: string } }) => {
      // Tile/style load failures land here -- fail gracefully (item 42)
      // rather than showing a silent empty gray box.
      console.warn("Map load issue:", e?.error?.message ?? e);
      setMapError(true);
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.on("load", () => {
      mapRef.current = map;
      setMapReady(true);
    });

    // The container can still have a zero/unsettled size at construction
    // time (it mounts inside a flex layout below several sections) --
    // MapLibre doesn't auto-recompute the tiles it needs unless resize() is
    // called after the container's real dimensions are known.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- sources & layers (created once map is ready, updated via setData) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    ensurePointSource(map, "src-asking", "cluster-asking", "point-asking", "label-asking", COLORS.asking);
    ensurePointSource(map, "src-sold", "cluster-sold", "point-sold", "label-sold", COLORS.sold);
    ensureCompetitorSource(map);
    ensureProjectAreaSource(map);

    const handlers = registerInteractions(map, setSelected, setHover, pointsById);
    return () => handlers.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // ---- update source data whenever the visible point sets change ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    pointsById.current = new Map([...askingVisible, ...soldVisible, ...competitorVisible, ...(projectArea ? [projectArea] : [])].map((p) => [p.id, p]));

    const ppsmDomain = isSpecial ? specialUnitPpsmDomain([...activeSold, ...activeAsking]) : soldPpsmDomain(activeSold);

    setGeoJsonData(map, "src-asking", toFeatureCollection(askingVisible));
    setGeoJsonData(map, "src-sold", toFeatureCollection(soldVisible, viewMode === "ppsm" ? ppsmDomain : undefined));
    setGeoJsonData(map, "src-competitor", toFeatureCollection(competitorVisible));
    setGeoJsonData(map, "src-project-area", toFeatureCollection(projectArea ? [projectArea] : []));

    if (map.getLayer("point-sold")) {
      map.setPaintProperty(
        "point-sold",
        "circle-color",
        viewMode === "ppsm" ? ["interpolate", ["linear"], ["get", "pricePerSqm"], ...ppsmColorStops(ppsmDomain)] : COLORS.sold
      );
    }

    if (!fitted) {
      // Fit to the core, already-evidentiary dataset -- never to the wider
      // "all market data" context pool (item 33 also surfaces listings
      // outside the tight comparison submarket, which would otherwise blow
      // the initial zoom out far past the area a Marketing manager actually
      // cares about; that's exactly the "accidental outlier zoom-out" the
      // task explicitly warns against). Context points stay visible/pannable,
      // they just don't drive the initial viewport. Special mode: "core" =
      // project area + participating evidence + directly relevant (non-
      // excluded) competitors (task item 24) -- never let a distant
      // context-only comparable blow out the initial zoom.
      const core = [...askingVisible, ...soldVisible, ...competitorVisible, ...(projectArea ? [projectArea] : [])].filter((p) => {
        if (p.kind === "project_area") return true;
        if (isSpecial) return p.kind === "competitor" ? p.specialStatus !== "excluded" : p.specialStatus === "participating";
        return p.kind === "competitor" || p.contributesToPricing;
      });
      if (core.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        core.forEach((p) => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 0 });
        // Remembered so "חזרה לאזור הפרויקט" (item 11) can restore exactly
        // this frame after a click has flown the camera to a selected point.
        initialBoundsRef.current = bounds;
        setFitted(true);
      }
    }
    // fitted is deliberately in this array: resetting it to false (see the
    // selectionKey effect above) must retrigger this effect so the map
    // actually re-fits on selection change, not just on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, askingVisible, soldVisible, competitorVisible, projectArea, viewMode, isSpecial, fitted]);

  // ---- track zoom so UI (the "תוויות: מחיר למ״ר" context badge) can tell
  // whether the per-point price labels are currently on screen ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const onZoom = () => setCurrentZoom(map.getZoom());
    map.on("zoom", onZoom);
    setCurrentZoom(map.getZoom());
    return () => {
      map.off("zoom", onZoom);
    };
  }, [mapReady]);

  // ---- selection emphasis: larger marker + a one-time pulse ring, and fly
  // the camera to the selected point so its surrounding context becomes
  // visible (feedback items 1 and 11) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    applySelectionEmphasis(map, selected?.id ?? null);
    if (!selected) return;

    const el = document.createElement("div");
    el.className = "mgm-select-ring";
    const color = ringColorFor(selected);
    const core = document.createElement("div");
    core.className = "mgm-select-ring__core";
    core.style.borderColor = color;
    const pulse = document.createElement("div");
    pulse.className = "mgm-select-ring__pulse";
    pulse.style.borderColor = color;
    el.appendChild(core);
    el.appendChild(pulse);
    const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([selected.lng, selected.lat]).addTo(map);

    map.flyTo({ center: [selected.lng, selected.lat], zoom: Math.max(map.getZoom(), 16), duration: 800 });

    return () => {
      marker.remove();
    };
  }, [selected, mapReady]);

  const resetToDefaultView = () => {
    const map = mapRef.current;
    const bounds = initialBoundsRef.current;
    setSelected(null);
    if (map && bounds) map.fitBounds(bounds, { padding: 60, duration: 800 });
  };

  const ppsmDomain = isSpecial ? specialUnitPpsmDomain([...activeSold, ...activeAsking]) : soldPpsmDomain(activeSold);
  const priceLabelsVisible = currentZoom >= PRICE_LABEL_MIN_ZOOM;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-300 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-900">איפה נמצאות ראיות השוק?</h2>
        <p className="text-xs text-slate-500">מיקום עסקאות, דירות מוצעות ופרויקטים מתחרים בסביבת אזור ההשוואה</p>
        <p className="mt-1 text-[11px] text-slate-400">
          כתובת הפרויקט לא סופקה במטלה; סמן הפרויקט מייצג את מרכז אזור ההדגמה בלבד.
        </p>
      </div>

      {/* top-level selector: standard families + special apartments. Special
          units are never folded into a generic room-count family (task
          item 1) -- picking "דירות מיוחדות" reveals a compact secondary
          dropdown rather than seven buttons across the map (item 2). */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-md border border-slate-300 w-fit">
          {(["3R", "5R"] as const).map((f) => (
            <button
              key={f}
              onClick={() => onSelectionChange({ kind: "standard_family", family: f })}
              className={`px-4 py-2 text-sm font-semibold transition-colors ${
                selection.kind === "standard_family" && selection.family === f
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f === "3R" ? "3 חדרים" : "5 חדרים"}
            </button>
          ))}
          <button
            onClick={() => onSelectionChange({ kind: "special_unit", unitNumber: lastSpecialUnit })}
            className={`px-4 py-2 text-sm font-semibold transition-colors ${isSpecial ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            דירות מיוחדות
          </button>
        </div>

        {isSpecial && (
          <select
            value={specialUnitNumber ?? lastSpecialUnit}
            onChange={(e) => onSelectionChange({ kind: "special_unit", unitNumber: Number(e.target.value) as SpecialUnitNumber })}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
          >
            {SPECIAL_UNIT_NUMBERS.map((n) => (
              <option key={n} value={n}>
                {specialUnitDropdownLabel(workspace, n)}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* subject-apartment card (task item 9) -- only known fields, garden
          units get "שטח חצר" rather than balcony terminology */}
      {isSpecial && subjectFacts && (
        <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
          <div className="font-bold text-slate-900">דירה {subjectFacts.unitNumber}</div>
          <div className="text-xs text-slate-500">
            {subjectFacts.categoryLabel}
            {subjectFacts.rooms != null && ` | ${subjectFacts.rooms} חדרים`}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {subjectFacts.internalArea != null && <span>{num(subjectFacts.internalArea)} מ״ר פנים</span>}
            {subjectFacts.outdoorArea != null && (
              <span>
                {num(subjectFacts.outdoorArea)} מ״ר {subjectFacts.category === "garden" ? "(שטח חצר)" : "חוץ"}
              </span>
            )}
            {subjectFacts.floor != null && <span>קומות {subjectFacts.floor}</span>}
            {subjectFacts.orientation != null && <span>{subjectFacts.orientation}</span>}
          </div>
        </div>
      )}

      {/* תצוגה: the single most important control on this map -- switching
          from "all market data" to "only evidence that entered the
          calculation" is what demonstrates the tool's core value, so it
          gets deliberately stronger visual weight than the layer checkboxes
          below it (feedback item 2). */}
      <div className="rounded-lg border-2 border-slate-900 bg-amber-50/50 p-2.5">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">תצוגה</div>
        <div className="flex overflow-hidden rounded-md border border-slate-300 bg-white">
          <button
            onClick={() => setOnlyEvidence(false)}
            className={`flex-1 px-4 py-2.5 text-sm font-semibold transition-colors ${!onlyEvidence ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            כל נתוני השוק
          </button>
          <button
            onClick={() => setOnlyEvidence(true)}
            className={`flex-1 px-4 py-2.5 text-sm font-semibold transition-colors ${onlyEvidence ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            רק ראיות שנכנסו לחישוב
          </button>
        </div>
      </div>

      {/* שכבות -- secondary, ordinary-weight controls */}
      <div className="flex flex-wrap items-center gap-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-500">שכבות:</span>
        <LayerCheckbox label="עסקאות שבוצעו" checked={layers.sold} onChange={(v) => setLayers((s) => ({ ...s, sold: v }))} />
        <LayerCheckbox label="דירות מוצעות" checked={layers.asking} onChange={(v) => setLayers((s) => ({ ...s, asking: v }))} />
        <LayerCheckbox label="פרויקטים מתחרים" checked={layers.competitor} onChange={(v) => setLayers((s) => ({ ...s, competitor: v }))} />
        {ppsmDomain && (
          <div className="mr-auto flex overflow-hidden rounded-md border border-slate-300">
            <button
              onClick={() => setViewMode("source")}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${viewMode === "source" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              סוג מקור
            </button>
            <button
              onClick={() => setViewMode("ppsm")}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${viewMode === "ppsm" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              מחיר למ״ר
            </button>
          </div>
        )}
      </div>

      {/* compact summary strip -- "above the map", answers what N dots on
          the map actually represent (feedback item 4 / special item 8) */}
      {isSpecial ? (
        <SpecialUnitSummary
          unitNumber={specialUnitNumber}
          subjectFacts={subjectFacts}
          indication={specialIndication}
          competitorCount={specialCompetitorAll.length}
          coverage={specialCoverage}
        />
      ) : (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-sm font-bold text-slate-900">{family === "3R" ? "3 חדרים" : "5 חדרים"}</div>
          <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
            <span>
              <span className="font-semibold text-slate-800">{soldFamilyCoverage.includedTotal}</span> עסקאות שנכללו
            </span>
            <span>
              <span className="font-semibold text-slate-800">{askingRelevantCount}</span> מודעות רלוונטיות
            </span>
            <span>
              <span className="font-semibold text-slate-800">{competitorAll.length}</span> פרויקטים מתחרים
            </span>
          </div>
          {soldFamilyCoverage.mappedTotal < soldFamilyCoverage.includedTotal && (
            <div className="mt-1 text-xs font-medium text-amber-700">
              {soldFamilyCoverage.mappedTotal} מתוך {soldFamilyCoverage.includedTotal} עסקאות ממופות
            </div>
          )}
        </div>
      )}

      {/* map + side panel */}
      <div className="flex gap-3" dir="ltr">
        <div className={`relative overflow-hidden rounded-md border border-slate-200 ${selected ? "w-[72%]" : "w-full"}`} style={{ height: 620 }}>
          <div ref={containerRef} className="h-full w-full" />
          {mapError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-50 text-center" dir="rtl">
              <p className="text-sm font-medium text-slate-600">לא ניתן לטעון כרגע את שכבת המפה</p>
              <p className="text-xs text-slate-400">נתוני השוק וההשוואות עדיין זמינים במערכת</p>
            </div>
          )}
          {selected && (
            <button
              dir="rtl"
              onClick={resetToDefaultView}
              className="absolute left-2 top-[76px] z-10 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-md hover:bg-slate-50"
            >
              ↺ חזרה לאזור הפרויקט
            </button>
          )}
          {priceLabelsVisible && !mapError && (
            <div dir="rtl" className="absolute right-2 top-2 z-10 rounded-md bg-white/95 px-2 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
              תוויות: מחיר למ״ר
            </div>
          )}
          {hover && !selected && (
            <div
              dir="rtl"
              className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              <HoverContent point={hover.point} />
            </div>
          )}
        </div>

        {selected && (
          <div dir="rtl" className="w-[28%] shrink-0 overflow-y-auto rounded-md border border-slate-200 bg-white p-3" style={{ height: 620 }}>
            <DetailPanel point={selected} workspace={workspace} family={family} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>

      <MapLegend ppsmDomain={viewMode === "ppsm" ? ppsmDomain : null} />

      {/* One-time selection pulse (feedback item 1): a static ring marks the
          selected point permanently; ::after plays a single expanding fade
          via animation-fill-mode: forwards, so it never loops. */}
      <style>{`
        .mgm-select-ring { position: relative; width: 30px; height: 30px; pointer-events: none; }
        .mgm-select-ring__core { position: absolute; inset: 0; border-radius: 9999px; border-width: 3px; border-style: solid; }
        .mgm-select-ring__pulse { position: absolute; inset: -3px; border-radius: 9999px; border-width: 3px; border-style: solid; animation: mgmSelectPulse 700ms ease-out 1 forwards; }
        @keyframes mgmSelectPulse { 0% { transform: scale(0.6); opacity: 0.9; } 100% { transform: scale(2.4); opacity: 0; } }
      `}</style>
    </section>
  );
}

// ---------------------------------------------------------------------------
// MapLibre wiring helpers
// ---------------------------------------------------------------------------

function toFeatureCollection(points: MarketMapPoint[], _ppsmDomain?: [number, number]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        title: p.title,
        kind: p.kind,
        classification: p.classification ?? null,
        contributesToPricing: p.contributesToPricing,
        pricePerSqm: p.pricePerSqm ?? null,
        // Only set in special-unit mode (task item 25) -- participating /
        // context_only / excluded get three distinct opacities so an
        // excluded comparable never looks identical to a voting one.
        specialStatus: p.specialStatus ?? null,
      },
    })),
  };
}

function setGeoJsonData(map: maplibregl.Map, sourceId: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  if (source) source.setData(data);
}

function ensurePointSource(map: maplibregl.Map, sourceId: string, clusterLayerId: string, pointLayerId: string, labelLayerId: string, color: string) {
  if (map.getSource(sourceId)) return;
  map.addSource(sourceId, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterRadius: 38,
    clusterMaxZoom: 15,
  });
  map.addLayer({
    id: clusterLayerId,
    type: "circle",
    source: sourceId,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": color,
      "circle-opacity": 0.85,
      "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 30, 24],
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });
  map.addLayer({
    id: `${clusterLayerId}-count`,
    type: "symbol",
    source: sourceId,
    filter: ["has", "point_count"],
    layout: { "text-field": "{point_count_abbreviated}", "text-size": 11, "text-font": ["Noto Sans Regular"] },
    paint: { "text-color": "#ffffff" },
  });
  map.addLayer({
    id: pointLayerId,
    type: "circle",
    source: sourceId,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": color,
      // Special mode (task item 25): three distinct opacities so an
      // excluded comparable never looks identical to a voting one, without
      // inventing new marker colors. Standard mode (specialStatus absent)
      // keeps its original binary contributesToPricing look.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "circle-opacity": SPECIAL_STATUS_OPACITY_EXPRESSION as any,
      "circle-radius": 5.5,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
    },
  });
  map.addLayer({
    id: labelLayerId,
    type: "symbol",
    source: sourceId,
    filter: ["!", ["has", "point_count"]],
    minzoom: PRICE_LABEL_MIN_ZOOM,
    layout: {
      "text-field": ["case", ["==", ["get", "pricePerSqm"], null], "", ["concat", "₪", ["to-string", ["round", ["/", ["get", "pricePerSqm"], 1000]]], "K"]],
      "text-size": 10,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
    },
    paint: { "text-color": "#475569", "text-halo-color": "#ffffff", "text-halo-width": 1.2 },
  });
}

function ensureCompetitorSource(map: maplibregl.Map) {
  if (map.getSource("src-competitor")) return;
  map.addSource("src-competitor", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "point-competitor",
    type: "circle",
    source: "src-competitor",
    paint: {
      "circle-color": ["case", ["==", ["get", "classification"], "direct"], COLORS.competitor_direct, COLORS.competitor_other],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "circle-opacity": COMPETITOR_OPACITY_EXPRESSION as any,
      "circle-radius": 7,
      "circle-stroke-width": ["case", ["==", ["get", "classification"], "direct"], 2.5, 1.2],
      "circle-stroke-color": "#ffffff",
    },
  });
  map.addLayer({
    id: "label-competitor",
    type: "symbol",
    source: "src-competitor",
    // Competitor names stay permanent at broad zoom (feedback item 8) --
    // only individual ₪/m² labels are zoom-gated. Collision handling
    // (text-optional, no allow-overlap) still hides a label if it can't fit
    // without clobbering a neighbor, it's just never hidden by zoom alone.
    layout: {
      "text-field": ["get", "title"],
      "text-size": 11,
      "text-offset": [0, 1.2],
      "text-anchor": "top",
      "text-font": ["Noto Sans Regular"],
      "text-allow-overlap": false,
      "text-optional": true,
    },
    paint: { "text-color": "#7c4a03", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
  });
}

function ensureProjectAreaSource(map: maplibregl.Map) {
  if (map.getSource("src-project-area")) return;
  map.addSource("src-project-area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "point-project-area",
    type: "circle",
    source: "src-project-area",
    paint: { "circle-color": COLORS.project_area, "circle-radius": 9, "circle-stroke-width": 2.5, "circle-stroke-color": "#ffffff" },
  });
  map.addLayer({
    id: "label-project-area",
    type: "symbol",
    source: "src-project-area",
    // "Noto Sans Bold" glyph ranges aren't served with CORS headers by the
    // basemap's font CDN (upstream gap, not ours) -- Regular renders the
    // same Hebrew label without the failed cross-origin glyph fetches.
    layout: { "text-field": "★ אזור הפרויקט", "text-size": 12, "text-offset": [0, 1.2], "text-anchor": "top", "text-font": ["Noto Sans Regular"] },
    paint: { "text-color": COLORS.project_area, "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
  });
}

// Makes the selected feature visibly larger than its neighbors on the same
// layer (feedback item 1) via a data-driven case expression keyed on the
// point's own id -- re-set only when the selection changes, not per frame.
function applySelectionEmphasis(map: maplibregl.Map, selectedId: string | null) {
  const configs: { layer: string; baseRadius: number; boostedRadius: number; baseStroke: unknown }[] = [
    { layer: "point-asking", baseRadius: 5.5, boostedRadius: 9, baseStroke: 1 },
    { layer: "point-sold", baseRadius: 5.5, boostedRadius: 9, baseStroke: 1 },
    { layer: "point-competitor", baseRadius: 7, boostedRadius: 11, baseStroke: ["case", ["==", ["get", "classification"], "direct"], 2.5, 1.2] },
    { layer: "point-project-area", baseRadius: 9, boostedRadius: 13, baseStroke: 2.5 },
  ];
  for (const { layer, baseRadius, boostedRadius, baseStroke } of configs) {
    if (!map.getLayer(layer)) continue;
    map.setPaintProperty(layer, "circle-radius", selectedId ? ["case", ["==", ["get", "id"], selectedId], boostedRadius, baseRadius] : baseRadius);
    const strokeExpr = selectedId ? ["case", ["==", ["get", "id"], selectedId], 3.5, baseStroke] : baseStroke;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.setPaintProperty(layer, "circle-stroke-width", strokeExpr as any);
  }
}

function ringColorFor(point: MarketMapPoint): string {
  if (point.kind === "sold") return COLORS.sold;
  if (point.kind === "asking") return COLORS.asking;
  if (point.kind === "project_area") return COLORS.project_area;
  return point.classification === "direct" ? COLORS.competitor_direct : COLORS.competitor_other;
}

function registerInteractions(
  map: maplibregl.Map,
  setSelected: (p: MarketMapPoint | null) => void,
  setHover: (h: { point: MarketMapPoint; x: number; y: number } | null) => void,
  pointsById: React.MutableRefObject<Map<string, MarketMapPoint>>
): (() => void)[] {
  const pointLayers = ["point-asking", "point-sold", "point-competitor", "point-project-area"];
  const clusterLayers = ["cluster-asking", "cluster-sold"];
  const offs: (() => void)[] = [];

  for (const layerId of pointLayers) {
    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const id = feature?.properties?.id as string | undefined;
      if (!id) return;
      const point = pointsById.current.get(id);
      if (point) setSelected(point);
    };
    const onMove = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const id = feature?.properties?.id as string | undefined;
      if (!id) return;
      const point = pointsById.current.get(id);
      if (!point) return;
      // e.point is already relative to the map container, matching the
      // absolutely-positioned tooltip div's coordinate space.
      setHover({ point, x: e.point.x, y: e.point.y });
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      setHover(null);
      map.getCanvas().style.cursor = "";
    };
    map.on("click", layerId, onClick);
    map.on("mousemove", layerId, onMove);
    map.on("mouseleave", layerId, onLeave);
    offs.push(() => {
      map.off("click", layerId, onClick);
      map.off("mousemove", layerId, onMove);
      map.off("mouseleave", layerId, onLeave);
    });
  }

  for (const layerId of clusterLayers) {
    const onClick = async (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const sourceId = layerId === "cluster-asking" ? "src-asking" : "src-sold";
      const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
      if (clusterId == null || !source) return;
      const zoom = await source.getClusterExpansionZoom(clusterId);
      const geom = feature!.geometry as GeoJSON.Point;
      map.easeTo({ center: geom.coordinates as [number, number], zoom });
    };
    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };
    map.on("click", layerId, onClick);
    map.on("mouseenter", layerId, onEnter);
    map.on("mouseleave", layerId, onLeave);
    offs.push(() => {
      map.off("click", layerId, onClick);
      map.off("mouseenter", layerId, onEnter);
      map.off("mouseleave", layerId, onLeave);
    });
  }

  return offs;
}

function soldPpsmDomain(points: MarketMapPoint[]): [number, number] | undefined {
  const values = points.map((p) => p.pricePerSqm).filter((v): v is number => v != null);
  if (values.length < 8) return undefined;
  return [Math.min(...values), Math.max(...values)];
}

// A special unit's whole evidence basket is a handful of records (never the
// hundreds a standard family has), so the standard 8-item sold-only
// threshold would never fire -- combines sold+asking and uses a lower,
// still-defensible minimum (task item 18: never compute ₪/m² from too few
// or non-unit-level records; every value here already only exists on a
// point when that record has its own real price+area, see
// lib/marketMap.ts's pricePerSqmOrUndefined).
function specialUnitPpsmDomain(points: MarketMapPoint[]): [number, number] | undefined {
  const values = points.map((p) => p.pricePerSqm).filter((v): v is number => v != null);
  if (values.length < 3) return undefined;
  return [Math.min(...values), Math.max(...values)];
}

function ppsmColorStops(domain: [number, number] | undefined): (string | number)[] {
  if (!domain) return [0, "#5f8a72", 1, "#5f8a72"];
  const [lo, hi] = domain;
  const mid = (lo + hi) / 2;
  return [lo, "#7fb3d5", mid, "#f4d35e", hi, "#c2543a"];
}

// ---------------------------------------------------------------------------
// UI subcomponents
// ---------------------------------------------------------------------------

function LayerCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-slate-900" />
      {label}
    </label>
  );
}

/** Special-unit summary strip (task item 8) -- real counts from the final
 * basket only (market_indication.lanes, not the mapped-point counts, which
 * can undercount when an address didn't geocode -- see the mapped-coverage
 * line below for that). A lane with genuinely no evidence reads "אין ראיה
 * כמותית", never "0", so it never reads as a failed search. */
function SpecialUnitSummary({
  unitNumber,
  subjectFacts,
  indication,
  competitorCount,
  coverage,
}: {
  unitNumber: SpecialUnitNumber | null;
  subjectFacts: SpecialUnitSubjectFacts | null;
  indication: SpecialUnitIndication | null;
  competitorCount: number;
  coverage: SpecialUnitMapCoverage | null;
}) {
  if (unitNumber == null) return null;
  const soldLane = indication?.lanes.sold;
  const askingLane = indication?.lanes.current_asking;
  const totalMapped = (coverage?.soldMappedCount ?? 0) + (coverage?.askingMappedCount ?? 0);
  const totalBasket = (coverage?.soldTotalCount ?? 0) + (coverage?.askingTotalCount ?? 0);

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-sm font-bold text-slate-900">
        דירה {unitNumber}
        {subjectFacts && ` — ${subjectFacts.categoryLabel}${subjectFacts.rooms != null ? ` | ${subjectFacts.rooms} חדרים` : ""}`}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-600">
        <span>
          אינדיקציית שוק:{" "}
          <span className="font-semibold text-slate-800">
            {indication?.suggested_price_ils != null ? ils(indication.suggested_price_ils) : "אין אינדיקציה כמותית"}
          </span>
        </span>
        {indication?.suggested_price_ils != null && (
          <span className={`rounded px-1.5 py-0.5 font-medium ${CONFIDENCE_COLORS[indication.confidence] ?? "bg-slate-100 text-slate-600"}`}>
            רמת ביטחון {CONFIDENCE_LABELS[indication.confidence] ?? indication.confidence}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
        <SpecialLaneCount label="עסקאות משתתפות" count={soldLane ? soldLane.comps_used.length : null} />
        <SpecialLaneCount label="מודעות משתתפות" count={askingLane ? askingLane.comps_used.length : null} />
        <span>
          <span className="font-semibold text-slate-800">{competitorCount}</span> פרויקטים/הקשר
        </span>
      </div>
      {coverage && totalMapped < totalBasket && (
        <div className="mt-1 text-xs font-medium text-amber-700">
          {totalMapped} מתוך {totalBasket} ראיות ממופות
        </div>
      )}
    </div>
  );
}

function SpecialLaneCount({ label, count }: { label: string; count: number | null }) {
  if (count == null) return <span className="text-slate-400">אין ראיה כמותית — {label}</span>;
  return (
    <span>
      <span className="font-semibold text-slate-800">{count}</span> {label}
    </span>
  );
}

function HoverContent({ point }: { point: MarketMapPoint }) {
  // Special points carry no family ("3R"/"5R") -- they belong to one
  // specific unit instead; roomsLabel falls back to the evidence's own
  // rooms count (or nothing) rather than ever guessing a family.
  const roomsLabel = point.family === "3R" ? "3 חדרים" : point.family === "5R" ? "5 חדרים" : point.rooms != null ? `${num(point.rooms)} חדרים` : null;
  if (point.kind === "sold") {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold text-slate-900">{point.priceIls != null ? ils(point.priceIls) : "—"}</span>
        <span className="text-slate-500">
          {roomsLabel}
          {point.pricePerSqm != null && <> {roomsLabel && "·"} {ils(point.pricePerSqm)} למ״ר</>}
        </span>
      </div>
    );
  }
  if (point.kind === "asking") {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold text-slate-900">מבוקש {point.priceIls != null ? ils(point.priceIls) : "—"}</span>
        <span className="text-slate-500">
          {roomsLabel}
          {point.internalArea != null && <> {roomsLabel && "·"} {num(point.internalArea)} מ״ר</>}
        </span>
      </div>
    );
  }
  if (point.kind === "competitor") {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold text-slate-900">{point.title}</span>
        <span className="text-slate-500">פרויקט מתחרה{point.priceIls != null && <> · {point.priceBasis === "starting_price" ? "החל מ־" : ""}{ils(point.priceIls)}</>}</span>
      </div>
    );
  }
  return <span className="font-semibold text-slate-900">{point.title}</span>;
}

function DetailPanel({
  point,
  workspace,
  family,
  onClose,
}: {
  point: MarketMapPoint;
  workspace: PetahTikvaWorkspace;
  family: MarketMapFamily;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">{point.title}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          ✕
        </button>
      </div>

      {point.kind === "sold" && <SoldDetail point={point} workspace={workspace} />}
      {point.kind === "asking" && <AskingDetail point={point} workspace={workspace} />}
      {point.kind === "competitor" && <CompetitorDetail point={point} workspace={workspace} family={family} />}
      {point.kind === "project_area" && (
        <p className="text-xs text-slate-500">
          המיקום מסמן את אזור ההדגמה. כתובת מדויקת לא סופקה במסגרת המטלה.
        </p>
      )}

      <PrecisionNote point={point} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (value == null) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}

/** Universal, top-of-panel pricing-participation status (feedback item 6) --
 * every selected point, of every kind, shows this in the same place with
 * the same visual language, so the methodology is visible through
 * interaction instead of needing to be explained separately. */
function ParticipationBadge({ contributes, contributingLabel, contextLabel }: { contributes: boolean; contributingLabel: string; contextLabel: string }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${
        contributes ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-500"
      }`}
    >
      <span>{contributes ? "✓" : "–"}</span>
      <span>{contributes ? contributingLabel : contextLabel}</span>
    </div>
  );
}

const SPECIAL_STATUS_LABELS: Record<"participating" | "context_only" | "excluded", string> = {
  participating: "משתתף בחישוב",
  context_only: "מידע להקשר בלבד — אינו משתתף בחישוב",
  // Explicitly states "did not participate" alongside "removed from the
  // comparison basket" -- a viewer must never read this status as merely
  // "unused" without also seeing the plain non-participation statement.
  excluded: "הוצא מסל ההשוואה — לא השתתף בחישוב",
};

/** Three-state participation status for special-unit evidence (task item
 * 6) -- distinct from the standard binary ParticipationBadge above, since a
 * special basket has a real third state (excluded entirely, with a reason)
 * that a standard family's contributesToPricing boolean doesn't capture. */
function SpecialParticipationBadge({ status, reason }: { status: "participating" | "context_only" | "excluded"; reason?: string }) {
  const styles =
    status === "participating"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : status === "context_only"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-slate-300 bg-slate-100 text-slate-500";
  const icon = status === "participating" ? "✓" : status === "context_only" ? "–" : "✕";
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${styles}`}>
        <span>{icon}</span>
        <span>{SPECIAL_STATUS_LABELS[status]}</span>
      </div>
      {status === "excluded" && reason && <p className="text-[11px] text-slate-400">{reason}</p>}
    </div>
  );
}

const SPECIAL_TIER_LABELS: Record<string, string> = {
  tier_a_direct: "השוואה ישירה",
  tier_b_size_relaxed: "השוואה ישירה — הרחבת גודל/סוג לא מאומת",
  tier_c_broadened: "השוואת הקשר — טיפוס שונה",
};

/** "למה הראיה רלוונטית לדירה X?" (task item 11) -- only real, already-known
 * facts: the evidence kind, its own tier classification (straight from
 * pricing_core.special_market_indication), and a qualitative area
 * comparison (never a numeric premium -- see item 13). No generated
 * similarity score, ever. */
function SpecialRelevanceSection({ point, workspace }: { point: MarketMapPoint; workspace: PetahTikvaWorkspace }) {
  if (point.specialUnitNumber == null) return null;
  const subject = deriveSpecialUnitSubjectFacts(workspace, point.specialUnitNumber);

  const bullets: string[] = [];
  if (point.kind === "sold") bullets.push("ראיה מסוג עסקה שהושלמה");
  if (point.kind === "asking") bullets.push("ראיה מסוג הצעה נוכחית");
  if (point.kind === "competitor") bullets.push("פרויקט חדש מתחרה");
  if (point.specialTierLabel) bullets.push(SPECIAL_TIER_LABELS[point.specialTierLabel] ?? point.specialTierLabel);
  if (subject?.internalArea != null && point.internalArea != null) {
    const diffPct = (point.internalArea - subject.internalArea) / subject.internalArea;
    if (Math.abs(diffPct) <= 0.15) bullets.push("שטח דומה לדירה שלנו");
    else if (diffPct < 0) bullets.push("שטח קטן משמעותית מהדירה שלנו");
    else bullets.push("שטח גדול משמעותית מהדירה שלנו");
  }
  if (point.specialStatus === "context_only") bullets.push("הקשר בלבד");

  return (
    <>
      {bullets.length > 0 && (
        <div className="rounded-md bg-slate-50 p-2">
          <div className="text-[11px] font-semibold text-slate-500">למה הראיה רלוונטית לדירה {point.specialUnitNumber}?</div>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-slate-700">
            {bullets.map((b, i) => (
              <li key={i}>• {b}</li>
            ))}
          </ul>
        </div>
      )}
      {subject && <SpecialComparisonTable subject={subject} point={point} />}
    </>
  );
}

/** Subject-vs-evidence factual comparison table (task item 12) -- "—" for
 * anything not known, never "אין" (which would read as "there is none" --
 * see item 12's explicit instruction). No monetary interpretation of any
 * difference shown here (item 13). */
function SpecialComparisonTable({ subject, point }: { subject: SpecialUnitSubjectFacts; point: MarketMapPoint }) {
  const dash = "—";
  const rows: { label: string; subjectValue: string; evidenceValue: string }[] = [
    { label: "סוג", subjectValue: subject.categoryLabel, evidenceValue: point.specialEvidenceType ?? dash },
    { label: "חדרים", subjectValue: subject.rooms != null ? String(subject.rooms) : dash, evidenceValue: point.rooms != null ? num(point.rooms) : dash },
    {
      label: "שטח פנים",
      subjectValue: subject.internalArea != null ? num(subject.internalArea) : dash,
      evidenceValue: point.internalArea != null ? num(point.internalArea) : dash,
    },
    { label: "שטח חוץ", subjectValue: subject.outdoorArea != null ? num(subject.outdoorArea) : dash, evidenceValue: dash },
    { label: "קומות", subjectValue: subject.floor != null ? String(subject.floor) : dash, evidenceValue: point.floor != null ? String(point.floor) : dash },
  ];

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-2 py-1 text-start font-medium" />
            <th className="px-2 py-1 text-start font-medium">דירה {subject.unitNumber}</th>
            <th className="px-2 py-1 text-start font-medium">הראיה</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-2 py-1 text-slate-500">{r.label}</td>
              <td className="px-2 py-1 font-medium text-slate-800">{r.subjectValue}</td>
              <td className="px-2 py-1 font-medium text-slate-800">{r.evidenceValue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SoldDetail({ point, workspace }: { point: MarketMapPoint; workspace: PetahTikvaWorkspace }) {
  const familyLabel = point.family === "3R" ? "3 חדרים" : point.family === "5R" ? "5 חדרים" : "";
  const isSpecial = point.specialUnitNumber != null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="w-fit rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">עסקה שבוצעה</span>
      {isSpecial ? (
        <SpecialParticipationBadge status={point.specialStatus ?? "context_only"} reason={point.specialStatusReason} />
      ) : (
        <ParticipationBadge contributes={point.contributesToPricing} contributingLabel={`משתתפת בחישוב ${familyLabel}`} contextLabel="מידע להקשר בלבד — אינה משתתפת בחישוב" />
      )}
      {point.transactionCount != null && point.transactionCount > 1 && (
        <span className="text-xs text-slate-500">{point.transactionCount} עסקאות בכתובת זו</span>
      )}
      <Fact label="כתובת" value={point.address} />
      <Fact label="חדרים" value={familyLabel || (point.rooms != null ? num(point.rooms) : undefined)} />
      <Fact label="שטח" value={point.internalArea != null ? `${num(point.internalArea)} מ״ר` : undefined} />
      <Fact label="מחיר" value={point.priceIls != null ? ils(point.priceIls) : undefined} />
      <Fact label="מחיר למ״ר" value={point.pricePerSqm != null ? `${ils(point.pricePerSqm)} למ״ר` : undefined} />
      <Fact label="תאריך" value={point.date} />
      <Fact label="מקור" value="רשות המסים (נתוני עסקאות)" />
      {point.transactions && point.transactions.length > 1 && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-slate-500 underline">כל העסקאות בכתובת זו</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {point.transactions.map((t, i) => (
              <li key={i} className="text-slate-600">
                {ils(t.priceIls)} · {num(t.area)} מ״ר · {t.date}
              </li>
            ))}
          </ul>
        </details>
      )}
      {isSpecial && <SpecialRelevanceSection point={point} workspace={workspace} />}
    </div>
  );
}

function AskingDetail({ point, workspace }: { point: MarketMapPoint; workspace: PetahTikvaWorkspace }) {
  const isSpecial = point.specialUnitNumber != null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="w-fit rounded bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800">דירה מוצעת למכירה</span>
      {isSpecial ? (
        <SpecialParticipationBadge status={point.specialStatus ?? "context_only"} reason={point.specialStatusReason} />
      ) : (
        <ParticipationBadge contributes={point.contributesToPricing} contributingLabel="משתתפת בחישוב" contextLabel="מידע להקשר בלבד — אינה משתתפת בחישוב" />
      )}
      <Fact label="כתובת" value={point.address} />
      <Fact label="חדרים" value={point.rooms != null ? num(point.rooms) : undefined} />
      <Fact label="שטח" value={point.internalArea != null ? `${num(point.internalArea)} מ״ר` : undefined} />
      <Fact label="קומה" value={point.floor != null ? String(point.floor) : undefined} />
      <Fact label="מחיר מבוקש" value={point.priceIls != null ? ils(point.priceIls) : undefined} />
      <Fact label="מחיר למ״ר" value={point.pricePerSqm != null ? `${ils(point.pricePerSqm)} למ״ר` : undefined} />
      <Fact label="מרפסת" value={point.hasBalcony == null ? undefined : point.hasBalcony ? "יש" : "אין"} />
      <Fact label="חניה" value={point.parkingCount != null ? String(point.parkingCount) : undefined} />
      <Fact label="מעלית" value={point.hasElevator == null ? undefined : point.hasElevator ? "יש" : "אין"} />
      <Fact label="ממ״ד" value={point.hasSecureRoom == null ? undefined : point.hasSecureRoom ? "יש" : "אין"} />
      <Fact label="מצב" value={point.condition} />
      <Fact label="תאריך פרסום" value={point.date} />
      {point.sourceUrl ? (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-slate-500">מקור</span>
          <a href={point.sourceUrl} target="_blank" rel="noreferrer" className="font-medium text-blue-700 underline">
            מדלן ↗
          </a>
        </div>
      ) : (
        <Fact label="מקור" value="מדלן" />
      )}
      {point.exclusionReason && <p className="text-[11px] text-slate-400">לא נכללה בחישוב: {point.exclusionReason}</p>}
      {isSpecial && <SpecialRelevanceSection point={point} workspace={workspace} />}
    </div>
  );
}

function CompetitorDetail({ point, workspace, family }: { point: MarketMapPoint; workspace: PetahTikvaWorkspace; family: MarketMapFamily }) {
  const fact = point.fact;
  const isSpecial = point.specialUnitNumber != null;
  const classificationLabel = point.classification === "direct" ? "תחרות ישירה" : point.classification === "relevant" ? "תחרות רלוונטית" : "הקשר שוק";
  const geoLabel = point.geographyRole === "core" ? "אותו תת־שוק" : point.geographyRole === "adjacent" ? "אזור סמוך" : "הקשר רחב";
  const project = workspace.competitor_landscape.projects.find((p) => p.project_name === point.title);
  const eligibility = project?.quantitative_eligibility as Record<string, { eligible: boolean }> | undefined;
  const eligible = eligibility?.[family === "3R" ? "standard_3r" : "standard_5r"]?.eligible ?? false;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="w-fit rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">{classificationLabel}</span>
        <span className="text-[11px] text-slate-400">{point.address ? point.address.split(",")[1]?.trim() || point.address : ""}</span>
      </div>
      {isSpecial ? (
        <SpecialParticipationBadge status={point.specialStatus ?? "context_only"} reason={point.specialStatusReason} />
      ) : (
        <ParticipationBadge
          contributes={eligible}
          contributingLabel="משתתף בחישוב (משפחה נבחרת)"
          contextLabel="מידע להקשר בלבד — אינו משתתף בחישוב (משפחה נבחרת)"
        />
      )}

      {point.highlights != null && point.highlights.length > 0 && (
        <div className="rounded-md bg-slate-50 p-2">
          <div className="text-[11px] font-semibold text-slate-500">מה בולט מול הפרויקט שלנו?</div>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-slate-700">
            {point.highlights.map((h, i) => (
              <li key={i}>• {h}</li>
            ))}
          </ul>
        </div>
      )}

      <Fact label="יזם" value={fact?.developer ?? "לא פורסם"} />
      <Fact label="מוצרים" value={fact?.productMix ?? "לא פורסם"} />
      <Fact label="מחיר" value={fact?.priceLabel ?? "לא פורסם"} />
      {fact?.priceLabel && (
        <p className="text-[11px] text-slate-400">{fact.isStartingPriceOnly ? "מחיר התחלתי בפרויקט — לא מחיר דירה ספציפית" : "מחיר דירה ספציפית"}</p>
      )}
      <Fact label="תנאי תשלום" value={fact?.paymentTerms ?? "לא פורסם"} />
      <Fact label="מסירה" value={fact?.delivery ?? "לא פורסם"} />
      <Fact label="שלב הפרויקט" value={fact?.status ?? "לא פורסם"} />

      {isSpecial ? (
        <SpecialRelevanceSection point={point} workspace={workspace} />
      ) : (
        <div className="mt-1 rounded-md bg-slate-50 p-2">
          <div className="text-[11px] font-semibold text-slate-500">למה זה רלוונטי?</div>
          <p className="text-xs text-slate-600">
            {geoLabel}
            {point.relevanceTags != null && point.relevanceTags.length > 0 && <> · {point.relevanceTags.join(" · ")}</>}
          </p>
        </div>
      )}

      <button
        onClick={() => document.getElementById("competitor-map-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        className="mt-1 w-fit text-xs text-slate-500 underline hover:text-slate-800"
      >
        פתח השוואה מלאה
      </button>
    </div>
  );
}

function PrecisionNote({ point }: { point: MarketMapPoint }) {
  if (point.kind === "project_area") return null;
  const label =
    point.coordinatePrecision === "address" ? "מיקום לפי כתובת" : point.coordinatePrecision === "street" ? "מיקום משוער לפי רחוב" : "מיקום משוער";
  return <p className="text-[10px] text-slate-300">{label}</p>;
}

// Larger, higher-contrast, presentation-legible legend (feedback item 9) --
// shape distinction between the four kinds is the point, so symbols are
// sized up rather than relying on color alone.
function MapLegend({ ppsmDomain }: { ppsmDomain: [number, number] | undefined | null }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <LegendItem symbol="★" color={COLORS.project_area} label="אזור הפרויקט" />
        <LegendItem symbol="●" color={COLORS.sold} label="עסקה שבוצעה" />
        <LegendItem symbol="○" color={COLORS.asking} label="דירה מוצעת" outline />
        <LegendItem symbol="◆" color={COLORS.competitor_direct} label="מתחרה ישיר" />
        <LegendItem symbol="◇" color={COLORS.competitor_other} label="מתחרה רלוונטי" outline />
      </div>
      {/* Explains the ₪X K price-per-sqm labels that appear on individual
          points at close zoom, so a first-time viewer doesn't mistake them
          for a count or an id (feedback item 7). */}
      <div className="text-xs text-slate-500">לדוגמה: 26K = ₪26,000 למ״ר (מוצג על נקודות בודדות בזום קרוב)</div>
      {ppsmDomain && (
        <span className="flex items-center gap-2 text-xs">
          <span className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(to left, #c2543a, #f4d35e, #7fb3d5)" }} />
          <span>
            {ils(ppsmDomain[0])} ─── {ils(ppsmDomain[1])} למ״ר
          </span>
        </span>
      )}
    </div>
  );
}

function LegendItem({ symbol, color, label, outline }: { symbol: string; color: string; label: string; outline?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="w-4 text-center text-base leading-none" style={{ color: outline ? undefined : color, WebkitTextStroke: outline ? `1.5px ${color}` : undefined }}>
        {symbol}
      </span>
      {label}
    </span>
  );
}
