// @TASK P2-M4-T1 - Token Manager Implementation
// @SPEC Access Token caching, expiry detection, auto-refresh

import { AccountStorage, Account, AccountsStorage } from "./storage.js";
import { AuthenticationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

// Google Token Endpoint (same as oauth.ts for consistency)
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Token expiry buffer (5 minutes) - refresh before actual expiry
 * Exported for testing and configuration purposes
 */
export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * TokenManager interface for managing OAuth access tokens
 */
export interface TokenManager {
  /**
   * Get a valid access token for the account, refreshing if needed
   * @param accountId - The account ID to get token for
   * @returns Valid access token
   * @throws AuthenticationError if account not found or refresh fails
   */
  getAccessToken(accountId: string): Promise<string>;

  /**
   * Force refresh the access token for an account
   * @param accountId - The account ID to refresh token for
   * @returns New access token
   * @throws AuthenticationError if account not found or refresh fails
   */
  refreshToken(accountId: string): Promise<string>;

  /**
   * Check if the cached token for an account is expired
   * @param accountId - The account ID to check
   * @returns true if expired or not cached, false if valid
   */
  isTokenExpired(accountId: string): boolean;

  /**
   * Clear the token cache
   * @param accountId - Optional specific account to clear, or all if not specified
   */
  clearCache(accountId?: string): void;
}

/**
 * Token cache entry with expiry tracking
 */
interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

/**
 * Implementation of TokenManager with caching and auto-refresh
 */
class TokenManagerImpl implements TokenManager {
  private readonly storage: AccountStorage;
  private readonly clientId: string;
  private readonly clientSecret?: string;

  // In-memory cache for quick access
  private tokenCache: Map<string, TokenCacheEntry> = new Map();

  // Track ongoing refresh operations to prevent concurrent refreshes
  private refreshPromises: Map<string, Promise<string>> = new Map();

  // Cached storage data
  private storageCache: AccountsStorage | null = null;

  constructor(storage: AccountStorage, clientId: string, clientSecret?: string) {
    this.storage = storage;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async getAccessToken(accountId: string): Promise<string> {
    // Check in-memory cache first
    const cached = this.tokenCache.get(accountId);
    if (cached && !this.isExpired(cached.expiresAt)) {
      logger.debug("Using cached access token", { accountId });
      return cached.accessToken;
    }

    // Load account from storage
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new AuthenticationError(`Account not found: ${accountId}`, {
        accountId,
      });
    }

    // Check if stored token is valid
    if (
      account.accessToken &&
      account.accessTokenExpiry &&
      !this.isExpired(account.accessTokenExpiry)
    ) {
      // Cache the valid token
      this.cacheToken(accountId, account.accessToken, account.accessTokenExpiry);
      logger.debug("Using stored access token", { accountId });
      return account.accessToken;
    }

    // Token expired or missing - refresh it
    logger.info("Access token expired, refreshing", { accountId });
    return this.refreshToken(accountId);
  }

  async refreshToken(accountId: string): Promise<string> {
    // Check if refresh is already in progress for this account
    const existingPromise = this.refreshPromises.get(accountId);
    if (existingPromise) {
      logger.debug("Waiting for existing refresh operation", { accountId });
      return existingPromise;
    }

    // Start new refresh operation
    const refreshPromise = this.doRefresh(accountId);
    this.refreshPromises.set(accountId, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      this.refreshPromises.delete(accountId);
    }
  }

  isTokenExpired(accountId: string): boolean {
    // Check in-memory cache first
    const cached = this.tokenCache.get(accountId);
    if (cached) {
      return this.isExpired(cached.expiresAt);
    }

    // Check storage cache if available
    if (this.storageCache) {
      const account = this.storageCache.accounts.find((a: Account) => a.id === accountId);
      if (account && account.accessToken && account.accessTokenExpiry) {
        return this.isExpired(account.accessTokenExpiry);
      }
    }

    // No token found - consider expired
    return true;
  }

  clearCache(accountId?: string): void {
    if (accountId) {
      this.tokenCache.delete(accountId);
      logger.debug("Cleared token cache for account", { accountId });
    } else {
      this.tokenCache.clear();
      this.storageCache = null;
      logger.debug("Cleared all token caches");
    }
  }

  /**
   * Internal refresh implementation
   */
  private async doRefresh(accountId: string): Promise<string> {
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new AuthenticationError(`Account not found: ${accountId}`, {
        accountId,
      });
    }

    if (!account.refreshToken) {
      throw new AuthenticationError(
        `No refresh token available for account: ${accountId}`,
        { accountId }
      );
    }

    try {
      const response = await this.callTokenEndpoint(account.refreshToken);

      // Update storage with new token
      await this.updateAccountToken(
        accountId,
        response.accessToken,
        response.expiresAt
      );

      // Update cache
      this.cacheToken(accountId, response.accessToken, response.expiresAt);

      logger.info("Successfully refreshed access token", { accountId });
      return response.accessToken;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : "Unknown error during refresh";
      logger.error("Failed to refresh access token", {
        accountId,
        error: message,
      });

      throw new AuthenticationError(`Token refresh failed: ${message}`, {
        accountId,
        originalError: message,
      });
    }
  }

  private async callTokenEndpoint(
    refreshToken: string
  ): Promise<{ accessToken: string; expiresAt: number }> {
    // Handle Antigravity format: refreshToken|projectId
    const actualRefreshToken = refreshToken.includes("|")
      ? refreshToken.split("|")[0]!
      : refreshToken;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: actualRefreshToken,
      client_id: this.clientId,
    });

    // Add client_secret if available
    if (this.clientSecret) {
      body.set("client_secret", this.clientSecret);
    }

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as {
        error?: string;
        error_description?: string;
      };
      throw new AuthenticationError(
        `Token refresh failed: ${errorData.error_description ?? errorData.error ?? "Unknown error"}`,
        {
          error: errorData.error,
          errorDescription: errorData.error_description,
        }
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  /**
   * Get account from storage (with caching)
   */
  private async getAccount(accountId: string): Promise<Account | undefined> {
    if (!this.storageCache) {
      this.storageCache = await this.storage.load();
    }
    return this.storageCache.accounts.find((a: Account) => a.id === accountId);
  }

  /**
   * Update account token in storage
   */
  private async updateAccountToken(
    accountId: string,
    accessToken: string,
    expiresAt: number
  ): Promise<void> {
    const storage = await this.storage.load();
    const accountIndex = storage.accounts.findIndex((a: Account) => a.id === accountId);

    if (accountIndex === -1) {
      throw new AuthenticationError(`Account not found: ${accountId}`, {
        accountId,
      });
    }

    const existingAccount = storage.accounts[accountIndex]!;
    storage.accounts[accountIndex] = {
      ...existingAccount,
      accessToken,
      accessTokenExpiry: expiresAt,
      lastUsedAt: Date.now(),
    };
    storage.updatedAt = Date.now();

    await this.storage.save(storage);

    // Update storage cache
    this.storageCache = storage;
  }

  /**
   * Cache token in memory
   */
  private cacheToken(
    accountId: string,
    accessToken: string,
    expiresAt: number
  ): void {
    this.tokenCache.set(accountId, {
      accessToken,
      expiresAt,
    });
  }

  /**
   * Check if a timestamp is expired (considering buffer)
   */
  private isExpired(expiresAt: number): boolean {
    return Date.now() + TOKEN_EXPIRY_BUFFER_MS >= expiresAt;
  }
}

/**
 * Factory function to create a TokenManager instance
 * @param storage - AccountStorage instance
 * @param clientId - OAuth client ID
 * @param clientSecret - OAuth client secret (optional)
 * @returns TokenManager instance
 */
export function createTokenManager(
  storage: AccountStorage,
  clientId: string,
  clientSecret?: string
): TokenManager {
  return new TokenManagerImpl(storage, clientId, clientSecret);
}
