/**
 * Stable, machine-readable error codes shared by the API and all clients.
 * Clients map these to user-facing copy; never show raw provider errors.
 */
export const ErrorCode = {
  BAD_REQUEST: "BAD_REQUEST",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  QUOTA_EXHAUSTED: "QUOTA_EXHAUSTED",
  CONSENT_REQUIRED: "CONSENT_REQUIRED",
  UNSUPPORTED_MEDIA: "UNSUPPORTED_MEDIA",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  IMAGE_FETCH_FAILED: "IMAGE_FETCH_FAILED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  GENERATION_FAILED: "GENERATION_FAILED",
  INTERNAL: "INTERNAL"
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    retryable?: boolean;
  };
}

export const USER_FACING_ERRORS: Record<ErrorCode, string> = {
  BAD_REQUEST: "That request couldn't be processed.",
  VALIDATION_FAILED: "Some of the information provided isn't valid.",
  UNAUTHENTICATED: "Please sign in to continue.",
  FORBIDDEN: "You don't have access to that item.",
  NOT_FOUND: "We couldn't find that item.",
  CONFLICT: "That already exists.",
  RATE_LIMITED: "You're going a little fast. Please wait a moment and try again.",
  QUOTA_EXHAUSTED: "You've used today's try-on allowance. It resets at midnight UTC.",
  CONSENT_REQUIRED: "We need your permission before sending photos to our try-on provider.",
  UNSUPPORTED_MEDIA: "That file type isn't supported. Use a JPEG, PNG or WebP image.",
  PAYLOAD_TOO_LARGE: "That file is too large.",
  IMAGE_FETCH_FAILED: "We couldn't download that product image. Try uploading it instead.",
  PROVIDER_UNAVAILABLE: "The try-on service is temporarily unavailable. Please try again shortly.",
  PROVIDER_NOT_CONFIGURED: "Photo try-on isn't configured on this server yet.",
  GENERATION_FAILED: "The try-on couldn't be generated from these images.",
  INTERNAL: "Something went wrong on our side."
};
