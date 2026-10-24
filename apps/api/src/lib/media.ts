/** File-signature sniffing — never trust a client-supplied Content-Type. */

export type SupportedMime = "image/jpeg" | "image/png" | "image/webp" | "video/webm" | "video/mp4";

export const IMAGE_MIMES: SupportedMime[] = ["image/jpeg", "image/png", "image/webp"];
export const VIDEO_MIMES: SupportedMime[] = ["video/webm", "video/mp4"];

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

export function sniffMime(b: Uint8Array): SupportedMime | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (ascii(b, 4, 8) === "ftyp") return "video/mp4";
  return null;
}

function ascii(b: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...b.subarray(start, end));
}

/** Read pixel dimensions from PNG/JPEG/WebP headers without decoding. */
export function imageDimensions(b: Uint8Array, mime: SupportedMime): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (mime === "image/png") {
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (mime === "image/webp") {
      const chunk = ascii(b, 12, 16);
      if (chunk === "VP8X") return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
      if (chunk === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
      if (chunk === "VP8L") {
        const bits = dv.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    if (mime === "image/jpeg") {
      let off = 2;
      while (off + 9 < b.length) {
        if (b[off] !== 0xff) return null;
        const marker = b[off + 1]!;
        const len = dv.getUint16(off + 2);
        // SOF0..SOF15 excluding DHT(C4), JPG(C8), DAC(CC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: dv.getUint16(off + 5), width: dv.getUint16(off + 7) };
        }
        off += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface ValidatedMedia {
  mime: SupportedMime;
  width: number | null;
  height: number | null;
}

export function validateMedia(bytes: Uint8Array, allow: SupportedMime[]): ValidatedMedia | { error: "unsupported" | "too_large" | "bad_dimensions" } {
  const mime = sniffMime(bytes);
  if (!mime || !allow.includes(mime)) return { error: "unsupported" };
  const limit = IMAGE_MIMES.includes(mime) ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (bytes.byteLength > limit) return { error: "too_large" };
  if (IMAGE_MIMES.includes(mime)) {
    const dims = imageDimensions(bytes, mime);
    if (!dims || dims.width < 64 || dims.height < 64 || dims.width > 12000 || dims.height > 12000) return { error: "bad_dimensions" };
    return { mime, ...dims };
  }
  return { mime, width: null, height: null };
}
