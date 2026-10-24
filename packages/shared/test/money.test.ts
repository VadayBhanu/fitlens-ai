import { describe, expect, it } from "vitest";
import { addMoney, formatMoney, parsePrice, toMinor } from "../src/money";

describe("parsePrice", () => {
  it.each([
    ["$1,299.99", 129999, "USD"],
    ["1.299,99 €", 129999, "EUR"],
    ["£49.5", 4950, "GBP"],
    ["USD 20", 2000, "USD"],
    ["¥3,000", 3000, "JPY"],
    ["₹1,499", 149900, "INR"],
    ["Now $59.00 was $80.00", 5900, "USD"],
    ["12,50", 1250, "USD"]
  ])("parses %s", (input, minor, currency) => {
    expect(parsePrice(input)).toEqual({ amountMinor: minor, currency });
  });

  it("parses numbers without float drift", () => {
    expect(parsePrice(19.99, "USD")).toEqual({ amountMinor: 1999, currency: "USD" });
    expect(toMinor("0.285", "USD")).toBe(29);
  });

  it("rejects non-prices", () => {
    expect(parsePrice("Sold out")).toBeNull();
    expect(parsePrice(-5)).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
  });
});

describe("money arithmetic", () => {
  it("adds same currency and refuses mixed currency", () => {
    expect(addMoney({ amountMinor: 100, currency: "USD" }, { amountMinor: 250, currency: "USD" }).amountMinor).toBe(350);
    expect(() => addMoney({ amountMinor: 1, currency: "USD" }, { amountMinor: 1, currency: "EUR" })).toThrow();
  });
  it("formats", () => {
    expect(formatMoney({ amountMinor: 129999, currency: "USD" })).toBe("$1,299.99");
  });
});
