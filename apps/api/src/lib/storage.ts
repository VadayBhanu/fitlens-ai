import type { Env } from "../env";

/** Private blob storage. R2 is preferred; Workers KV is a zero-setup fallback. */
export interface BlobStore {
  put(key: string, body: ArrayBuffer | Uint8Array | ReadableStream, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; contentType: string; size: number | null } | null>;
  delete(key: string): Promise<void>;
}

class R2Store implements BlobStore {
  constructor(private readonly bucket: R2Bucket) {}
  async put(key: string, body: ArrayBuffer | Uint8Array | ReadableStream, contentType: string) {
    await this.bucket.put(key, body, { httpMetadata: { contentType } });
  }
  async get(key: string) {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return { body: obj.body, contentType: obj.httpMetadata?.contentType ?? "application/octet-stream", size: obj.size };
  }
  async delete(key: string) {
    await this.bucket.delete(key);
  }
}

class KvStore implements BlobStore {
  constructor(private readonly kv: KVNamespace) {}
  async put(key: string, body: ArrayBuffer | Uint8Array | ReadableStream, contentType: string) {
    const data = body instanceof ReadableStream ? await new Response(body).arrayBuffer() : body;
    if (data.byteLength > 25 * 1024 * 1024) throw new Error("KV values are limited to 25 MiB; enable R2 for larger media.");
    await this.kv.put(key, data, { metadata: { contentType } });
  }
  async get(key: string) {
    const res = await this.kv.getWithMetadata<{ contentType: string }>(key, "stream");
    if (!res.value) return null;
    return { body: res.value, contentType: res.metadata?.contentType ?? "application/octet-stream", size: null };
  }
  async delete(key: string) {
    await this.kv.delete(key);
  }
}

export function blobStore(env: Env): BlobStore {
  if (env.ASSETS) return new R2Store(env.ASSETS);
  if (env.ASSETS_KV) return new KvStore(env.ASSETS_KV);
  throw new Error("No asset storage binding configured (ASSETS R2 bucket or ASSETS_KV namespace).");
}
