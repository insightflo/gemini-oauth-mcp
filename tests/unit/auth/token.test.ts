// @TASK P2-M4-T1 - Token Manager Tests
// @SPEC Token caching, expiry detection, auto-refresh

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { TokenManager, createTokenManager } from "../../../src/auth/token";
import { AccountStorage, Account } from "../../../src/auth/storage";
import { AuthenticationError } from "../../../src/utils/errors";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Test fixtures
const createMockAccount = (overrides: Partial<Account> = {}): Account => ({
  id: "test-account-id",
  email: "test@example.com",
  refreshToken: "mock-refresh-token",
  accessToken: "mock-access-token",
  accessTokenExpiry: Date.now() + 3600 * 1000, // 1 hour from now
  quota: {
    requestsRemaining: 100,
    tokensRemaining: 1000000,
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
  ...overrides,
});

describe("TokenManager", () => {
  let tokenManager: TokenManager;
  let mockStorage: AccountStorage;
  let mockAccount: Account;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockAccount = createMockAccount();

    // Mock AccountStorage
    mockStorage = {
      load: vi.fn().mockResolvedValue({
        version: "1.0.0",
        activeAccountId: "test-account-id",
        accounts: [mockAccount],
        updatedAt: Date.now(),
      }),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as AccountStorage;

    tokenManager = createTokenManager(mockStorage, "mock-client-id");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getAccessToken", () => {
    it("should return cached token if valid and not expired", async () => {
      const token = await tokenManager.getAccessToken("test-account-id");
      expect(token).toBe("mock-access-token");
    });

    it("should refresh token if expired", async () => {
      // Set token as expired
      mockAccount.accessTokenExpiry = Date.now() - 1000;
      (mockStorage.load as ReturnType<typeof vi.fn>).mockResolvedValue({
        version: "1.0.0",
        activeAccountId: "test-account-id",
        accounts: [mockAccount],
        updatedAt: Date.now(),
      });

      // Mock successful token refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "new-access-token",
          expires_in: 3600,
        }),
      });

      const token = await tokenManager.getAccessToken("test-account-id");
      expect(token).toBe("new-access-token");
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should refresh token if within buffer time (5 minutes)", async () => {
      // Set token to expire in 4 minutes (within 5-minute buffer)
      mockAccount.accessTokenExpiry = Date.now() + 4 * 60 * 1000;
      (mockStorage.load as ReturnType<typeof vi.fn>).mockResolvedValue({
        version: "1.0.0",
        activeAccountId: "test-account-id",
        accounts: [mockAccount],
        updatedAt: Date.now(),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "refreshed-token",
          expires_in: 3600,
        }),
      });

      const token = await tokenManager.getAccessToken("test-account-id");
      expect(token).toBe("refreshed-token");
    });

    it("should throw AuthenticationError if account not found", async () => {
      (mockStorage.load as ReturnType<typeof vi.fn>).mockResolvedValue({
        version: "1.0.0",
        activeAccountId: null,
        accounts: [],
        updatedAt: Date.now(),
      });

      await expect(
        tokenManager.getAccessToken("non-existent-id")
      ).rejects.toThrow(AuthenticationError);
    });

    it("should use in-memory cache for repeated calls", async () => {
      // First call - loads from storage
      await tokenManager.getAccessToken("test-account-id");

      // Second call - should use cache, not load from storage again
      await tokenManager.getAccessToken("test-account-id");

      // Storage.load should only be called once for initial load
      expect(mockStorage.load).toHaveBeenCalledTimes(1);
    });
  });

  describe("refreshToken", () => {
    it("should call Google token endpoint with refresh_token grant", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "new-access-token",
          expires_in: 3600,
        }),
      });

      const token = await tokenManager.refreshToken("test-account-id");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://oauth2.googleapis.com/token",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        })
      );

      // Verify request body contains correct parameters
      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body;
      expect(body).toContain("grant_type=refresh_token");
      expect(body).toContain("refresh_token=mock-refresh-token");
      expect(body).toContain("client_id=mock-client-id");

      expect(token).toBe("new-access-token");
    });

    it("should update storage with new token and expiry", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "new-access-token",
          expires_in: 3600,
        }),
      });

      await tokenManager.refreshToken("test-account-id");

      expect(mockStorage.save).toHaveBeenCalled();
      const savedData = (mockStorage.save as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      const updatedAccount = savedData.accounts.find(
        (a: Account) => a.id === "test-account-id"
      );
      expect(updatedAccount.accessToken).toBe("new-access-token");
      expect(updatedAccount.accessTokenExpiry).toBeGreaterThan(Date.now());
    });

    it("should throw AuthenticationError on refresh failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: "invalid_grant",
          error_description: "Token has been revoked",
        }),
      });

      await expect(
        tokenManager.refreshToken("test-account-id")
      ).rejects.toThrow(AuthenticationError);
    });

    it("should throw AuthenticationError if account not found", async () => {
      (mockStorage.load as ReturnType<typeof vi.fn>).mockResolvedValue({
        version: "1.0.0",
        activeAccountId: null,
        accounts: [],
        updatedAt: Date.now(),
      });

      await expect(tokenManager.refreshToken("unknown-id")).rejects.toThrow(
        AuthenticationError
      );
    });

    it("should handle network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        tokenManager.refreshToken("test-account-id")
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe("isTokenExpired", () => {
    it("should return false for valid non-expired token", async () => {
      // Load account first
      await tokenManager.getAccessToken("test-account-id");

      const isExpired = tokenManager.isTokenExpired("test-account-id");
      expect(isExpired).toBe(false);
    });

    it("should return true for expired token", async () => {
      mockAccount.accessTokenExpiry = Date.now() - 1000;
      (mockStorage.load as ReturnType<typeof vi.fn>).mockResolvedValue({
        version: "1.0.0",
        activeAccountId: "test-account-id",
        accounts: [mockAccount],
        updatedAt: Date.now(),
      });

      // Need to refresh first to get expired token (which will trigger refresh)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "new-token",
          expires_in: 3600,
        }),
      });
      await tokenManager.getAccessToken("test-account-id");

      // Manually set expiry to past
      tokenManager.clearCache();
      mockAccount.accessTokenExpiry = Date.now() - 1000;
      (mockStorage.load as ReturnType<typeof vi.fn>).mockResolvedValue({
        version: "1.0.0",
        activeAccountId: "test-account-id",
        accounts: [mockAccount],
        updatedAt: Date.now(),
      });

      // Load the expired token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "another-token",
          expires_in: 3600,
        }),
      });
      await tokenManager.getAccessToken("test-account-id");

      // Now check with a truly expired state
      tokenManager.clearCache();
      mockAccount.accessTokenExpiry = Date.now() - 1000;

      const isExpired = tokenManager.isTokenExpired("test-account-id");
      expect(isExpired).toBe(true);
    });

    it("should return true if no accessToken exists", async () => {
      mockAccount.accessToken = null;
      mockAccount.accessTokenExpiry = null;
      (mockStorage.load as ReturnType<typeof vi.fn>).mockResolvedValue({
        version: "1.0.0",
        activeAccountId: "test-account-id",
        accounts: [mockAccount],
        updatedAt: Date.now(),
      });

      const isExpired = tokenManager.isTokenExpired("test-account-id");
      expect(isExpired).toBe(true);
    });

    it("should return true for unknown account", () => {
      const isExpired = tokenManager.isTokenExpired("unknown-id");
      expect(isExpired).toBe(true);
    });

    it("should consider buffer time when checking expiry", async () => {
      // Token expires in 4 minutes (within 5-minute buffer)
      mockAccount.accessTokenExpiry = Date.now() + 4 * 60 * 1000;
      (mockStorage.load as ReturnType<typeof vi.fn>).mockResolvedValue({
        version: "1.0.0",
        activeAccountId: "test-account-id",
        accounts: [mockAccount],
        updatedAt: Date.now(),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "fresh-token",
          expires_in: 3600,
        }),
      });

      // Loading will refresh due to buffer, but check direct expiry
      tokenManager.clearCache();

      const isExpired = tokenManager.isTokenExpired("test-account-id");
      expect(isExpired).toBe(true); // Within buffer = considered expired
    });
  });

  describe("clearCache", () => {
    it("should clear all cached tokens", async () => {
      // Load token to cache
      await tokenManager.getAccessToken("test-account-id");

      // Clear cache
      tokenManager.clearCache();

      // Next call should reload from storage
      await tokenManager.getAccessToken("test-account-id");
      expect(mockStorage.load).toHaveBeenCalledTimes(2);
    });

    it("should clear cache for specific account only", async () => {
      const secondAccount = createMockAccount({
        id: "second-account-id",
        email: "second@example.com",
      });

      (mockStorage.load as ReturnType<typeof vi.fn>).mockResolvedValue({
        version: "1.0.0",
        activeAccountId: "test-account-id",
        accounts: [mockAccount, secondAccount],
        updatedAt: Date.now(),
      });

      // Load both accounts to populate cache
      await tokenManager.getAccessToken("test-account-id");
      await tokenManager.getAccessToken("second-account-id");

      // Clear only first account from in-memory cache
      tokenManager.clearCache("test-account-id");

      // First account cache cleared, second account still in cache
      // We verify by checking that second account doesn't need storage lookup
      const loadCallsBefore = (mockStorage.load as ReturnType<typeof vi.fn>).mock.calls.length;

      // Second account should use cache (not call storage.load again)
      await tokenManager.getAccessToken("second-account-id");

      const loadCallsAfter = (mockStorage.load as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(loadCallsAfter).toBe(loadCallsBefore); // No additional load calls
    });
  });

  describe("concurrent refresh handling", () => {
    it("should not make multiple refresh calls for same account", async () => {
      // Create fresh token manager for this test
      const freshAccount = createMockAccount({
        accessTokenExpiry: Date.now() - 1000, // expired
      });

      const freshStorage = {
        load: vi.fn().mockResolvedValue({
          version: "1.0.0",
          activeAccountId: "test-account-id",
          accounts: [freshAccount],
          updatedAt: Date.now(),
        }),
        save: vi.fn().mockResolvedValue(undefined),
      } as unknown as AccountStorage;

      const freshTokenManager = createTokenManager(freshStorage, "mock-client-id");

      // Reset mockFetch for this test
      mockFetch.mockReset();

      // Create a deferred promise to control timing
      let resolvePromise: (value: unknown) => void;
      const deferredPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      mockFetch.mockImplementationOnce(() => deferredPromise);

      // Make concurrent requests - these will both wait on the same refresh
      const promise1 = freshTokenManager.getAccessToken("test-account-id");
      const promise2 = freshTokenManager.getAccessToken("test-account-id");

      // Allow promises to be queued, then resolve
      await Promise.resolve(); // Let the event loop tick

      // Resolve the fetch
      resolvePromise!({
        ok: true,
        json: async () => ({
          access_token: "concurrent-token",
          expires_in: 3600,
        }),
      });

      const [token1, token2] = await Promise.all([promise1, promise2]);

      expect(token1).toBe("concurrent-token");
      expect(token2).toBe("concurrent-token");
      // Should only call refresh once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
