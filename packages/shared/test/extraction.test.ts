import { describe, expect, it } from "vitest";
import { bestJsonLdProduct, cleanText, imageKey, inferCategory } from "../src/extraction";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebPage", name: "Shop" },
    {
      "@type": "Product",
      name: "Linen <b>Shirt</b>",
      brand: { "@type": "Brand", name: "Tidewater" },
      color: "White",
      mpn: "TW-11",
      gtin13: "4006381333931",
      image: ["https://cdn.shop.example/linen_800x.jpg?v=2"],
      offers: { "@type": "Offer", price: "45.00", priceCurrency: "USD", availability: "https://schema.org/InStock" }
    },
    {
      "@type": ["Product"],
      name: "Wool Coat",
      image: { url: "https://cdn.shop.example/coat.jpg" },
      offers: [{ "@type": "AggregateOffer", lowPrice: 199, priceCurrency: "EUR" }]
    }
  ]
};

describe("JSON-LD extraction", () => {
  it("extracts the product matching the selected image", () => {
    const p = bestJsonLdProduct([jsonLd], "https://cdn.shop.example/coat.jpg?width=400");
    expect(p?.name).toBe("Wool Coat");
    expect(p?.price).toEqual({ amountMinor: 19900, currency: "EUR" });
  });
  it("cleans markup and reads identifiers", () => {
    const p = bestJsonLdProduct([jsonLd], "https://cdn.shop.example/linen.jpg");
    expect(p?.name).toBe("Linen Shirt");
    expect(p?.brand).toBe("Tidewater");
    expect(p?.gtin).toBe("4006381333931");
    expect(p?.availability).toBe(true);
    expect(p?.price?.amountMinor).toBe(4500);
  });
  it("returns null when no product exists", () => {
    expect(bestJsonLdProduct([{ "@type": "Organization" }])).toBeNull();
  });
});

describe("helpers", () => {
  it("normalizes image keys", () => {
    expect(imageKey("https://a.com/x/shirt_800x.jpg?v=1")).toBe(imageKey("http://a.com/x/shirt.jpg"));
  });
  it("infers categories", () => {
    expect(inferCategory("Oversized Cotton Hoodie")).toBe("top");
    expect(inferCategory("Quilted puffer jacket")).toBe("outerwear");
    expect(inferCategory("Midi wrap dress")).toBe("dress");
    expect(inferCategory("Slim jeans")).toBe("bottom");
    expect(inferCategory("Leather wallet")).toBe("other");
  });
  it("strips control characters and caps length", () => {
    expect(cleanText("a\u0000b  c", 3)).toBe("a b");
  });
});
