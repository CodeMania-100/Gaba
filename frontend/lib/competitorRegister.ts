// Presentation helpers for the competitor register/map (see
// app_api/competitor_register.py build_competitor_landscape). Pure
// derivation from fields the payload already has -- no new pricing/valuation
// math, no invented values. Every function returns null/empty when the
// underlying field is missing so the UI can skip rendering it rather than
// showing "unknown".

import { CompetitorRegisterProject } from "./api";
import { ils, num } from "./format";
import { paymentTermsLabel as translatePaymentTerms } from "./standardEnrichment";

export type CompetitorFilterGroup = "all" | "direct" | "relevant" | "context";
export type CompetitorFamilyFilter = "all" | "standard_3r" | "standard_5r" | "garden" | "duplex_penthouse" | "large_premium";

export const CLASSIFICATION_LABELS: Record<"direct" | "relevant" | "context", string> = {
  direct: "תחרות ישירה",
  relevant: "תחרות רלוונטית",
  context: "הקשר שוק / מוצרי פרימיום",
};

export const CLASSIFICATION_COLORS: Record<"direct" | "relevant" | "context", string> = {
  direct: "bg-emerald-100 text-emerald-800",
  relevant: "bg-amber-100 text-amber-900",
  context: "bg-slate-200 text-slate-700",
};

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  standard_apartment: "דירות רגילות",
  garden_apartment: "דירות גן",
  duplex: "דופלקס",
  triplex: "טריפלקס",
  penthouse: "פנטהאוז",
  penthouse_roof: "פנטהאוז גג",
  roof_duplex: "דופלקס גג",
  // The multi-city register's own product_types vocabulary (see
  // special_full_v2/competitor_projects_v2.json) -- additive only.
  standard_apartments: "דירות רגילות",
  garden: "דירות גן",
  garden_duplex: "דופלקס גן",
  large_apartment: "יחידות גדולות",
};

export function productTypesLabel(project: CompetitorRegisterProject): string | null {
  const types = (project.product_types as string[] | undefined) ?? [];
  if (types.length === 0) return null;
  return types.map((t) => PRODUCT_TYPE_LABELS[t] ?? t).join(" · ");
}

export function roomRangeLabel(project: CompetitorRegisterProject): string | null {
  const range = project.room_range as [number, number] | null | undefined;
  if (!range) return null;
  const [lo, hi] = range;
  return lo === hi ? `${num(lo)} חדרים` : `${num(lo)}–${num(hi)} חדרים`;
}

export function areaRangeLabel(project: CompetitorRegisterProject): string | null {
  const range = project.area_sqm_range as [number, number] | null | undefined;
  if (!range) return null;
  const [lo, hi] = range;
  return `${num(lo)}–${num(hi)} מ״ר`;
}

export function floorRangeLabel(project: CompetitorRegisterProject): string | null {
  const range = project.floors_range as [number, number] | null | undefined;
  if (!range) return null;
  const [lo, hi] = range;
  return lo === hi ? `קומה ${num(lo)}` : `קומות ${num(lo)}–${num(hi)}`;
}

/** Price display only from fields that already exist: exact known-unit-variant
 * prices (as a range if they differ), or a project-level starting price.
 * Never averages/estimates -- if nothing priced is known, returns null and
 * the row is hidden. */
export function priceDisplayLabel(project: CompetitorRegisterProject): string | null {
  const variants = (project.known_unit_variants as { price_ils?: number | null; price_basis?: string }[] | undefined) ?? [];
  const priced = variants.filter((v) => v.price_ils != null);
  const anyStarting = priced.some((v) => v.price_basis === "starting price");
  if (priced.length > 0) {
    const prices = priced.map((v) => v.price_ils as number);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const prefix = anyStarting ? "החל מ־" : "";
    return min === max ? `${prefix}${ils(min)}` : `${prefix}${ils(min)}–${ils(max)}`;
  }
  const projectFrom = project.project_price_from_ils as number | null | undefined;
  if (projectFrom != null) return `החל מ־${ils(projectFrom)}`;
  return null;
}

/** One standout, already-verified product feature, in a fixed priority order
 * -- never a scored/weighted pick. Returns null when nothing verified is
 * present so the card can omit the row entirely rather than show a guess. */
export function standoutFeatureLabel(project: CompetitorRegisterProject): string | null {
  const relevance = (project.relevance as string[] | undefined) ?? [];
  if (relevance.includes("garden") && project.garden) return "כולל דירות גן";
  if ((relevance.includes("duplex") || relevance.includes("penthouse")) && project.product_types) {
    if ((project.product_types as string[]).some((t) => t.includes("duplex") || t.includes("penthouse"))) {
      return "כולל דופלקס/פנטהאוז";
    }
  }
  if (project.parking) return "חניה מאומתת";
  if (project.storage) return "מחסן מאומת";
  if (project.balcony) return "מרפסת מאומתת";
  if (project.mamad) return "ממ״ד מאומת";
  if (project.payment_terms) return "תנאי תשלום מיוחדים";
  return null;
}

export function paymentTermsLabel(project: CompetitorRegisterProject): string | null {
  const pt = project.payment_terms as { value?: string } | null | undefined;
  return translatePaymentTerms(pt?.value ?? null);
}

/** Verified developer/company name for this competing project, or null when
 * the register genuinely has none -- the card must show "לא פורסם" rather
 * than omit the row silently or invent a name (see task item 11). */
export function developerLabel(project: CompetitorRegisterProject): string | null {
  return (project.developer as string | null | undefined) ?? null;
}

export function matchesFamilyFilter(project: CompetitorRegisterProject, filter: CompetitorFamilyFilter): boolean {
  if (filter === "all") return true;
  const relevance = (project.relevance as string[] | undefined) ?? [];
  if (filter === "duplex_penthouse") return relevance.includes("duplex") || relevance.includes("penthouse");
  return relevance.includes(filter);
}

/** Fuzzy-matches a decision-board competitor project name (from the strict
 * new_development evidence records, e.g. "זאב ברנדה" or "רוטשילד 163-165")
 * to its richer register entry (e.g. "זאב ברנדה 22" / "רוטשילד 163–165").
 * Both sides are stripped of a trailing "<number(-number)>" address/unit
 * suffix and compared; falls back to exact/substring match. Returns
 * undefined rather than guessing when nothing lines up. */
export function matchRegisterProject(
  evidenceProjectName: string,
  registerProjects: CompetitorRegisterProject[]
): CompetitorRegisterProject | undefined {
  const strip = (s: string) => s.replace(/[\s–—-]+\d+(?:[–—-]\d+)?\s*$/u, "").trim();
  const target = strip(evidenceProjectName);

  const exact = registerProjects.find((p) => p.project_name === evidenceProjectName);
  if (exact) return exact;

  const byStrippedName = registerProjects.find((p) => strip(p.project_name) === target);
  if (byStrippedName) return byStrippedName;

  return registerProjects.find(
    (p) => p.project_name.includes(evidenceProjectName) || evidenceProjectName.includes(strip(p.project_name))
  );
}
