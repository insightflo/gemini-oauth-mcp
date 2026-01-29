// @TASK P2-M5-T3 - Quota Tracker Unit Tests
// @SPEC 계정별 할당량 추적, API 응답에서 할당량 정보 추출, 리셋 시간 계산

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  QuotaTracker,
  QuotaInfo,
  createQuotaTracker,
} from "../../../src/accounts/quota";
import { AccountManager } from "../../../src/accounts/manager";
import { Account } from "../../../src/auth/storage";

// Mock AccountManager
const createMockAccountManager = () => {
  const accounts: Map<string, Account> = new Map();

  return {
    getAccount: vi.fn((id: string) => accounts.get(id) ?? null),
    getAccounts: vi.fn(() => Array.from(accounts.values())),
    _addAccount: (account: Account) => accounts.set(account.id, account),
    _clearAccounts: () => accounts.clear(),
  } as unknown as AccountManager & {
    _addAccount: (account: Account) => void;
    _clearAccounts: () => void;
  };
};

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

describe("QuotaTracker", () => {
  let accountManager: ReturnType<typeof createMockAccountManager>;
  let tracker: QuotaTracker;

  beforeEach(() => {
    accountManager = createMockAccountManager();
    tracker = createQuotaTracker(accountManager);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("updateQuota", () => {
    it("should update quota for an existing account", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      tracker.updateQuota(account.id, 50, 100);

      const quota = tracker.getQuota(account.id);
      expect(quota).toBeDefined();
      expect(quota?.used).toBe(50);
      expect(quota?.limit).toBe(100);
      expect(quota?.percentage).toBe(50);
    });

    it("should update quota with reset time", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);
      const resetAt = new Date("2024-01-16T00:00:00Z");

      tracker.updateQuota(account.id, 80, 100, resetAt);

      const quota = tracker.getQuota(account.id);
      expect(quota?.resetAt).toEqual(resetAt);
    });

    it("should calculate percentage correctly", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      tracker.updateQuota(account.id, 75, 100);

      expect(tracker.getQuota(account.id)?.percentage).toBe(75);
    });

    it("should mark as limited when usage exceeds limit", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      tracker.updateQuota(account.id, 100, 100);

      expect(tracker.getQuota(account.id)?.isLimited).toBe(true);
    });

    it("should not mark as limited when usage is below limit", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      tracker.updateQuota(account.id, 50, 100);

      expect(tracker.getQuota(account.id)?.isLimited).toBe(false);
    });

    it("should handle zero limit gracefully", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      tracker.updateQuota(account.id, 0, 0);

      const quota = tracker.getQuota(account.id);
      expect(quota?.percentage).toBe(100);
      expect(quota?.isLimited).toBe(true);
    });
  });

  describe("getQuota", () => {
    it("should return null for non-existent account", () => {
      const quota = tracker.getQuota("non-existent-id");
      expect(quota).toBeNull();
    });

    it("should return null for account without quota data", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      const quota = tracker.getQuota(account.id);
      expect(quota).toBeNull();
    });

    it("should include account email in quota info", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      tracker.updateQuota(account.id, 50, 100);

      const quota = tracker.getQuota(account.id);
      expect(quota?.email).toBe("user@example.com");
      expect(quota?.accountId).toBe(account.id);
    });
  });

  describe("getAllQuotas", () => {
    it("should return empty array when no quotas are tracked", () => {
      const quotas = tracker.getAllQuotas();
      expect(quotas).toEqual([]);
    });

    it("should return all tracked quotas", () => {
      const account1 = createTestAccount({ email: "user1@example.com" });
      const account2 = createTestAccount({ email: "user2@example.com" });
      accountManager._addAccount(account1);
      accountManager._addAccount(account2);

      tracker.updateQuota(account1.id, 30, 100);
      tracker.updateQuota(account2.id, 70, 100);

      const quotas = tracker.getAllQuotas();
      expect(quotas).toHaveLength(2);
      expect(quotas.map((q) => q.email)).toContain("user1@example.com");
      expect(quotas.map((q) => q.email)).toContain("user2@example.com");
    });

    it("should only return quotas for accounts that still exist", () => {
      const account1 = createTestAccount({ email: "user1@example.com" });
      const account2 = createTestAccount({ email: "user2@example.com" });
      accountManager._addAccount(account1);
      accountManager._addAccount(account2);

      tracker.updateQuota(account1.id, 30, 100);
      tracker.updateQuota(account2.id, 70, 100);

      // Remove account2 from manager (simulating account deletion)
      accountManager._clearAccounts();
      accountManager._addAccount(account1);

      const quotas = tracker.getAllQuotas();
      expect(quotas).toHaveLength(1);
      expect(quotas[0]?.email).toBe("user1@example.com");
    });
  });

  describe("incrementUsage", () => {
    it("should increment used count by 1", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      tracker.updateQuota(account.id, 50, 100);
      tracker.incrementUsage(account.id);

      expect(tracker.getQuota(account.id)?.used).toBe(51);
    });

    it("should update percentage after increment", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      tracker.updateQuota(account.id, 99, 100);
      tracker.incrementUsage(account.id);

      const quota = tracker.getQuota(account.id);
      expect(quota?.used).toBe(100);
      expect(quota?.percentage).toBe(100);
      expect(quota?.isLimited).toBe(true);
    });

    it("should do nothing for non-existent account", () => {
      // Should not throw
      expect(() => tracker.incrementUsage("non-existent-id")).not.toThrow();
    });

    it("should do nothing for account without quota data", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      // Should not throw
      expect(() => tracker.incrementUsage(account.id)).not.toThrow();
    });
  });

  describe("resetQuota", () => {
    it("should reset usage to 0", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      tracker.updateQuota(account.id, 80, 100);
      tracker.resetQuota(account.id);

      const quota = tracker.getQuota(account.id);
      expect(quota?.used).toBe(0);
      expect(quota?.percentage).toBe(0);
      expect(quota?.isLimited).toBe(false);
    });

    it("should clear reset time", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      tracker.updateQuota(account.id, 80, 100, new Date("2024-01-16T00:00:00Z"));
      tracker.resetQuota(account.id);

      expect(tracker.getQuota(account.id)?.resetAt).toBeNull();
    });

    it("should do nothing for non-existent account", () => {
      expect(() => tracker.resetQuota("non-existent-id")).not.toThrow();
    });
  });

  describe("getTotalAvailable", () => {
    it("should return 0 when no quotas are tracked", () => {
      expect(tracker.getTotalAvailable()).toBe(0);
    });

    it("should sum available quota across all accounts", () => {
      const account1 = createTestAccount({ email: "user1@example.com" });
      const account2 = createTestAccount({ email: "user2@example.com" });
      accountManager._addAccount(account1);
      accountManager._addAccount(account2);

      tracker.updateQuota(account1.id, 30, 100); // 70 available
      tracker.updateQuota(account2.id, 50, 100); // 50 available

      expect(tracker.getTotalAvailable()).toBe(120);
    });

    it("should not count limited accounts", () => {
      const account1 = createTestAccount({ email: "user1@example.com" });
      const account2 = createTestAccount({ email: "user2@example.com" });
      accountManager._addAccount(account1);
      accountManager._addAccount(account2);

      tracker.updateQuota(account1.id, 30, 100); // 70 available
      tracker.updateQuota(account2.id, 100, 100); // 0 available (limited)

      expect(tracker.getTotalAvailable()).toBe(70);
    });

    it("should return 0 when all accounts are limited", () => {
      const account1 = createTestAccount({ email: "user1@example.com" });
      accountManager._addAccount(account1);

      tracker.updateQuota(account1.id, 100, 100);

      expect(tracker.getTotalAvailable()).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle updating quota multiple times", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      tracker.updateQuota(account.id, 10, 100);
      tracker.updateQuota(account.id, 20, 100);
      tracker.updateQuota(account.id, 30, 100);

      expect(tracker.getQuota(account.id)?.used).toBe(30);
    });

    it("should handle very large numbers", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      tracker.updateQuota(account.id, 999999, 1000000);

      const quota = tracker.getQuota(account.id);
      expect(quota?.used).toBe(999999);
      expect(quota?.limit).toBe(1000000);
      expect(quota?.percentage).toBeCloseTo(99.9999, 2);
    });

    it("should handle usage exceeding limit", () => {
      const account = createTestAccount({ email: "user@example.com" });
      accountManager._addAccount(account);

      tracker.updateQuota(account.id, 150, 100);

      const quota = tracker.getQuota(account.id);
      expect(quota?.used).toBe(150);
      expect(quota?.percentage).toBe(150);
      expect(quota?.isLimited).toBe(true);
    });
  });
});
