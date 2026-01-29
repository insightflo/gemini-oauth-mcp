// @TASK P1-M1-T3 - 커스텀 에러 클래스 테스트
// @SPEC docs/planning/02-trd.md#에러-처리

import { describe, it, expect } from "vitest";
import {
  GeminiOAuthError,
  AuthenticationError,
  RateLimitError,
  ApiError,
} from "../../../src/utils/errors.js";

describe("Errors", () => {
  describe("GeminiOAuthError", () => {
    it("should have correct name and code", () => {
      const error = new GeminiOAuthError("test", "TEST_CODE");
      expect(error.name).toBe("GeminiOAuthError");
      expect(error.code).toBe("TEST_CODE");
      expect(error.message).toBe("test");
    });

    it("should accept optional details", () => {
      const error = new GeminiOAuthError("test", "TEST_CODE", { foo: "bar" });
      expect(error.details).toEqual({ foo: "bar" });
    });
  });

  describe("AuthenticationError", () => {
    it("should have AUTH_ERROR code", () => {
      const error = new AuthenticationError("auth failed");
      expect(error.name).toBe("AuthenticationError");
      expect(error.code).toBe("AUTH_ERROR");
    });
  });

  describe("RateLimitError", () => {
    it("should have RATE_LIMITED code", () => {
      const error = new RateLimitError("rate limited");
      expect(error.name).toBe("RateLimitError");
      expect(error.code).toBe("RATE_LIMITED");
    });

    it("should accept retryAfter", () => {
      const error = new RateLimitError("rate limited", 60);
      expect(error.retryAfter).toBe(60);
    });
  });

  describe("ApiError", () => {
    it("should have API_ERROR code", () => {
      const error = new ApiError("api failed");
      expect(error.name).toBe("ApiError");
      expect(error.code).toBe("API_ERROR");
    });
  });
});
