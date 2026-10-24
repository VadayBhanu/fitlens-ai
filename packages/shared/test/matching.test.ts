import { describe, expect, it } from "vitest";
import { isValidGtin, matchProducts, normalizeColor, normalizeSize, recommendOffer } from "../src/matching";

const source = { name: "Classic Black Denim Jacket", brand: "Northline", styleNumber: "NL-204", color: "Black", size: "M", gtin: "036000291452" };

describe("matchProducts", () => {
  it("treats a valid shared GTIN as exact", () => {
    const r = matchProducts(source, { name: "Denim jacket", gtin: "0036000291452", color: "blk", size: "Medium" });
    expect(r.status).toBe("exact");
  });

  it("treats brand + style + variant as exact", () => {
    const r = matchProducts({ ...source, gtin: null }, { name: "Northline jacket", brand: "NORTHLINE", styleNumber: "nl 204", color: "Jet Black", size: "m" });
    expect(r.status).toBe("exact");
  });

  it("never accepts a different size as exact", () => {
    const r = matchProducts(source, { name: source.name, brand: "Northline", styleNumber: "NL-204", color: "Black", size: "L", gtin: "036000291452" });
    expect(r.status).not.toBe("exact");
    expect(r.evidence.join(" ")).toMatch(/Size differs/);
  });

  it("never accepts a different color as exact", () => {
    const r = matchProducts({ ...source, gtin: null }, { name: source.name, brand: "Northline", styleNumber: "NL-204", color: "Navy", size: "M" });
    expect(r.status).not.toBe("exact");
  });

  it("downgrades a style match without variant confirmation to similar", () => {
    const r = matchProducts({ ...source, gtin: null }, { name: source.name, brand: "Northline", styleNumber: "NL-204" });
    expect(r.status).toBe("similar");
  });

  it("flags a different brand as mismatch", () => {
    const r = matchProducts(source, { name: "Classic Black Denim Jacket", brand: "OtherCo", styleNumber: "NL-204", color: "Black", size: "M" });
    expect(r.status).toBe("mismatch");
  });

  it("calls a lookalike similar, not exact", () => {
    const r = matchProducts({ ...source, gtin: null, styleNumber: null }, { name: "Classic Black Denim Jacket", brand: "Northline" });
    expect(r.status).toBe("similar");
  });
});

describe("normalizers", () => {
  it("validates GTIN check digits", () => {
    expect(isValidGtin("036000291452")).toBe(true);
    expect(isValidGtin("036000291453")).toBe(false);
  });
  it("maps colors and sizes", () => {
    expect(normalizeColor("Navy Blue")).toBe("blue");
    expect(normalizeColor("Heather Grey")).toBe("gray");
    expect(normalizeSize("Extra Large")).toBe("xl");
  });
});

describe("recommendOffer", () => {
  const exact = { status: "exact" as const, score: 1, evidence: [] };
  it("picks cheapest exact offer, ignoring similar ones", () => {
    const r = recommendOffer([
      { id: "a", total: { amountMinor: 7000, currency: "USD" }, available: true, returnPolicy: null, match: exact },
      { id: "b", total: { amountMinor: 6500, currency: "USD" }, available: true, returnPolicy: null, match: exact },
      { id: "c", total: { amountMinor: 1000, currency: "USD" }, available: true, returnPolicy: null, match: { ...exact, status: "similar" as const } }
    ]);
    expect(r?.offer.id).toBe("b");
  });
  it("prefers free returns within 5%", () => {
    const r = recommendOffer([
      { id: "a", total: { amountMinor: 6500, currency: "USD" }, available: true, returnPolicy: "Final sale", match: exact },
      { id: "b", total: { amountMinor: 6800, currency: "USD" }, available: true, returnPolicy: "Free returns within 30 days", match: exact }
    ]);
    expect(r?.offer.id).toBe("b");
  });
  it("returns null when no exact offers", () => {
    expect(recommendOffer([])).toBeNull();
  });
});
