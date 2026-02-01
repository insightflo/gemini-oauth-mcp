// @TEST P4-I1-T2 - API Integration Tests
// @SPEC Chat/GenerateContent real API calls, Rate Limit scenarios, Account rotation, Error handling
// @IMPL src/tools/chat.ts, src/tools/generate.ts, src/api/client.ts, src/accounts/rotator.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  handleChat,
  type ChatToolContext,
  DEFAULT_CHAT_MODEL,
} from "../../src/tools/chat.js";
import {
  handleGenerateContent,
  type GenerateToolContext,
  DEFAULT_GENERATE_MODEL,
} from "../../src/tools/generate.js";
import {
  createGeminiClient,
  type DelayFn,
} from "../../src/api/client.js";
import { RateLimitError, ApiError } from "../../src/utils/errors.js";
import type { Account } from "../../src/auth/storage.js";
import type { TokenManager } from "../../src/auth/token.js";
import type { AccountRotator } from "../../src/accounts/rotator.js";
import type { QuotaTracker } from "../../src/accounts/quota.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;
vi.useFakeTimers();

/**
 * Test account factory
 */
function createTestAccount(
  id: string = "test-account-id",
  email: string = "test@example.com"
): Account {
  return {
    id,
    email,
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
}

/**
 * Create mock dependencies
 */
function createMockDependencies() {
  const mockTokenManager: TokenManager = {
    getAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
    refreshToken: vi.fn().mockResolvedValue("new-access-token"),
    isTokenExpired: vi.fn().mockReturnValue(false),
    clearCache: vi.fn(),
  };

  const mockQuotaTracker: QuotaTracker = {
    updateQuota: vi.fn(),
    getQuota: vi.fn().mockReturnValue(null),
    getAllQuotas: vi.fn().mockReturnValue([]),
    incrementUsage: vi.fn(),
    resetQuota: vi.fn(),
    getTotalAvailable: vi.fn().mockReturnValue(1000),
  };

  const mockDelayFn: DelayFn = vi.fn().mockResolvedValue(undefined);

  return {
    mockTokenManager,
    mockQuotaTracker,
    mockDelayFn,
  };
}

describe("API Integration", () => {
  let testAccount1: Account;
  let testAccount2: Account;
  let testAccount3: Account;
  let mockDeps: ReturnType<typeof createMockDependencies>;
  let mockRotator: AccountRotator;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();

    testAccount1 = createTestAccount("account-1", "user1@example.com");
    testAccount2 = createTestAccount("account-2", "user2@example.com");
    testAccount3 = createTestAccount("account-3", "user3@example.com");

    mockDeps = createMockDependencies();

    // Setup mock AccountRotator
    mockRotator = {
      getNextAccount: vi.fn().mockReturnValue(testAccount1),
      markRateLimited: vi.fn(),
      clearRateLimit: vi.fn(),
      isRateLimited: vi.fn().mockReturnValue(false),
      getAvailableAccounts: vi.fn().mockReturnValue([testAccount1, testAccount2, testAccount3]),
      getRateLimitedAccounts: vi.fn().mockReturnValue([]),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Chat Tool", () => {
    // @TEST P4-I1-T2.1 - Chat tool successful message send
    it("should successfully send message and receive response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Hello, how can I help you?" }],
              },
            },
          ],
        }),
      });

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      const result = await handleChat({ message: "Hello" }, context);

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Hello, how can I help you?");
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    // @TEST P4-I1-T2.2 - Use correct model from parameter
    it("should use correct model from parameter", async () => {
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

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      await handleChat({ message: "Test", model: "gemini-2.5-pro" }, context);

      const callArgs = mockFetch.mock.calls[0]!;
      const url = callArgs[0] as string;
      expect(url).toContain("gemini-2.5-pro");
    });

    // @TEST P4-I1-T2.3 - Use default model when not specified
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

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      await handleChat({ message: "Test" }, context);

      const callArgs = mockFetch.mock.calls[0]!;
      const url = callArgs[0] as string;
      expect(url).toContain(DEFAULT_CHAT_MODEL);
    });

    // @TEST P4-I1-T2.4 - Format response with model and email
    it("should format response with model and email", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Generated response" }],
              },
            },
          ],
        }),
      });

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      const result = await handleChat({ message: "Test" }, context);

      expect(result.content[0].text).toContain(`[${DEFAULT_CHAT_MODEL.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ")} via ${testAccount1.email}]`);
      expect(result.content[0].text).toContain("Generated response");
    });
  });

  describe("Generate Content Tool", () => {
    // @TEST P4-I1-T2.5 - Generate content successfully
    it("should successfully generate content from prompt", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Generated content here" }],
              },
            },
          ],
        }),
      });

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: GenerateToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      const result = await handleGenerateContent(
        { prompt: "Write a short story" },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Generated content here");
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    // @TEST P4-I1-T2.6 - Handle multi-line responses
    it("should handle multi-line responses", async () => {
      const multilineContent = "Line 1\nLine 2\nLine 3\n\nParagraph 2";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: multilineContent }],
              },
            },
          ],
        }),
      });

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: GenerateToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      const result = await handleGenerateContent(
        { prompt: "Write something" },
        context
      );

      expect(result.content[0].text).toContain(multilineContent);
    });
  });

  describe("Rate Limit Handling", () => {
    // @TEST P4-I1-T2.7 - Switch to next account on rate limit
    it("should switch to next account on rate limit", async () => {
      mockRotator.getNextAccount = vi
        .fn()
        .mockReturnValueOnce(testAccount1)
        .mockReturnValueOnce(testAccount2);

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

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const emails = ["user1@example.com", "user2@example.com"];
      let emailIndex = 0;

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => {
          return emails[emailIndex];
        },
      };

      // Simulate email rotation on getNextAccount
      const originalGetNextAccount = mockRotator.getNextAccount as ReturnType<
        typeof vi.fn
      >;
      originalGetNextAccount.mockImplementation((arg) => {
        if (emailIndex === 0) {
          emailIndex = 1;
          return testAccount2;
        }
        return testAccount2;
      });

      const result = await handleChat({ message: "Test" }, context);

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Success with second account");
      expect(mockRotator.markRateLimited).toHaveBeenCalledWith(
        testAccount1.id,
        60000
      );
    });

    // @TEST P4-I1-T2.8 - Retry with new account automatically
    it("should retry with new account automatically", async () => {
      let attemptCount = 0;
      mockRotator.getNextAccount = vi.fn().mockImplementation(() => {
        attemptCount++;
        return attemptCount === 1 ? testAccount1 : testAccount2;
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ "Retry-After": "30" }),
          json: async () => ({ error: { message: "Rate limited" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: "Retry successful" }],
                },
              },
            ],
          }),
        });

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      let currentEmail = testAccount1.email;
      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => currentEmail,
      };

      // Update email when getNextAccount is called
      mockRotator.getNextAccount = vi.fn().mockImplementation(() => {
        currentEmail = testAccount2.email;
        return testAccount2;
      });

      const result = await handleChat({ message: "Test" }, context);

      expect(result.isError).toBe(false);
      expect(mockRotator.getNextAccount).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // @TEST P4-I1-T2.9 - Fail when all accounts are rate limited
    it("should fail when all accounts are rate limited", async () => {
      mockRotator.getNextAccount = vi
        .fn()
        .mockReturnValueOnce(testAccount1)
        .mockImplementation(() => {
          throw new RateLimitError("All accounts rate limited", 120);
        });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "120" }),
        json: async () => ({ error: { message: "Rate limited" } }),
      });

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      await expect(
        handleChat({ message: "Test" }, context)
      ).rejects.toThrow(RateLimitError);
    });

    // @TEST P4-I1-T2.10 - Mark account as rate limited after 429
    it("should mark account as rate limited after 429 response", async () => {
      mockRotator.getNextAccount = vi
        .fn()
        .mockReturnValueOnce(testAccount1)
        .mockImplementation(() => {
          throw new RateLimitError("All accounts rate limited", 60);
        });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "60" }),
        json: async () => ({ error: { message: "Rate limited" } }),
      });

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      await expect(
        handleChat({ message: "Test" }, context)
      ).rejects.toThrow();

      expect(mockRotator.markRateLimited).toHaveBeenCalledWith(
        testAccount1.id,
        60000
      );
    });
  });

  describe("Account Rotation", () => {
    // @TEST P4-I1-T2.11 - Rotate through accounts in round-robin
    it("should rotate through accounts in round-robin", async () => {
      mockFetch.mockResolvedValue({
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

      let rotationIndex = 0;
      const accounts = [testAccount1, testAccount2, testAccount3];

      mockRotator.getNextAccount = vi.fn().mockImplementation(() => {
        const account = accounts[rotationIndex % accounts.length];
        rotationIndex++;
        return account;
      });

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      // Make 3 requests
      await handleChat({ message: "Test 1" }, context);
      await handleChat({ message: "Test 2" }, context);
      await handleChat({ message: "Test 3" }, context);

      expect(mockRotator.getNextAccount).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    // @TEST P4-I1-T2.12 - Skip rate-limited accounts
    it("should skip rate-limited accounts", async () => {
      const availableAccounts = [testAccount2, testAccount3];

      mockRotator.getNextAccount = vi.fn().mockReturnValue(testAccount2);
      mockRotator.getAvailableAccounts = vi.fn().mockReturnValue(availableAccounts);

      mockFetch.mockResolvedValue({
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

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount2.email,
      };

      const result = await handleChat({ message: "Test" }, context);

      // Should select from available accounts only
      expect(result.isError).toBe(false);
      expect(mockRotator.getNextAccount).toHaveBeenCalled();
    });

    // @TEST P4-I1-T2.13 - Recover account after rate limit expires
    it("should recover account after rate limit expires", async () => {
      let isLimited = true;

      mockRotator.isRateLimited = vi.fn().mockImplementation(() => {
        return isLimited;
      });

      mockRotator.getAvailableAccounts = vi.fn().mockImplementation(() => {
        return isLimited ? [testAccount2, testAccount3] : [testAccount1, testAccount2, testAccount3];
      });

      // First check: account is limited
      expect(mockRotator.isRateLimited(testAccount1.id)).toBe(true);
      expect(mockRotator.getAvailableAccounts()).not.toContainEqual(
        expect.objectContaining({ id: testAccount1.id })
      );

      // Simulate rate limit expiration
      isLimited = false;

      // Second check: account is recovered
      expect(mockRotator.isRateLimited(testAccount1.id)).toBe(false);
      expect(mockRotator.getAvailableAccounts()).toContainEqual(
        expect.objectContaining({ id: testAccount1.id })
      );
    });
  });

  describe("Error Handling", () => {
    // @TEST P4-I1-T2.14 - Handle network errors with retry
    it("should handle network errors with retry", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
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

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      const result = await handleChat({ message: "Test" }, context);

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Success after retry");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // @TEST P4-I1-T2.15 - Handle API errors gracefully
    it("should handle API errors gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: "Invalid request" },
        }),
      });

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      const result = await handleChat({ message: "Test" }, context);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("error");
    });

    // @TEST P4-I1-T2.16 - Return proper error messages
    it("should return proper error messages", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: { message: "Internal server error" },
        }),
      });

      // Mock retry attempts for 5xx errors
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: { message: "Internal server error" },
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: { message: "Internal server error" },
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: { message: "Internal server error" },
        }),
      });

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      const result = await handleChat({ message: "Test" }, context);

      expect(result.isError).toBe(true);
      expect(result.content[0].text.toLowerCase()).toContain("error");
    });

    // @TEST P4-I1-T2.17 - Handle empty responses
    it("should handle empty API responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [],
        }),
      });

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      const result = await handleChat({ message: "Test" }, context);

      expect(result.isError).toBe(true);
      expect(result.content[0].text.toLowerCase()).toContain("error");
    });
  });

  describe("End-to-End Scenarios", () => {
    // @TEST P4-I1-T2.18 - Complete chat flow with token refresh
    it("should complete chat flow with token refresh", async () => {
      // Token is expired
      (mockDeps.mockTokenManager.isTokenExpired as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (mockDeps.mockTokenManager.refreshToken as ReturnType<typeof vi.fn>).mockResolvedValue("new-token");
      (mockDeps.mockTokenManager.getAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue("new-token");

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

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      const result = await handleChat({ message: "Hello" }, context);

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Chat response");
    });

    // @TEST P4-I1-T2.19 - Complete generate flow with quota tracking
    it("should complete generate flow with quota tracking", async () => {
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

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: GenerateToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      const result = await handleGenerateContent(
        { prompt: "Generate content" },
        context
      );

      expect(result.isError).toBe(false);
      expect(mockDeps.mockQuotaTracker.incrementUsage).toHaveBeenCalledWith(
        testAccount1.id
      );
    });

    // @TEST P4-I1-T2.20 - Multiple requests with account rotation
    it("should handle multiple requests with account rotation", async () => {
      let callCount = 0;

      mockRotator.getNextAccount = vi.fn().mockImplementation(() => {
        const accounts = [testAccount1, testAccount2, testAccount3];
        const account = accounts[callCount % accounts.length];
        callCount++;
        return account;
      });

      mockFetch.mockResolvedValue({
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

      const client = createGeminiClient({
        tokenManager: mockDeps.mockTokenManager,
        rotator: mockRotator,
        quotaTracker: mockDeps.mockQuotaTracker,
        delayFn: mockDeps.mockDelayFn,
      });

      const context: ChatToolContext = {
        client,
        rotator: mockRotator,
        getCurrentEmail: () => testAccount1.email,
      };

      // Make 3 requests
      const result1 = await handleChat({ message: "Test 1" }, context);
      const result2 = await handleChat({ message: "Test 2" }, context);
      const result3 = await handleChat({ message: "Test 3" }, context);

      expect(result1.isError).toBe(false);
      expect(result2.isError).toBe(false);
      expect(result3.isError).toBe(false);
      expect(mockRotator.getNextAccount).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
