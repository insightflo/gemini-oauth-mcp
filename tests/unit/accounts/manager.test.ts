// @TASK P2-M5-T1 - Account Manager Unit Tests
// @SPEC Account CRUD, active account, status management

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AccountManager, createAccountManager } from "../../../src/accounts/manager";
import { AccountStorage, Account, AccountsStorage } from "../../../src/auth/storage";
import { AuthenticationError } from "../../../src/utils/errors";

// Mock AccountStorage
const createMockStorage = () => {
  let data: AccountsStorage = {
    version: "1.0.0",
    activeAccountId: null,
    accounts: [],
    updatedAt: Date.now(),
  };

  return {
    load: vi.fn(async () => data),
    save: vi.fn(async (newData: AccountsStorage) => {
      data = newData;
    }),
    _getData: () => data,
    _setData: (newData: AccountsStorage) => {
      data = newData;
    },
  } as unknown as AccountStorage & {
    _getData: () => AccountsStorage;
    _setData: (data: AccountsStorage) => void;
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

describe("AccountManager", () => {
  let storage: ReturnType<typeof createMockStorage>;
  let manager: AccountManager;

  beforeEach(() => {
    storage = createMockStorage();
    manager = createAccountManager(storage);
  });

  describe("addAccount", () => {
    it("should add a new account with refresh token and email", async () => {
      const account = await manager.addAccount({ refreshToken: "refresh_token_abc", email: "user@example.com" });

      expect(account).toBeDefined();
      expect(account.email).toBe("user@example.com");
      expect(account.refreshToken).toBe("refresh_token_abc");
      expect(account.id).toBeDefined();
      expect(storage.save).toHaveBeenCalled();
    });

    it("should generate a unique UUID for the account", async () => {
      const account1 = await manager.addAccount({ refreshToken: "token1", email: "user1@example.com" });
      const account2 = await manager.addAccount({ refreshToken: "token2", email: "user2@example.com" });

      expect(account1.id).not.toBe(account2.id);
      expect(account1.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("should set the first account as active automatically", async () => {
      await manager.addAccount({ refreshToken: "token1", email: "user1@example.com" });

      const active = manager.getActiveAccount();
      expect(active).toBeDefined();
      expect(active?.email).toBe("user1@example.com");
    });

    it("should not change active account when adding subsequent accounts", async () => {
      await manager.addAccount({ refreshToken: "token1", email: "user1@example.com" });
      await manager.addAccount({ refreshToken: "token2", email: "user2@example.com" });

      const active = manager.getActiveAccount();
      expect(active?.email).toBe("user1@example.com");
    });

    it("should initialize account with default quota and rate limit", async () => {
      const account = await manager.addAccount({ refreshToken: "token", email: "user@example.com" });

      expect(account.quota).toEqual({
        requestsRemaining: null,
        tokensRemaining: null,
        resetAt: null,
        updatedAt: expect.any(Number),
      });
      expect(account.rateLimit).toEqual({
        isLimited: false,
        limitedUntil: null,
        consecutiveHits: 0,
      });
    });

    it("should throw error for duplicate email", async () => {
      await manager.addAccount({ refreshToken: "token1", email: "same@example.com" });

      await expect(manager.addAccount({ refreshToken: "token2", email: "same@example.com" })).rejects.toThrow(
        AuthenticationError
      );
    });
  });

  describe("getAccount", () => {
    it("should return account by ID", async () => {
      const added = await manager.addAccount({ refreshToken: "token", email: "user@example.com" });

      const found = manager.getAccount(added.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(added.id);
      expect(found?.email).toBe("user@example.com");
    });

    it("should return null for non-existent account", () => {
      const found = manager.getAccount("non-existent-id");
      expect(found).toBeNull();
    });
  });

  describe("getAccounts", () => {
    it("should return empty array when no accounts", () => {
      const accounts = manager.getAccounts();
      expect(accounts).toEqual([]);
    });

    it("should return all accounts", async () => {
      await manager.addAccount({ refreshToken: "token1", email: "user1@example.com" });
      await manager.addAccount({ refreshToken: "token2", email: "user2@example.com" });

      const accounts = manager.getAccounts();
      expect(accounts).toHaveLength(2);
    });
  });

  describe("removeAccount", () => {
    it("should remove account by ID and return true", async () => {
      const account = await manager.addAccount({ refreshToken: "token", email: "user@example.com" });

      const result = manager.removeAccount(account.id);

      expect(result).toBe(true);
      expect(manager.getAccount(account.id)).toBeNull();
      expect(storage.save).toHaveBeenCalled();
    });

    it("should return false for non-existent account", () => {
      const result = manager.removeAccount("non-existent-id");
      expect(result).toBe(false);
    });

    it("should clear active account when removing active account", async () => {
      const account = await manager.addAccount({ refreshToken: "token", email: "user@example.com" });
      expect(manager.getActiveAccount()).toBeDefined();

      manager.removeAccount(account.id);

      expect(manager.getActiveAccount()).toBeNull();
    });

    it("should set next account as active when removing active account with multiple accounts", async () => {
      const account1 = await manager.addAccount({ refreshToken: "token1", email: "user1@example.com" });
      const account2 = await manager.addAccount({ refreshToken: "token2", email: "user2@example.com" });

      expect(manager.getActiveAccount()?.id).toBe(account1.id);

      manager.removeAccount(account1.id);

      expect(manager.getActiveAccount()?.id).toBe(account2.id);
    });
  });

  describe("setActiveAccount", () => {
    it("should set the active account", async () => {
      await manager.addAccount({ refreshToken: "token1", email: "user1@example.com" });
      const account2 = await manager.addAccount({ refreshToken: "token2", email: "user2@example.com" });

      manager.setActiveAccount(account2.id);

      expect(manager.getActiveAccount()?.id).toBe(account2.id);
      expect(storage.save).toHaveBeenCalled();
    });

    it("should throw error for non-existent account", () => {
      expect(() => manager.setActiveAccount("non-existent-id")).toThrow(
        AuthenticationError
      );
    });
  });

  describe("getActiveAccount", () => {
    it("should return null when no accounts", () => {
      expect(manager.getActiveAccount()).toBeNull();
    });

    it("should return active account", async () => {
      const account = await manager.addAccount({ refreshToken: "token", email: "user@example.com" });

      const active = manager.getActiveAccount();
      expect(active?.id).toBe(account.id);
    });
  });

  describe("updateAccountStatus", () => {
    it("should update account status to 'active'", async () => {
      const account = await manager.addAccount({ refreshToken: "token", email: "user@example.com" });

      manager.updateAccountStatus(account.id, "active");

      // Status is reflected in rateLimit.isLimited
      const updated = manager.getAccount(account.id);
      expect(updated?.rateLimit.isLimited).toBe(false);
      expect(storage.save).toHaveBeenCalled();
    });

    it("should update account status to 'ready'", async () => {
      const account = await manager.addAccount({ refreshToken: "token", email: "user@example.com" });

      manager.updateAccountStatus(account.id, "ready");

      const updated = manager.getAccount(account.id);
      expect(updated?.rateLimit.isLimited).toBe(false);
    });

    it("should update account status to 'limited'", async () => {
      const account = await manager.addAccount({ refreshToken: "token", email: "user@example.com" });

      manager.updateAccountStatus(account.id, "limited");

      const updated = manager.getAccount(account.id);
      expect(updated?.rateLimit.isLimited).toBe(true);
    });

    it("should throw error for non-existent account", () => {
      expect(() => manager.updateAccountStatus("non-existent-id", "active")).toThrow(
        AuthenticationError
      );
    });
  });

  describe("initialization", () => {
    it("should load existing accounts from storage", async () => {
      const existingAccount = createTestAccount({
        email: "existing@example.com",
      });

      storage._setData({
        version: "1.0.0",
        activeAccountId: existingAccount.id,
        accounts: [existingAccount],
        updatedAt: Date.now(),
      });

      // Create new manager to trigger load
      const newManager = createAccountManager(storage);
      await newManager.initialize();

      expect(newManager.getAccounts()).toHaveLength(1);
      expect(newManager.getAccount(existingAccount.id)?.email).toBe("existing@example.com");
    });
  });

  describe("edge cases", () => {
    it("should handle concurrent operations safely", async () => {
      const promises = [
        manager.addAccount({ refreshToken: "token1", email: "user1@example.com" }),
        manager.addAccount({ refreshToken: "token2", email: "user2@example.com" }),
        manager.addAccount({ refreshToken: "token3", email: "user3@example.com" }),
      ];

      const accounts = await Promise.all(promises);

      expect(accounts).toHaveLength(3);
      expect(manager.getAccounts()).toHaveLength(3);
    });

    it("should preserve account data on update", async () => {
      const account = await manager.addAccount({ refreshToken: "token", email: "user@example.com" });

      // Update status
      manager.updateAccountStatus(account.id, "limited");

      // Verify other fields are preserved
      const updated = manager.getAccount(account.id);
      expect(updated?.email).toBe("user@example.com");
      expect(updated?.refreshToken).toBe("token");
    });
  });
});
