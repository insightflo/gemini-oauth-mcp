// @TASK P2-M6-T1 - Gemini API Client Tests
// @SPEC Rate limit handling, retry logic, account rotation

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GeminiClient,
  createGeminiClient,
  ChatMessage,
  DEFAULT_MODEL,
  MAX_RETRIES,
  DelayFn,
} from "../../../src/api/client.js";
import { TokenManager } from "../../../src/auth/token.js";
import { AccountRotator } from "../../../src/accounts/rotator.js";
import { QuotaTracker } from "../../../src/accounts/quota.js";
import { RateLimitError, ApiError } from "../../../src/utils/errors.js";
import { Account } from "../../../src/auth/storage.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;
vi.useFakeTimers();

describe("GeminiClient", () => {
  // Mock dependencies
  let mockTokenManager: TokenManager;
  let mockRotator: AccountRotator;
  let mockQuotaTracker: QuotaTracker;
  let mockDelayFn: DelayFn;
  let client: GeminiClient;

  // Test account
  const testAccount: Account = {
    id: "test-account-id",
    email: "test@example.com",
    refreshToken: "refresh-token",
    accessToken: "access-token",
    accessTokenExpiry: Date.now() + 3600000,
    quota: {
      requestsRemaining: 100,
      tokensRemaining: 10000,
      resetAt: null,
      updatedAt: Date.now(),
    },
    rateLimit: {
      isLimited: false,
      limitedUntil: null,
      consecutiveHits: 0,
    },
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock TokenManager
    mockTokenManager = {
      getAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
      refreshToken: vi.fn().mockResolvedValue("new-access-token"),
      isTokenExpired: vi.fn().mockReturnValue(false),
      clearCache: vi.fn(),
    };

    // Setup mock AccountRotator
    mockRotator = {
      getNextAccount: vi.fn().mockReturnValue(testAccount),
      markRateLimited: vi.fn(),
      clearRateLimit: vi.fn(),
      isRateLimited: vi.fn().mockReturnValue(false),
      getAvailableAccounts: vi.fn().mockReturnValue([testAccount]),
      getRateLimitedAccounts: vi.fn().mockReturnValue([]),
    };

    // Setup mock QuotaTracker
    mockQuotaTracker = {
      updateQuota: vi.fn(),
      getQuota: vi.fn().mockReturnValue(null),
      getAllQuotas: vi.fn().mockReturnValue([]),
      incrementUsage: vi.fn(),
      resetQuota: vi.fn(),
      getTotalAvailable: vi.fn().mockReturnValue(1000),
    };

    // Mock delay function that resolves immediately
    mockDelayFn = vi.fn().mockResolvedValue(undefined);

    // Create client with mocked delay
    client = createGeminiClient({
      tokenManager: mockTokenManager,
      rotator: mockRotator,
      quotaTracker: mockQuotaTracker,
      delayFn: mockDelayFn,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("constructor and exports", () => {
    it("should export DEFAULT_MODEL constant", () => {
      expect(DEFAULT_MODEL).toBe("gemini-2.5-flash");
    });

    it("should export MAX_RETRIES constant", () => {
      expect(MAX_RETRIES).toBe(3);
    });

    it("should create client with createGeminiClient factory", () => {
      expect(client).toBeDefined();
      expect(client.generateContent).toBeDefined();
      expect(client.chat).toBeDefined();
    });
  });

  describe("generateContent", () => {
    it("should call standard API with correct headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Hello, world!" }],
              },
            },
          ],
        }),
      });

      await client.generateContent("Hello");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("generativelanguage.googleapis.com"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer mock-access-token",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("should use default model when not specified", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Response" }],
              },
            },
          ],
        }),
      });

      await client.generateContent("Test prompt");

      const callArgs = mockFetch.mock.calls[0]!;
      const url = callArgs[0] as string;
      expect(url).toContain(DEFAULT_MODEL);
    });

    it("should use custom model when specified", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Response" }],
              },
            },
          ],
        }),
      });

      await client.generateContent("Test prompt", "gemini-1.5-pro");

      const callArgs = mockFetch.mock.calls[0]!;
      const url = callArgs[0] as string;
      expect(url).toContain("gemini-1.5-pro");
    });

    it("should return response text from API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Generated content" }],
              },
            },
          ],
        }),
      });

      const result = await client.generateContent("Generate something");
      expect(result).toBe("Generated content");
    });

    it("should get token from TokenManager", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Response" }],
              },
            },
          ],
        }),
      });

      await client.generateContent("Test");

      expect(mockTokenManager.getAccessToken).toHaveBeenCalledWith(testAccount.id);
    });

    it("should get account from AccountRotator", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Response" }],
              },
            },
          ],
        }),
      });

      await client.generateContent("Test");

      expect(mockRotator.getNextAccount).toHaveBeenCalled();
    });

    it("should increment quota usage on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Response" }],
              },
            },
          ],
        }),
      });

      await client.generateContent("Test");

      expect(mockQuotaTracker.incrementUsage).toHaveBeenCalledWith(testAccount.id);
    });
  });

  describe("chat", () => {
    it("should format messages correctly for API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Chat response" }],
              },
            },
          ],
        }),
      });

      const messages: ChatMessage[] = [
        { role: "user", content: "Hello" },
        { role: "model", content: "Hi there!" },
        { role: "user", content: "How are you?" },
      ];

      await client.chat(messages);

      const callArgs = mockFetch.mock.calls[0]!;
      const body = JSON.parse(callArgs[1]!.body as string);

      expect(body.contents).toEqual([
        { role: "user", parts: [{ text: "Hello" }] },
        { role: "model", parts: [{ text: "Hi there!" }] },
        { role: "user", parts: [{ text: "How are you?" }] },
      ]);
    });

    it("should return response text from chat", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Chat response" }],
              },
            },
          ],
        }),
      });

      const messages: ChatMessage[] = [{ role: "user", content: "Hello" }];
      const result = await client.chat(messages);

      expect(result).toBe("Chat response");
    });

    it("should use default model for chat", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Response" }],
              },
            },
          ],
        }),
      });

      const messages: ChatMessage[] = [{ role: "user", content: "Test" }];
      await client.chat(messages);

      const callArgs = mockFetch.mock.calls[0]!;
      const url = callArgs[0] as string;
      expect(url).toContain(DEFAULT_MODEL);
    });

    it("should use custom model for chat when specified", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Response" }],
              },
            },
          ],
        }),
      });

      const messages: ChatMessage[] = [{ role: "user", content: "Test" }];
      await client.chat(messages, "gemini-1.5-flash");

      const callArgs = mockFetch.mock.calls[0]!;
      const url = callArgs[0] as string;
      expect(url).toContain("gemini-1.5-flash");
    });
  });

  describe("Rate Limit Handling (429)", () => {
    it("should mark account as rate limited on 429 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({
          "Retry-After": "60",
        }),
        json: async () => ({
          error: { message: "Rate limited" },
        }),
      });

      // Second attempt should fail completely
      mockRotator.getNextAccount = vi
        .fn()
        .mockReturnValueOnce(testAccount)
        .mockImplementation(() => {
          throw new RateLimitError("All accounts rate limited", 60);
        });

      await expect(client.generateContent("Test")).rejects.toThrow(RateLimitError);

      expect(mockRotator.markRateLimited).toHaveBeenCalledWith(
        testAccount.id,
        60000 // 60 seconds in ms
      );
    });

    it("should parse Retry-After header in seconds", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({
          "Retry-After": "120",
        }),
        json: async () => ({
          error: { message: "Rate limited" },
        }),
      });

      mockRotator.getNextAccount = vi
        .fn()
        .mockReturnValueOnce(testAccount)
        .mockImplementation(() => {
          throw new RateLimitError("All accounts rate limited", 120);
        });

      await expect(client.generateContent("Test")).rejects.toThrow(RateLimitError);

      expect(mockRotator.markRateLimited).toHaveBeenCalledWith(
        testAccount.id,
        120000 // 120 seconds in ms
      );
    });

    it("should use default retry time if Retry-After header missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers(),
        json: async () => ({
          error: { message: "Rate limited" },
        }),
      });

      mockRotator.getNextAccount = vi
        .fn()
        .mockReturnValueOnce(testAccount)
        .mockImplementation(() => {
          throw new RateLimitError("All accounts rate limited", 60);
        });

      await expect(client.generateContent("Test")).rejects.toThrow(RateLimitError);

      // Default 60 seconds
      expect(mockRotator.markRateLimited).toHaveBeenCalledWith(
        testAccount.id,
        60000
      );
    });

    it("should rotate to next account on rate limit", async () => {
      const secondAccount: Account = {
        ...testAccount,
        id: "second-account-id",
        email: "second@example.com",
      };

      mockRotator.getNextAccount = vi
        .fn()
        .mockReturnValueOnce(testAccount)
        .mockReturnValueOnce(secondAccount);

      // First request fails with rate limit
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ "Retry-After": "60" }),
          json: async () => ({ error: { message: "Rate limited" } }),
        })
        // Second request succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: "Success with second account" }],
                },
              },
            ],
          }),
        });

      const result = await client.generateContent("Test");

      expect(result).toBe("Success with second account");
      expect(mockRotator.getNextAccount).toHaveBeenCalledTimes(2);
      expect(mockRotator.markRateLimited).toHaveBeenCalledWith(
        testAccount.id,
        60000
      );
    });
  });

  describe("Network Error Retry", () => {
    it("should retry on network error", async () => {
      // First attempt fails
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        // Second attempt succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: "Success after retry" }],
                },
              },
            ],
          }),
        });

      const result = await client.generateContent("Test");

      expect(result).toBe("Success after retry");
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockDelayFn).toHaveBeenCalledTimes(1);
    });

    it("should retry up to MAX_RETRIES times", async () => {
      // All attempts fail
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(client.generateContent("Test")).rejects.toThrow(ApiError);

      // Initial + 3 retries = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(MAX_RETRIES + 1);
      // Delay called for each retry attempt
      expect(mockDelayFn).toHaveBeenCalledTimes(MAX_RETRIES);
    });

    it("should use exponential backoff between retries", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(client.generateContent("Test")).rejects.toThrow(ApiError);

      // Check that delay was called with increasing values
      expect(mockDelayFn).toHaveBeenNthCalledWith(1, 1000); // 1s
      expect(mockDelayFn).toHaveBeenNthCalledWith(2, 2000); // 2s
      expect(mockDelayFn).toHaveBeenNthCalledWith(3, 4000); // 4s
    });

    it("should throw ApiError after all retries exhausted", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(client.generateContent("Test")).rejects.toThrow(ApiError);
    });
  });

  describe("Account Rotation Integration", () => {
    it("should use account from rotator", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Response" }],
              },
            },
          ],
        }),
      });

      await client.generateContent("Test");

      expect(mockRotator.getNextAccount).toHaveBeenCalled();
      expect(mockTokenManager.getAccessToken).toHaveBeenCalledWith(testAccount.id);
    });

    it("should handle AllAccountsRateLimitedError from rotator", async () => {
      mockRotator.getNextAccount = vi.fn().mockImplementation(() => {
        throw new RateLimitError("All accounts rate limited", 60);
      });

      await expect(client.generateContent("Test")).rejects.toThrow(RateLimitError);
    });
  });

  describe("Error Handling", () => {
    it("should throw ApiError on 4xx responses (non-429)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: "Bad request" },
        }),
      });

      await expect(client.generateContent("Test")).rejects.toThrow(ApiError);
    });

    it("should throw ApiError on 5xx responses", async () => {
      // All 5xx attempts fail
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          error: { message: "Internal server error" },
        }),
      });

      await expect(client.generateContent("Test")).rejects.toThrow(ApiError);

      // Should retry on 5xx: Initial + 3 retries = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(MAX_RETRIES + 1);
    });

    it("should handle empty response from API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [],
        }),
      });

      await expect(client.generateContent("Test")).rejects.toThrow(ApiError);
    });

    it("should handle missing candidates in response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await expect(client.generateContent("Test")).rejects.toThrow(ApiError);
    });

    it("should handle malformed response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [], // Empty parts
              },
            },
          ],
        }),
      });

      await expect(client.generateContent("Test")).rejects.toThrow(ApiError);
    });
  });

  describe("Request Format", () => {
    it("should format generateContent request correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Response" }],
              },
            },
          ],
        }),
      });

      await client.generateContent("Test prompt");

      const callArgs = mockFetch.mock.calls[0]!;
      const body = JSON.parse(callArgs[1]!.body as string);

      expect(body.contents).toEqual([
        {
          role: "user",
          parts: [{ text: "Test prompt" }],
        },
      ]);
    });

    it("should include generationConfig when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Response" }],
              },
            },
          ],
        }),
      });

      // Create client with custom generation config
      const clientWithConfig = createGeminiClient({
        tokenManager: mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockQuotaTracker,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
        },
        delayFn: mockDelayFn,
      });

      await clientWithConfig.generateContent("Test prompt");

      const callArgs = mockFetch.mock.calls[0]!;
      const body = JSON.parse(callArgs[1]!.body as string);

      expect(body.generationConfig).toEqual({
        temperature: 0.7,
        maxOutputTokens: 1000,
      });
    });
  });
});
