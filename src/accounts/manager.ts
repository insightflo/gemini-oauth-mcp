// @TASK P2-M5-T1 - Account Manager Implementation
// @SPEC Account CRUD, active account, status management

import { AccountStorage, Account, AccountsStorage } from "../auth/storage.js";
import { AuthenticationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Account status types
 * - active: Currently in use, available for requests
 * - ready: Available but not currently active
 * - limited: Rate limited, temporarily unavailable
 */
export type AccountStatus = "active" | "ready" | "limited";

/**
 * AccountManager interface for managing multiple OAuth accounts
 */
export interface AccountManager {
  /**
   * Initialize manager by loading accounts from storage
   */
  initialize(): Promise<void>;

  /**
   * Add a new account with refresh token and email
   * @param refreshToken - OAuth refresh token
   * @param email - Account email address
   * @returns The created Account
   * @throws AuthenticationError if email already exists
   */
  addAccount(refreshToken: string, email: string): Promise<Account>;

  /**
   * Get account by ID
   * @param accountId - Account UUID
   * @returns Account or null if not found
   */
  getAccount(accountId: string): Account | null;

  /**
   * Get all accounts
   * @returns Array of all accounts
   */
  getAccounts(): Account[];

  /**
   * Remove account by ID
   * @param accountId - Account UUID
   * @returns true if removed, false if not found
   */
  removeAccount(accountId: string): boolean;

  /**
   * Set the active account
   * @param accountId - Account UUID to set as active
   * @throws AuthenticationError if account not found
   */
  setActiveAccount(accountId: string): void;

  /**
   * Get the currently active account
   * @returns Active account or null
   */
  getActiveAccount(): Account | null;

  /**
   * Update account status
   * @param accountId - Account UUID
   * @param status - New status
   * @throws AuthenticationError if account not found
   */
  updateAccountStatus(accountId: string, status: AccountStatus): void;
}

/**
 * Implementation of AccountManager
 */
class AccountManagerImpl implements AccountManager {
  private readonly storage: AccountStorage;
  private data: AccountsStorage;
  private initialized: boolean = false;

  constructor(storage: AccountStorage) {
    this.storage = storage;
    // Initialize with default empty data
    this.data = {
      version: "1.0.0",
      activeAccountId: null,
      accounts: [],
      updatedAt: Date.now(),
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.data = await this.storage.load();
      this.initialized = true;
      logger.info("AccountManager initialized", {
        accountCount: this.data.accounts.length,
      });
    } catch (error) {
      logger.error("Failed to initialize AccountManager", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  async addAccount(refreshToken: string, email: string): Promise<Account> {
    await this.ensureInitialized();

    // Check for duplicate email
    const existingAccount = this.data.accounts.find(
      (a: Account) => a.email.toLowerCase() === email.toLowerCase()
    );
    if (existingAccount) {
      throw new AuthenticationError(`Account with email ${email} already exists`, {
        email,
        existingAccountId: existingAccount.id,
      });
    }

    const now = Date.now();
    const account: Account = {
      id: crypto.randomUUID(),
      email,
      refreshToken,
      accessToken: null,
      accessTokenExpiry: null,
      quota: {
        requestsRemaining: null,
        tokensRemaining: null,
        resetAt: null,
        updatedAt: now,
      },
      rateLimit: {
        isLimited: false,
        limitedUntil: null,
        consecutiveHits: 0,
      },
      createdAt: now,
      lastUsedAt: now,
    };

    // Add account
    this.data.accounts.push(account);
    this.data.updatedAt = now;

    // Set as active if this is the first account
    if (this.data.accounts.length === 1) {
      this.data.activeAccountId = account.id;
    }

    // Save to storage
    await this.saveData();

    logger.info("Account added", { accountId: account.id, email });
    return account;
  }

  getAccount(accountId: string): Account | null {
    return this.data.accounts.find((a: Account) => a.id === accountId) ?? null;
  }

  getAccounts(): Account[] {
    return [...this.data.accounts];
  }

  removeAccount(accountId: string): boolean {
    const index = this.data.accounts.findIndex((a: Account) => a.id === accountId);
    if (index === -1) {
      return false;
    }

    // Remove account
    this.data.accounts.splice(index, 1);
    this.data.updatedAt = Date.now();

    // Handle active account removal
    if (this.data.activeAccountId === accountId) {
      // Set next available account as active, or null if none
      const firstAccount = this.data.accounts[0];
      this.data.activeAccountId = firstAccount?.id ?? null;
    }

    // Save to storage (fire and forget for sync method)
    this.saveData().catch((error) => {
      logger.error("Failed to save after removing account", {
        accountId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });

    logger.info("Account removed", { accountId });
    return true;
  }

  setActiveAccount(accountId: string): void {
    const account = this.getAccount(accountId);
    if (!account) {
      throw new AuthenticationError(`Account not found: ${accountId}`, {
        accountId,
      });
    }

    this.data.activeAccountId = accountId;
    this.data.updatedAt = Date.now();

    // Save to storage (fire and forget for sync method)
    this.saveData().catch((error) => {
      logger.error("Failed to save after setting active account", {
        accountId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });

    logger.info("Active account set", { accountId });
  }

  getActiveAccount(): Account | null {
    if (!this.data.activeAccountId) {
      return null;
    }
    return this.getAccount(this.data.activeAccountId);
  }

  updateAccountStatus(accountId: string, status: AccountStatus): void {
    const accountIndex = this.data.accounts.findIndex((a: Account) => a.id === accountId);
    if (accountIndex === -1) {
      throw new AuthenticationError(`Account not found: ${accountId}`, {
        accountId,
      });
    }

    const account = this.data.accounts[accountIndex]!;
    const now = Date.now();

    // Update rate limit status based on status
    switch (status) {
      case "active":
      case "ready":
        this.data.accounts[accountIndex] = {
          ...account,
          rateLimit: {
            ...account.rateLimit,
            isLimited: false,
            limitedUntil: null,
          },
        };
        break;
      case "limited":
        this.data.accounts[accountIndex] = {
          ...account,
          rateLimit: {
            ...account.rateLimit,
            isLimited: true,
            limitedUntil: now + 60 * 1000, // Default 1 minute limit
          },
        };
        break;
    }

    this.data.updatedAt = now;

    // Save to storage (fire and forget for sync method)
    this.saveData().catch((error) => {
      logger.error("Failed to save after updating account status", {
        accountId,
        status,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });

    logger.debug("Account status updated", { accountId, status });
  }

  /**
   * Ensure manager is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Save data to storage
   */
  private async saveData(): Promise<void> {
    await this.storage.save(this.data);
  }
}

/**
 * Factory function to create an AccountManager instance
 * @param storage - AccountStorage instance
 * @returns AccountManager instance
 */
export function createAccountManager(storage: AccountStorage): AccountManager {
  return new AccountManagerImpl(storage);
}
