// @TASK P2-M5-T2 - Account Rotator Unit Tests
// @SPEC Rate Limit detection, round-robin rotation, recovery logic

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  AccountRotator,
  createAccountRotator,
  AllAccountsRateLimitedError,
} from "../../../src/accounts/rotator";
import { AccountManager } from "../../../src/accounts/manager";
import { Account } from "../../../src/auth/storage";

// Helper to create a test account
const createTestAccount = (overrides: Partial<Account> = {}): Account => ({
  id: overrides.id ?? crypto.randomUUID(),
  email: overrides.email ?? "test@example.com",
  refreshToken: overrides.refreshToken ?? "refresh_token_123",
  accessToken: overrides.accessToken ?? null,
  accessTokenExpiry: overrides.accessTokenExpiry ?? null,
  quota: overrides.quota ?? {
    requestsRemaining: null,
    tokensRemaining: null,
    resetAt: null,
    updatedAt: Date.now(),
  },
  rateLimit: overrides.rateLimit ?? {
    isLimited: false,
    limitedUntil: null,
    consecutiveHits: 0,
  },
  createdAt: overrides.createdAt ?? Date.now(),
  lastUsedAt: overrides.lastUsedAt ?? Date.now(),
});

// Mock AccountManager
const createMockManager = (accounts: Account[] = []) => {
  return {
    getAccounts: vi.fn(() => [...accounts]),
    getAccount: vi.fn((id: string) => accounts.find((a) => a.id === id) ?? null),
    updateAccountStatus: vi.fn(),
    getActiveAccount: vi.fn(() => accounts[0] ?? null),
    setActiveAccount: vi.fn(),
  } as unknown as AccountManager;
};

describe("AccountRotator", () => {
  let rotator: AccountRotator;
  let mockManager: AccountManager;
  let accounts: Account[];

  beforeEach(() => {
    vi.useFakeTimers();
    accounts = [
      createTestAccount({ id: "account-1", email: "user1@example.com" }),
      createTestAccount({ id: "account-2", email: "user2@example.com" }),
      createTestAccount({ id: "account-3", email: "user3@example.com" }),
    ];
    mockManager = createMockManager(accounts);
    rotator = createAccountRotator(mockManager);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getNextAccount", () => {
    it("should return the first available account", () => {
      const account = rotator.getNextAccount();

      expect(account).toBeDefined();
      expect(account.id).toBe("account-1");
    });

    it("should implement round-robin rotation", () => {
      const first = rotator.getNextAccount();
      const second = rotator.getNextAccount();
      const third = rotator.getNextAccount();
      const fourth = rotator.getNextAccount();

      expect(first.id).toBe("account-1");
      expect(second.id).toBe("account-2");
      expect(third.id).toBe("account-3");
      // Should wrap around to first
      expect(fourth.id).toBe("account-1");
    });

    it("should skip rate limited accounts in rotation", () => {
      // Mark account-2 as rate limited
      rotator.markRateLimited("account-2", 60000);

      const first = rotator.getNextAccount();
      const second = rotator.getNextAccount();
      const third = rotator.getNextAccount();

      expect(first.id).toBe("account-1");
      expect(second.id).toBe("account-3"); // Skips account-2
      expect(third.id).toBe("account-1"); // Wraps around
    });

    it("should throw AllAccountsRateLimitedError when all accounts are rate limited", () => {
      rotator.markRateLimited("account-1", 60000);
      rotator.markRateLimited("account-2", 60000);
      rotator.markRateLimited("account-3", 60000);

      expect(() => rotator.getNextAccount()).toThrow(AllAccountsRateLimitedError);
    });

    it("should include retry information in AllAccountsRateLimitedError", () => {
      const now = Date.now();
      rotator.markRateLimited("account-1", 30000); // 30 seconds
      rotator.markRateLimited("account-2", 60000); // 60 seconds
      rotator.markRateLimited("account-3", 45000); // 45 seconds

      try {
        rotator.getNextAccount();
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AllAccountsRateLimitedError);
        const rateLimitError = error as AllAccountsRateLimitedError;
        // Should suggest earliest available time (30 seconds)
        expect(rateLimitError.retryAfterMs).toBeGreaterThanOrEqual(29000);
        expect(rateLimitError.retryAfterMs).toBeLessThanOrEqual(31000);
      }
    });

    it("should throw when no accounts are available", () => {
      mockManager = createMockManager([]);
      rotator = createAccountRotator(mockManager);

      expect(() => rotator.getNextAccount()).toThrow(AllAccountsRateLimitedError);
    });
  });

  describe("markRateLimited", () => {
    it("should mark an account as rate limited with retry time", () => {
      rotator.markRateLimited("account-1", 60000);

      expect(rotator.isRateLimited("account-1")).toBe(true);
    });

    it("should not affect other accounts", () => {
      rotator.markRateLimited("account-1", 60000);

      expect(rotator.isRateLimited("account-1")).toBe(true);
      expect(rotator.isRateLimited("account-2")).toBe(false);
      expect(rotator.isRateLimited("account-3")).toBe(false);
    });

    it("should update account status in manager", () => {
      rotator.markRateLimited("account-1", 60000);

      expect(mockManager.updateAccountStatus).toHaveBeenCalledWith("account-1", "limited");
    });

    it("should handle marking same account multiple times", () => {
      rotator.markRateLimited("account-1", 30000);
      rotator.markRateLimited("account-1", 60000);

      expect(rotator.isRateLimited("account-1")).toBe(true);
      // Should use latest retry time
      const limited = rotator.getRateLimitedAccounts();
      const account1Limited = limited.find((l) => l.account.id === "account-1");
      expect(account1Limited).toBeDefined();
    });
  });

  describe("clearRateLimit", () => {
    it("should clear rate limit for an account", () => {
      rotator.markRateLimited("account-1", 60000);
      expect(rotator.isRateLimited("account-1")).toBe(true);

      rotator.clearRateLimit("account-1");

      expect(rotator.isRateLimited("account-1")).toBe(false);
    });

    it("should update account status in manager", () => {
      rotator.markRateLimited("account-1", 60000);
      rotator.clearRateLimit("account-1");

      expect(mockManager.updateAccountStatus).toHaveBeenLastCalledWith("account-1", "ready");
    });

    it("should handle clearing non-limited account", () => {
      // Should not throw
      expect(() => rotator.clearRateLimit("account-1")).not.toThrow();
    });
  });

  describe("isRateLimited", () => {
    it("should return false for non-limited account", () => {
      expect(rotator.isRateLimited("account-1")).toBe(false);
    });

    it("should return true for limited account", () => {
      rotator.markRateLimited("account-1", 60000);

      expect(rotator.isRateLimited("account-1")).toBe(true);
    });

    it("should return false for unknown account", () => {
      expect(rotator.isRateLimited("non-existent")).toBe(false);
    });

    it("should auto-clear expired rate limits", () => {
      rotator.markRateLimited("account-1", 30000); // 30 seconds

      // Advance time by 31 seconds
      vi.advanceTimersByTime(31000);

      expect(rotator.isRateLimited("account-1")).toBe(false);
    });
  });

  describe("getAvailableAccounts", () => {
    it("should return all accounts when none are limited", () => {
      const available = rotator.getAvailableAccounts();

      expect(available).toHaveLength(3);
    });

    it("should exclude rate limited accounts", () => {
      rotator.markRateLimited("account-1", 60000);
      rotator.markRateLimited("account-3", 60000);

      const available = rotator.getAvailableAccounts();

      expect(available).toHaveLength(1);
      expect(available[0].id).toBe("account-2");
    });

    it("should include accounts whose rate limit has expired", () => {
      rotator.markRateLimited("account-1", 30000);

      // Advance time past the limit
      vi.advanceTimersByTime(31000);

      const available = rotator.getAvailableAccounts();
      expect(available).toHaveLength(3);
    });

    it("should return empty array when all accounts are limited", () => {
      rotator.markRateLimited("account-1", 60000);
      rotator.markRateLimited("account-2", 60000);
      rotator.markRateLimited("account-3", 60000);

      const available = rotator.getAvailableAccounts();

      expect(available).toHaveLength(0);
    });
  });

  describe("getRateLimitedAccounts", () => {
    it("should return empty array when no accounts are limited", () => {
      const limited = rotator.getRateLimitedAccounts();

      expect(limited).toHaveLength(0);
    });

    it("should return limited accounts with availableAt date", () => {
      const now = Date.now();
      rotator.markRateLimited("account-1", 60000);

      const limited = rotator.getRateLimitedAccounts();

      expect(limited).toHaveLength(1);
      expect(limited[0].account.id).toBe("account-1");
      expect(limited[0].availableAt.getTime()).toBeGreaterThanOrEqual(now + 59000);
      expect(limited[0].availableAt.getTime()).toBeLessThanOrEqual(now + 61000);
    });

    it("should not include expired rate limits", () => {
      rotator.markRateLimited("account-1", 30000);

      // Advance time past the limit
      vi.advanceTimersByTime(31000);

      const limited = rotator.getRateLimitedAccounts();
      expect(limited).toHaveLength(0);
    });

    it("should sort by availableAt ascending", () => {
      rotator.markRateLimited("account-3", 90000); // Latest
      rotator.markRateLimited("account-1", 30000); // Earliest
      rotator.markRateLimited("account-2", 60000); // Middle

      const limited = rotator.getRateLimitedAccounts();

      expect(limited[0].account.id).toBe("account-1");
      expect(limited[1].account.id).toBe("account-2");
      expect(limited[2].account.id).toBe("account-3");
    });
  });

  describe("automatic rate limit recovery", () => {
    it("should automatically recover account after rate limit expires", () => {
      rotator.markRateLimited("account-1", 30000);

      expect(rotator.isRateLimited("account-1")).toBe(true);

      // Advance time past the limit
      vi.advanceTimersByTime(31000);

      expect(rotator.isRateLimited("account-1")).toBe(false);
      // Account should be available again
      const available = rotator.getAvailableAccounts();
      expect(available.some((a) => a.id === "account-1")).toBe(true);
    });

    it("should include recovered account in rotation", () => {
      rotator.markRateLimited("account-1", 30000);

      // First two calls skip account-1
      expect(rotator.getNextAccount().id).toBe("account-2");
      expect(rotator.getNextAccount().id).toBe("account-3");

      // Advance time past the limit
      vi.advanceTimersByTime(31000);

      // Now account-1 should be back in rotation
      // Note: round-robin continues from where it left off
      expect(rotator.getNextAccount().id).toBe("account-1");
    });
  });

  describe("edge cases", () => {
    it("should handle single account scenario", () => {
      mockManager = createMockManager([
        createTestAccount({ id: "single-account", email: "solo@example.com" }),
      ]);
      rotator = createAccountRotator(mockManager);

      const first = rotator.getNextAccount();
      const second = rotator.getNextAccount();

      expect(first.id).toBe("single-account");
      expect(second.id).toBe("single-account");
    });

    it("should handle rate limiting single account", () => {
      mockManager = createMockManager([
        createTestAccount({ id: "single-account", email: "solo@example.com" }),
      ]);
      rotator = createAccountRotator(mockManager);

      rotator.markRateLimited("single-account", 60000);

      expect(() => rotator.getNextAccount()).toThrow(AllAccountsRateLimitedError);
    });

    it("should refresh accounts from manager on each getNextAccount call", () => {
      // Initially 3 accounts
      let first = rotator.getNextAccount();
      expect(first.id).toBe("account-1");

      // Simulate adding a new account
      const newAccount = createTestAccount({ id: "account-4", email: "user4@example.com" });
      accounts.push(newAccount);
      (mockManager.getAccounts as ReturnType<typeof vi.fn>).mockReturnValue([...accounts]);

      // Round-robin should eventually include new account
      rotator.getNextAccount(); // account-2
      rotator.getNextAccount(); // account-3
      const fourth = rotator.getNextAccount(); // Should wrap to account-1 or include account-4

      // The rotator should have refreshed its view of accounts
      expect(rotator.getAvailableAccounts()).toHaveLength(4);
    });
  });
});
