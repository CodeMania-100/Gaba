// Regression tests for "exclusion-reason tokens": groupExclusionReason
// previously translated only Petah Tikva's own prose-style reasons -- every
// multi-city machine token (qa_status_excluded:X, price_type_not_
// quantitative:X, numeric_status=X, numeric_completeness_failed) collapsed
// to the generic "סיבה טכנית אחרת" fallback, even though the underlying
// token vocabulary is finite and was already fully observed across all four
// market contexts.

import { describe, expect, it } from "vitest";
import { groupExclusionReason } from "./specialUnitDecision";

describe("groupExclusionReason -- multi-city machine tokens (P0 fix)", () => {
  it("translates every known qa_status_excluded:X suffix", () => {
    expect(groupExclusionReason("qa_status_excluded:CONFLICT", "duplex", "דופלקס")).toBe("קונפליקט בין מקורות נתונים");
    expect(groupExclusionReason("qa_status_excluded:CONTEXT_ONLY", "duplex", "דופלקס")).toBe("נשמר כהקשר בלבד, לא לשימוש כמותי");
    expect(groupExclusionReason("qa_status_excluded:HISTORICAL_CONTEXT", "duplex", "דופלקס")).toBe("הקשר היסטורי בלבד");
    expect(groupExclusionReason("qa_status_excluded:HISTORICAL_MARKETING_CONTEXT", "duplex", "דופלקס")).toBe("הקשר שיווקי היסטורי בלבד");
  });

  it("translates every known price_type_not_quantitative:X suffix", () => {
    expect(groupExclusionReason("price_type_not_quantitative:STARTING_PRICE", "garden", "דירת גן")).toBe(
      "מחיר התחלתי בלבד, לא מחיר יחידה מדויק"
    );
    expect(groupExclusionReason("price_type_not_quantitative:CONTEXT_ONLY", "garden", "דירת גן")).toBe("מחיר הקשר בלבד, לא לשימוש כמותי");
    expect(groupExclusionReason("price_type_not_quantitative:HISTORICAL_MARKETING_PRICE", "garden", "דירת גן")).toBe("מחיר שיווקי היסטורי");
  });

  it("translates numeric_status=context_only_excluded, with or without its real trailing text", () => {
    expect(groupExclusionReason("numeric_status=context_only_excluded -- excluded from numeric use", "triplex", "טריפלקס")).toBe(
      "נשמר כהקשר בלבד, לא לשימוש כמותי"
    );
    expect(groupExclusionReason("numeric_status=context_only_excluded", "triplex", "טריפלקס")).toBe("נשמר כהקשר בלבד, לא לשימוש כמותי");
  });

  it("numeric_status=quarantined_price_conflict still resolves via the existing price_conflict rule (no duplicate path)", () => {
    expect(groupExclusionReason("numeric_status=quarantined_price_conflict -- excluded from numeric use", "duplex", "דופלקס")).toBe(
      "סתירת מחיר בין מקורות"
    );
  });

  it("translates the standalone numeric_completeness_failed token", () => {
    expect(groupExclusionReason("numeric_completeness_failed", "garden", "דירת גן")).toBe("חוסר נתונים כמותיים מלאים");
  });

  it("translates the one fixed, byte-identical free-text reason confirmed across all four contexts", () => {
    expect(
      groupExclusionReason(
        "unit-specific price found but no matching floorplan area could be joined -- excluded from area-normalized calculation",
        "garden",
        "דירת גן"
      )
    ).toBe("לא נמצאה התאמה בין מחיר הדירה לשטח הידוע");
  });

  it("an unrecognized suffix within a known token family still falls back to the generic label, never guessed", () => {
    expect(groupExclusionReason("qa_status_excluded:SOME_FUTURE_TOKEN", "duplex", "דופלקס")).toBe("סיבה טכנית אחרת (ראו פירוט מלא)");
    expect(groupExclusionReason("price_type_not_quantitative:SOME_FUTURE_TOKEN", "duplex", "דופלקס")).toBe("סיבה טכנית אחרת (ראו פירוט מלא)");
  });

  it("a genuinely unknown, free-varying prose reason still falls back to the generic label (never keyword-guessed)", () => {
    expect(
      groupExclusionReason(
        "matching floorplan known (rooms=5, area=148 m²) but no unit-specific price published -- project_start_price (none published) is competitive context only, never used numerically",
        "duplex",
        "דופלקס"
      )
    ).toBe("סיבה טכנית אחרת (ראו פירוט מלא)");
  });

  it("pre-existing prose-based rules (property_form_conflict, cottage, triplex-vs-duplex, no verified) are unchanged", () => {
    expect(groupExclusionReason("Verified property_form_conflict: cottage form", "duplex", "דופלקס")).toBe("סוג הנכס אינו מתאים לדופלקס");
    expect(groupExclusionReason("Tax Authority classifies as cottage/single-family", "duplex", "דופלקס")).toBe("נכס פרטי / קוטג׳");
    expect(groupExclusionReason("identifies this transaction as triplex", "duplex", "דופלקס")).toBe("טריפלקס במקום דופלקס");
    expect(groupExclusionReason("no verified direct evidence", "garden", "דירת גן")).toBe("אין עדות ישירה מספקת");
  });
});
