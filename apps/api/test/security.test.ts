import { describe, expect, it } from "vitest";
import { assertSafeExternalUrl, isPrivateIPv4 } from "../src/lib/ssrf";
import { imageDimensions, sniffMime, validateMedia } from "../src/lib/media";
import { isAllowedOrigin } from "../src/index";
import { hashPassword, timingSafeEqual } from "../src/lib/crypto";

describe("SSRF guard", () => {
  it.each(["10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.10", "172.20.0.5", "100.64.0.1", "0.0.0.0"])("blocks private IPv4 %s", (ip) => {
    expect(isPrivateIPv4(ip)).toBe(true);
    expect(() => assertSafeExternalUrl(`http://${ip}/x.png`)).toThrow();
  });
  it.each([
    "file:///etc/passwd",
    "ftp://cdn.example/x.png",
    "https://user:pass@cdn.example/x.png",
    "https://localhost/x.png",
    "https://printer.local/x.png",
    "https://[::1]/x.png",
    "https://cdn.example:8443/x.png",
    "https://intranet/x.png"
  ])("blocks %s", (url) => {
    expect(() => assertSafeExternalUrl(url)).toThrow();
  });
  it("allows ordinary public CDNs", () => {
    expect(assertSafeExternalUrl("https://cdn.shopify.com/s/files/x.jpg?v=1").hostname).toBe("cdn.shopify.com");
    expect(isPrivateIPv4("8.8.8.8")).toBe(false);
  });
});

function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
}

function jpeg(w: number, h: number): Uint8Array {
  // SOI, APP0 (len 16), SOF0 with dimensions
  const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return b;
}

describe("media validation", () => {
  it("sniffs signatures rather than trusting names", () => {
    expect(sniffMime(png(10, 10))).toBe("image/png");
    expect(sniffMime(jpeg(10, 10))).toBe("image/jpeg");
    expect(sniffMime(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
  });
  it("reads dimensions", () => {
    expect(imageDimensions(png(800, 1200), "image/png")).toEqual({ width: 800, height: 1200 });
    expect(imageDimensions(jpeg(640, 480), "image/jpeg")).toEqual({ width: 640, height: 480 });
  });
  it("rejects tiny or disallowed media", () => {
    expect(validateMedia(png(10, 10), ["image/png"])).toEqual({ error: "bad_dimensions" });
    expect(validateMedia(png(500, 500), ["image/jpeg"])).toEqual({ error: "unsupported" });
    expect(validateMedia(png(500, 500), ["image/png"])).toMatchObject({ mime: "image/png", width: 500 });
  });
});

describe("CORS origin rules", () => {
  it("matches exact origins and wildcard prefixes", () => {
    const allowed = "https://app.fitlens.example, chrome-extension://abc*";
    expect(isAllowedOrigin("https://app.fitlens.example", allowed)).toBe(true);
    expect(isAllowedOrigin("chrome-extension://abcdef", allowed)).toBe(true);
    expect(isAllowedOrigin("https://app.fitlens.example.evil.com", allowed)).toBe(false);
    expect(isAllowedOrigin("chrome-extension://zzz", allowed)).toBe(false);
  });
});

describe("password hashing", () => {
  it("is deterministic per salt and differs across salts", async () => {
    const a = await hashPassword("correct horse", 1000, "00".repeat(16));
    const b = await hashPassword("correct horse", 1000, "00".repeat(16));
    const c = await hashPassword("correct horse", 1000);
    expect(timingSafeEqual(a.hash, b.hash)).toBe(true);
    expect(a.hash).not.toBe(c.hash);
    expect(a.hash).toHaveLength(64);
  });
});
