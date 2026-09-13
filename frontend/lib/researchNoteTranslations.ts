// Short, factual Hebrew equivalents for the known English research-note
// sentences baked into the frozen standard_attribute_enrichment dataset
// (data/frozen/standard_unit_attribute_enrichment_v1.json) -- the dataset
// itself, and its raw English wording, are never touched; this only changes
// how a small, exhaustively-enumerated set of sentences is *displayed* in
// the normal Marketing flow. Deliberately not literal word-for-word
// translations -- each entry keeps only the factual meaning a Marketing
// reader needs, matching the concise tone already used everywhere else in
// this product. Confirmed exhaustive across all four market contexts (only
// Petah Tikva's enrichment currently carries these fields) by reading the
// live workspace payload directly, not just the source file.
//
// Anything not in this dictionary falls back to a short, honest, generic
// Hebrew line rather than ever printing raw English prose in the normal
// three-tab flow -- never a fabricated Hebrew guess at an unrecognized
// sentence's meaning.

const RESEARCH_NOTE_TRANSLATIONS: Record<string, string> = {
  // fam.research_gaps
  "No defensible current public new-development pair was found with same project + same rooms + same/similar area + same property type + different floors + both floor-specific prices published.":
    "לא נמצא בפרויקט חדש מחיר פומבי מאומת המשויך לדירה תואמת.",
  "Most public Yad1 project tables expose one 'from' price across a floor range, which is not enough to infer a floor relationship.":
    'בטבלאות ציבוריות רבות מוצג מחיר "החל מ-" בלבד, ללא התאמה לדגם דירה מסוים.',
  "Many current Yad2 listing cards do not expose balcony size, storage, elevator or exact cardinal orientation; those fields remain null unless an exact matching mirror/detail page verified them.":
    "בחלק מהמודעות חסרים פרטי מרפסת, מחסן, מעלית או כיוון אוויר.",
  "The standard 3R subject's 12 m² balcony has especially strong product-attribute analogues in developer floorplans, but no matched model-specific price pair was found.":
    "נמצאו דירות דומות במאפייני המוצר, אך ללא צמד מחיר–דגם מאומת.",
  "The standard 5R subject has excellent 112-114 m² + 12 m² balcony + orientation floorplan evidence at Rothschild 163-165, but prices are only published as a general 5R starting price.":
    "נמצאו נתוני מוצר חזקים בפרויקט מתחרה, אך המחיר המפורסם הוא מחיר התחלתי כללי ולא מחיר דגם מאומת.",

  // enrichment.new_development_floor_pair_search.note
  "Public project pages often publish one 'from' price across a floor range, not a per-floor price ladder. Such floor-range marketing lines were not converted into matched price pairs.":
    'מחיר "החל מ-" אינו משויך בהכרח לדירה ספציפית ולכן אינו משמש כמחיר יחידה מאומת.',

  // floor_observations[].match_basis (StandardFeatureFindings' "הצג ראיות")
  "same address, rooms and registered area; transactions four days apart; distinct subparcels":
    "אותה כתובת, חדרים ושטח רשום; העסקאות בהפרש של 4 ימים; תת-חלקות שונות.",
  "same address, rooms and area; different floors": "אותה כתובת, חדרים ושטח; קומות שונות.",
  "same address, same day, same rooms and registered area; distinct subparcels":
    "אותה כתובת ואותו יום; חדרים ושטח רשום זהים; תת-חלקות שונות.",

  // floor_observations[].data_quality_flag
  "Dirobot area conflict on floor-1 record -- local direct Tax + Market2 report 120m²; Dirobot reports 88m². The direct Tax Authority figure is kept as the primary source; the conflict remains visible rather than silently resolved.":
    "אי-התאמה בין מקורות לגבי שטח הדירה בקומה 1 — הנתון ממיסוי מקרקעין (120 מ״ר) משמש כמקור הראשי; הפער מוצג ולא מוסתר.",

  // special_unit_market_context first_researcher_context[].why_relevant
  // (the historical duplex context record shown for unit 38)
  "Direct 7R duplex at near-subject internal size (180m² vs Apt38's 170.1m²) with a separately reported outdoor/terrace component -- structurally the closest direct-type match found for Apt38.":
    "דופלקס 7 חדרים בשטח פנימי דומה לדירה 38, עם שטח חוץ מדווח בנפרד — ההתאמה המבנית הקרובה ביותר שנמצאה עבור דירה זו.",

  // new_development_comparables[].starting_price_context.applies_to -- the
  // short parenthetical explaining what a competitor's published starting
  // price actually covers (rendered next to "מחיר התחלתי" in the product-
  // comparison cards).
  "3-room marketing line": "קו שיווק 3 חדרים",
  "3R floor-range marketing line": "קו שיווק 3 חדרים לפי טווח קומות",
  "5-room product": "מוצר 5 חדרים",
  "5-room apartments generally; not tied to a specific 112/114 m² model or floor":
    "מחיר כללי לדירות 5 חדרים — אינו משויך לדגם או לקומה ספציפיים",
  "5-room project marketing line; not tied to the 110 m² front or 113 m² rear model":
    "קו שיווק 5 חדרים בפרויקט — אינו משויך לדגם ספציפי",
  "latest observed Yad1 project starting price; not a model-specific 5R price":
    "מחיר התחלתי אחרון שנצפה בפרויקט — אינו מחיר דגם 5 חדרים ספציפי",
  "project / 5R marketing line": "קו שיווק 5 חדרים בפרויקט",
};

const GENERIC_FALLBACK = "הערת מחקר נוספת בשפת המקור — ראו פירוט מלא.";

/** Looks up a known research-note/gap/match-basis/QA-flag string and
 * returns its short Hebrew equivalent. Any string not in the dictionary
 * above (there is currently none in the live data) gets a short, honest
 * generic line instead of being printed as raw English -- never a
 * fabricated translation of text this function doesn't actually recognize. */
export function translateResearchNote(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  return RESEARCH_NOTE_TRANSLATIONS[raw] ?? GENERIC_FALLBACK;
}
