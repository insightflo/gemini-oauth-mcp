// @TASK P2-M5-T2 - Account Rotator Implementation
// @SPEC Rate Limit detection, round-robin rotation, recovery logic

import { Account } from "../auth/storage.js";
import { AccountManager } from "./manager.js";
import { RateLimitError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Error thrown when all accounts are rate limited
 */
export class AllAccountsRateLimitedError extends RateLimitError {
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(
      "All accounts are currently rate limited",
      Math.ceil(retryAfterMs / 1000), // Convert to seconds for parent
      { retryAfterMs }
    );
    this.name = "AllAccountsRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Rate limited account info
 */
interface RateLimitedAccountInfo {
  account: Account;
  availableAt: Date;
}

/**
 * Internal rate limit tracking
 */
interface RateLimitEntry {
  accountId: string;
  availableAt: number; // Timestamp
}

/**
 * AccountRotator interface for managing account rotation and rate limiting
 */
export interface AccountRotator {
  /**
   * Get the next available account using round-robin rotation
   * @returns The next available account
   * @throws AllAccountsRateLimitedError if no accounts are available
   */
  getNextAccount(): Account;

  /**
   * Mark an account as rate limited
   * @param accountId - Account UUID
   * @param retryAfterMs - Time in milliseconds until rate limit expires
   */
  markRateLimited(accountId: string, retryAfterMs: number): void;

  /**
   * Clear rate limit for an account
   * @param accountId - Account UUID
   */
  clearRateLimit(accountId: string): void;

  /**
   * Check if an account is rate limited
   * @param accountId - Account UUID
   * @returns true if rate limited, false otherwise
   */
  isRateLimited(accountId: string): boolean;

  /**
   * Get all available (non-rate-limited) accounts
   * @returns Array of available accounts
   */
  getAvailableAccounts(): Account[];

  /**
   * Get all rate limited accounts with their available times
   * @returns Array of rate limited account info, sorted by availableAt ascending
   */
  getRateLimitedAccounts(): RateLimitedAccountInfo[];
}

/**
 * Implementation of AccountRotator with round-robin rotation
 */
class AccountRotatorImpl implements AccountRotator {
  private readonly manager: AccountManager;
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private currentIndex: number = 0;

  constructor(manager: AccountManager) {
    this.manager = manager;
  }

  getNextAccount(): Account {
    const available = this.getAvailableAccounts();

    if (available.length === 0) {
      const retryAfterMs = this.getEarliestRetryTime();
      logger.warn("All accounts rate limited", { retryAfterMs });
      throw new AllAccountsRateLimitedError(retryAfterMs);
    }

    // Get accounts from manager to maintain consistent ordering
    const allAccounts = this.manager.getAccounts();
    const availableIds = new Set(available.map((a) => a.id));

    // Find next available account using round-robin
    let attempts = 0;
    while (attempts < allAccounts.length) {
      const index = this.currentIndex % allAccounts.length;
      const account = allAccounts[index];
      this.currentIndex = (this.currentIndex + 1) % allAccounts.length;

      if (account && availableIds.has(account.id)) {
        logger.debug("Account selected for rotation", {
          accountId: account.id,
          email: account.email,
        });
        return account;
      }
      attempts++;
    }

    // Fallback: should not reach here if available.length > 0
    // TypeScript guard: available[0] is guaranteed to exist since we check length > 0 above
    return available[0]!;
  }

  markRateLimited(accountId: string, retryAfterMs: number): void {
    const availableAt = Date.now() + retryAfterMs;

    this.rateLimits.set(accountId, {
      accountId,
      availableAt,
    });

    // Update manager status
    try {
      this.manager.updateAccountStatus(accountId, "limited");
    } catch {
      // Account may not exist in manager, but we still track it
      logger.debug("Could not update account status in manager", { accountId });
    }

    logger.info("Account marked as rate limited", {
      accountId,
      retryAfterMs,
      availableAt: new Date(availableAt).toISOString(),
    });
  }

  clearRateLimit(accountId: string): void {
    const wasLimited = this.rateLimits.has(accountId);
    this.rateLimits.delete(accountId);

    if (wasLimited) {
      // Update manager status
      try {
        this.manager.updateAccountStatus(accountId, "ready");
      } catch {
        // Account may not exist in manager
        logger.debug("Could not update account status in manager", { accountId });
      }

      logger.info("Rate limit cleared for account", { accountId });
    }
  }

  isRateLimited(accountId: string): boolean {
    const entry = this.rateLimits.get(accountId);

    if (!entry) {
      return false;
    }

    // Check if rate limit has expired
    if (Date.now() >= entry.availableAt) {
      // Auto-clear expired rate limit
      this.rateLimits.delete(accountId);
      logger.debug("Rate limit auto-expired", { accountId });
      return false;
    }

    return true;
  }

  getAvailableAccounts(): Account[] {
    const allAccounts = this.manager.getAccounts();
    const now = Date.now();

    return allAccounts.filter((account) => {
      const entry = this.rateLimits.get(account.id);

      if (!entry) {
        return true;
      }

      // Check if rate limit has expired
      if (now >= entry.availableAt) {
        // Auto-clear expired rate limit
        this.rateLimits.delete(account.id);
        return true;
      }

      return false;
    });
  }

  getRateLimitedAccounts(): RateLimitedAccountInfo[] {
    const allAccounts = this.manager.getAccounts();
    const accountMap = new Map(allAccounts.map((a) => [a.id, a]));
    const now = Date.now();
    const result: RateLimitedAccountInfo[] = [];

    for (const [accountId, entry] of this.rateLimits.entries()) {
      // Skip expired entries
      if (now >= entry.availableAt) {
        this.rateLimits.delete(accountId);
        continue;
      }

      const account = accountMap.get(accountId);
      if (account) {
        result.push({
          account,
          availableAt: new Date(entry.availableAt),
        });
      }
    }

    // Sort by availableAt ascending (earliest first)
    result.sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime());

    return result;
  }

  /**
   * Get the earliest time when any account becomes available
   * @returns Time in milliseconds until earliest account is available
   */
  private getEarliestRetryTime(): number {
    const now = Date.now();
    let earliest = Infinity;

    for (const entry of this.rateLimits.values()) {
      if (entry.availableAt < earliest) {
        earliest = entry.availableAt;
      }
    }

    if (earliest === Infinity) {
      // No accounts at all
      return 0;
    }

    return Math.max(0, earliest - now);
  }
}

/**
 * Factory function to create an AccountRotator instance
 * @param manager - AccountManager instance
 * @returns AccountRotator instance
 */
export function createAccountRotator(manager: AccountManager): AccountRotator {
  return new AccountRotatorImpl(manager);
}
