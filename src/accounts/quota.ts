// @TASK P2-M5-T3 - Quota Tracker Implementation
// @SPEC 계정별 할당량 추적, API 응답에서 할당량 정보 추출, 리셋 시간 계산

import { AccountManager } from "./manager.js";
import { logger } from "../utils/logger.js";

/**
 * Quota information for an account
 */
export interface QuotaInfo {
  accountId: string;
  email: string;
  used: number;
  limit: number;
  percentage: number;
  resetAt: Date | null;
  isLimited: boolean;
}

/**
 * Internal quota data structure
 */
interface QuotaData {
  used: number;
  limit: number;
  resetAt: Date | null;
}

/**
 * QuotaTracker interface for managing account quotas
 */
export interface QuotaTracker {
  /**
   * Update quota information for an account
   * @param accountId - Account UUID
   * @param used - Current usage count
   * @param limit - Maximum limit
   * @param resetAt - Optional reset time
   */
  updateQuota(accountId: string, used: number, limit: number, resetAt?: Date): void;

  /**
   * Get quota information for an account
   * @param accountId - Account UUID
   * @returns QuotaInfo or null if not found/no data
   */
  getQuota(accountId: string): QuotaInfo | null;

  /**
   * Get all tracked quotas
   * @returns Array of QuotaInfo for all accounts with quota data
   */
  getAllQuotas(): QuotaInfo[];

  /**
   * Increment usage count for an account by 1
   * @param accountId - Account UUID
   */
  incrementUsage(accountId: string): void;

  /**
   * Reset quota usage for an account to 0
   * @param accountId - Account UUID
   */
  resetQuota(accountId: string): void;

  /**
   * Get total available quota across all non-limited accounts
   * @returns Total available quota
   */
  getTotalAvailable(): number;
}

/**
 * QuotaTracker implementation
 */
class QuotaTrackerImpl implements QuotaTracker {
  private readonly accountManager: AccountManager;
  private readonly quotas: Map<string, QuotaData> = new Map();

  constructor(accountManager: AccountManager) {
    this.accountManager = accountManager;
  }

  updateQuota(accountId: string, used: number, limit: number, resetAt?: Date): void {
    const account = this.accountManager.getAccount(accountId);
    if (!account) {
      logger.warn("Attempted to update quota for non-existent account", { accountId });
      return;
    }

    this.quotas.set(accountId, {
      used,
      limit,
      resetAt: resetAt ?? null,
    });

    logger.debug("Quota updated", {
      accountId,
      used,
      limit,
      percentage: this.calculatePercentage(used, limit),
    });
  }

  getQuota(accountId: string): QuotaInfo | null {
    const account = this.accountManager.getAccount(accountId);
    if (!account) {
      return null;
    }

    const quotaData = this.quotas.get(accountId);
    if (!quotaData) {
      return null;
    }

    return this.buildQuotaInfo(accountId, account.email, quotaData);
  }

  getAllQuotas(): QuotaInfo[] {
    const result: QuotaInfo[] = [];

    for (const [accountId, quotaData] of this.quotas) {
      const account = this.accountManager.getAccount(accountId);
      if (account) {
        result.push(this.buildQuotaInfo(accountId, account.email, quotaData));
      }
    }

    return result;
  }

  incrementUsage(accountId: string): void {
    const quotaData = this.quotas.get(accountId);
    if (!quotaData) {
      return;
    }

    quotaData.used += 1;

    logger.debug("Quota usage incremented", {
      accountId,
      newUsed: quotaData.used,
      limit: quotaData.limit,
    });
  }

  resetQuota(accountId: string): void {
    const quotaData = this.quotas.get(accountId);
    if (!quotaData) {
      return;
    }

    quotaData.used = 0;
    quotaData.resetAt = null;

    logger.debug("Quota reset", { accountId });
  }

  getTotalAvailable(): number {
    let total = 0;

    for (const [accountId, quotaData] of this.quotas) {
      const account = this.accountManager.getAccount(accountId);
      if (!account) {
        continue;
      }

      const isLimited = this.isLimited(quotaData.used, quotaData.limit);
      if (!isLimited) {
        total += quotaData.limit - quotaData.used;
      }
    }

    return total;
  }

  /**
   * Calculate usage percentage
   */
  private calculatePercentage(used: number, limit: number): number {
    if (limit === 0) {
      return 100;
    }
    return (used / limit) * 100;
  }

  /**
   * Check if quota is limited (usage >= limit)
   */
  private isLimited(used: number, limit: number): boolean {
    return used >= limit;
  }

  /**
   * Build QuotaInfo from quota data
   */
  private buildQuotaInfo(accountId: string, email: string, data: QuotaData): QuotaInfo {
    return {
      accountId,
      email,
      used: data.used,
      limit: data.limit,
      percentage: this.calculatePercentage(data.used, data.limit),
      resetAt: data.resetAt,
      isLimited: this.isLimited(data.used, data.limit),
    };
  }
}

/**
 * Factory function to create a QuotaTracker instance
 * @param accountManager - AccountManager instance
 * @returns QuotaTracker instance
 */
export function createQuotaTracker(accountManager: AccountManager): QuotaTracker {
  return new QuotaTrackerImpl(accountManager);
}
