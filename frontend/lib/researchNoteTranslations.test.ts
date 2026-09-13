import { describe, expect, it } from "vitest";
import { translateResearchNote } from "./researchNoteTranslations";

describe("translateResearchNote", () => {
  it("maps every known research-gap/note/match-basis/QA-flag string to Hebrew", () => {
    const known = [
      "No defensible current public new-development pair was found with same project + same rooms + same/similar area + same property type + different floors + both floor-specific prices published.",
      "Most public Yad1 project tables expose one 'from' price across a floor range, which is not enough to infer a floor relationship.",
      "Many current Yad2 listing cards do not expose balcony size, storage, elevator or exact cardinal orientation; those fields remain null unless an exact matching mirror/detail page verified them.",
      "The standard 3R subject's 12 m² balcony has especially strong product-attribute analogues in developer floorplans, but no matched model-specific price pair was found.",
      "The standard 5R subject has excellent 112-114 m² + 12 m² balcony + orientation floorplan evidence at Rothschild 163-165, but prices are only published as a general 5R starting price.",
      "Public project pages often publish one 'from' price across a floor range, not a per-floor price ladder. Such floor-range marketing lines were not converted into matched price pairs.",
      "same address, rooms and registered area; transactions four days apart; distinct subparcels",
      "same address, rooms and area; different floors",
      "same address, same day, same rooms and registered area; distinct subparcels",
      "Dirobot area conflict on floor-1 record -- local direct Tax + Market2 report 120m²; Dirobot reports 88m². The direct Tax Authority figure is kept as the primary source; the conflict remains visible rather than silently resolved.",
    ];
    for (const raw of known) {
      const translated = translateResearchNote(raw);
      expect(translated).not.toBeNull();
      // No mapped Hebrew string should ever contain the raw English prose it
      // was derived from -- the whole point is the reader never sees it.
      expect(translated).not.toBe(raw);
      expect(/^[a-zA-Z]/.test(translated!.trim())).toBe(false);
    }
  });

  it("never prints raw English for an unrecognized string -- falls back to a short generic Hebrew line", () => {
    const unknown = "Some brand-new English sentence never seen before in the dataset.";
    const translated = translateResearchNote(unknown);
    expect(translated).not.toBe(unknown);
    expect(translated).not.toContain(unknown);
    expect(/^[a-zA-Z]/.test(translated!.trim())).toBe(false);
  });

  it("returns null for empty/missing input rather than an empty Hebrew line", () => {
    expect(translateResearchNote(null)).toBeNull();
    expect(translateResearchNote(undefined)).toBeNull();
    expect(translateResearchNote("")).toBeNull();
  });
});
