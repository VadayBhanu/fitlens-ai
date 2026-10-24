import { ErrorCode, USER_FACING_ERRORS, type ApiErrorBody } from "@fitlens/shared";
import type { Context } from "hono";
import type { ZodSchema, ZodTypeDef } from "zod";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  QUOTA_EXHAUSTED: 429,
  CONSENT_REQUIRED: 403,
  UNSUPPORTED_MEDIA: 415,
  PAYLOAD_TOO_LARGE: 413,
  IMAGE_FETCH_FAILED: 422,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_NOT_CONFIGURED: 503,
  GENERATION_FAILED: 422,
  INTERNAL: 500
};

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: unknown,
    public readonly retryable = false
  ) {
    super(message ?? USER_FACING_ERRORS[code]);
  }

  get status(): number {
    return STATUS[this.code];
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details, retryable: this.retryable } };
  }
}

export async function parseJson<T>(c: Context, schema: ZodSchema<T, ZodTypeDef, unknown>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(ErrorCode.BAD_REQUEST, "Request body must be valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(
      ErrorCode.VALIDATION_FAILED,
      result.error.issues[0]?.message ?? USER_FACING_ERRORS.VALIDATION_FAILED,
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    );
  }
  return result.data;
}

export const nowIso = () => new Date().toISOString();

export function addHours(hours: number, from = new Date()): string {
  return new Date(from.getTime() + hours * 3600_000).toISOString();
}
