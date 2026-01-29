// @TASK P1-M1-T3 - 커스텀 에러 클래스
// @SPEC docs/planning/02-trd.md#에러-처리

/**
 * Base error class for all Gemini OAuth related errors.
 *
 * Error hierarchy:
 * GeminiOAuthError (base)
 * ├── AuthenticationError (AUTH_ERROR)
 * ├── RateLimitError (RATE_LIMITED)
 * └── ApiError (API_ERROR)
 */
export class GeminiOAuthError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown> | undefined;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "GeminiOAuthError";
    this.code = code;
    this.details = details;

    // Maintains proper stack trace for where error was thrown (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Ensure prototype chain is properly set
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Authentication related errors.
 *
 * Error codes:
 * - AUTH_ERROR: Generic authentication error
 * - AUTH_NOT_FOUND: Credentials not found
 * - AUTH_EXPIRED: Token expired
 * - AUTH_DENIED: Access denied
 * - AUTH_TIMEOUT: Authentication timeout
 */
export class AuthenticationError extends GeminiOAuthError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "AUTH_ERROR", details);
    this.name = "AuthenticationError";
  }
}

/**
 * Rate limiting errors with optional retry information.
 */
export class RateLimitError extends GeminiOAuthError {
  public readonly retryAfter: number | undefined;

  constructor(message: string, retryAfter?: number, details?: Record<string, unknown>) {
    super(message, "RATE_LIMITED", details);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * API communication errors.
 *
 * Error codes:
 * - API_ERROR: Generic API error
 * - API_NETWORK: Network connectivity issue
 * - API_UNKNOWN: Unknown API error
 */
export class ApiError extends GeminiOAuthError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "API_ERROR", details);
    this.name = "ApiError";
  }
}
