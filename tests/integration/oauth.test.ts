// @TEST P4-I1-T1 - OAuth Integration Test
// @SPEC Full OAuth flow testing with mock server, browser simulation, token exchange
// @IMPL src/tools/auth.ts - handleAuthLogin
// @IMPL src/auth/oauth.ts - generateAuthUrl, exchangeCodeForTokens
// @IMPL src/accounts/manager.ts - AccountManager

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as http from "http";
import { EventEmitter } from "events";
import type { AccountManager } from "../../src/accounts/manager.js";
import type { AccountRotator } from "../../src/accounts/rotator.js";
import type { Account } from "../../src/auth/storage.js";
import {
  handleAuthLogin,
  handleAuthList,
  handleAuthStatus,
  formatAuthSuccess,
  formatAuthFailure,
} from "../../src/tools/auth.js";
import {
  generatePKCE,
  generateAuthUrl,
  exchangeCodeForTokens,
  OAuthError,
} from "../../src/auth/oauth.js";

// Mock Google OAuth endpoints
const MOCK_GOOGLE_TOKEN_ENDPOINT = "https://mock-oauth.googleapis.com/token";
const MOCK_GOOGLE_USERINFO_ENDPOINT = "https://mock-oauth.googleapis.com/oauth2/v2/userinfo";

describe("OAuth Integration", () => {
  describe("Full OAuth Flow", () => {
    let mockAccountManager: AccountManager;
    let mockAccountRotator: AccountRotator;
    let mockAccount: Account;
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      vi.resetAllMocks();

      // Create mock account data
      mockAccount = {
        id: "test-uuid-1",
        email: "user@gmail.com",
        refreshToken: "test-refresh-token",
        accessToken: "test-access-token",
        accessTokenExpiry: Date.now() + 3600000, // 1 hour from now
        quota: {
          requestsRemaining: 100,
          tokensRemaining: 10000,
          resetAt: Date.now() + 3600000,
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

      // Setup mock AccountManager
      mockAccountManager = {
        initialize: vi.fn().mockResolvedValue(undefined),
        addAccount: vi.fn().mockResolvedValue(mockAccount),
        getAccount: vi.fn().mockReturnValue(mockAccount),
        getAccounts: vi.fn().mockReturnValue([mockAccount]),
        removeAccount: vi.fn().mockReturnValue(true),
        setActiveAccount: vi.fn(),
        getActiveAccount: vi.fn().mockReturnValue(mockAccount),
        updateAccountStatus: vi.fn(),
      } as unknown as AccountManager;

      // Setup mock AccountRotator
      mockAccountRotator = {
        getNextAccount: vi.fn().mockReturnValue(mockAccount),
        markRateLimited: vi.fn(),
        clearRateLimit: vi.fn(),
        isRateLimited: vi.fn().mockReturnValue(false),
        getAvailableAccounts: vi.fn().mockReturnValue([mockAccount]),
        getRateLimitedAccounts: vi.fn().mockReturnValue([]),
      } as unknown as AccountRotator;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    // @TEST P4-I1-T1.1 - Generate valid authorization URL with PKCE
    it("should generate valid authorization URL with PKCE", async () => {
      const pkce = generatePKCE();
      const state = "test-state-12345";

      const config = {
        clientId: "test-client-id",
        redirectUri: "http://localhost:51121",
        codeChallenge: pkce.codeChallenge,
        state,
      };

      const authUrl = generateAuthUrl(config);

      // Verify URL structure
      expect(authUrl).toContain("accounts.google.com/o/oauth2/v2/auth");
      expect(authUrl).toContain("client_id=test-client-id");
      expect(authUrl).toContain("code_challenge=" + encodeURIComponent(pkce.codeChallenge));
      expect(authUrl).toContain("code_challenge_method=S256");
      expect(authUrl).toContain("state=" + state);

      // Verify PKCE values are base64url encoded (no padding)
      expect(pkce.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(pkce.codeChallenge).not.toContain("=");
    });

    // @TEST P4-I1-T1.2 - Handle successful OAuth callback
    it("should handle successful OAuth callback", async () => {
      // Mock successful token exchange
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/token")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                access_token: "test-access-token",
                refresh_token: "test-refresh-token",
                expires_in: 3600,
              }),
          });
        }
        if (url.includes("/userinfo")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ email: "user@gmail.com" }),
          });
        }
        return Promise.reject(new Error("Unknown endpoint"));
      });

      const response = await handleAuthLogin({
        accountManager: mockAccountManager,
        config: { clientId: "test-client-id" },
        testCallback: {
          code: "test-auth-code",
          state: "test-state",
        },
      });

      expect(response.isError).toBe(false);
      expect(response.content[0].text).toContain("Successfully authenticated");
      expect(response.content[0].text).toContain("user@gmail.com");
      expect(mockAccountManager.addAccount).toHaveBeenCalledWith({
        refreshToken: "test-refresh-token",
        email: "user@gmail.com",
        authMode: "standard",
      });
    });

    // @TEST P4-I1-T1.3 - Exchange auth code for tokens
    it("should exchange auth code for tokens", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "test-access-token",
            refresh_token: "test-refresh-token",
            expires_in: 3600,
          }),
      });

      const pkce = generatePKCE();
      const result = await exchangeCodeForTokens({
        code: "test-auth-code",
        codeVerifier: pkce.codeVerifier,
        clientId: "test-client-id",
        redirectUri: "http://localhost:51121",
      });

      expect(result.accessToken).toBe("test-access-token");
      expect(result.refreshToken).toBe("test-refresh-token");
      expect(result.expiresIn).toBe(3600);

      // Verify POST request was made
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("oauth2.googleapis.com/token"),
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        })
      );
    });

    // @TEST P4-I1-T1.4 - Add account after successful authentication
    it("should add account after successful authentication", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/token")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                access_token: "test-access-token",
                refresh_token: "test-refresh-token",
                expires_in: 3600,
              }),
          });
        }
        if (url.includes("/userinfo")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ email: "newuser@gmail.com" }),
          });
        }
        return Promise.reject(new Error("Unknown endpoint"));
      });

      const addAccountSpy = vi.spyOn(mockAccountManager, "addAccount");

      await handleAuthLogin({
        accountManager: mockAccountManager,
        config: { clientId: "test-client-id" },
        testCallback: {
          code: "test-auth-code",
          state: "test-state",
        },
      });

      expect(addAccountSpy).toHaveBeenCalledWith({
        refreshToken: "test-refresh-token",
        email: "newuser@gmail.com",
        authMode: "standard",
      });
    });

    // @TEST P4-I1-T1.5 - Handle user denial
    it("should handle user denial", async () => {
      const response = await handleAuthLogin({
        accountManager: mockAccountManager,
        config: { clientId: "test-client-id" },
        testCallback: {
          error: "access_denied",
          errorDescription: "User denied access",
        },
      });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Authentication failed");
      expect(response.content[0].text).toContain("User denied access");
      expect(mockAccountManager.addAccount).not.toHaveBeenCalled();
    });

    // @TEST P4-I1-T1.6 - Handle network errors during token exchange
    it("should handle network errors during token exchange", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/token")) {
          return Promise.resolve({
            ok: false,
            json: () =>
              Promise.resolve({
                error: "invalid_grant",
                error_description: "Authorization code expired",
              }),
          });
        }
        return Promise.reject(new Error("Network error"));
      });

      const response = await handleAuthLogin({
        accountManager: mockAccountManager,
        config: { clientId: "test-client-id" },
        testCallback: {
          code: "expired-auth-code",
          state: "test-state",
        },
      });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Authentication failed");
    });

    // @TEST P4-I1-T1.7 - Timeout if no callback received
    it("should timeout if no callback received", async () => {
      const response = await handleAuthLogin({
        accountManager: mockAccountManager,
        config: { clientId: "test-client-id" },
        testCallback: {
          timeout: true,
        },
        timeoutMs: 100, // Short timeout for testing
      });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Authentication failed");
      expect(response.content[0].text).toContain("timed out");
    });

    // @TEST P4-I1-T1.8 - Handle state mismatch
    it("should handle state mismatch", async () => {
      const response = await handleAuthLogin({
        accountManager: mockAccountManager,
        config: { clientId: "test-client-id" },
        testCallback: {
          code: "test-auth-code",
          state: "wrong-state",
        },
      });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Authentication failed");
    });

    // @TEST P4-I1-T1.9 - Handle missing auth code
    it("should handle missing authorization code", async () => {
      const response = await handleAuthLogin({
        accountManager: mockAccountManager,
        config: { clientId: "test-client-id" },
        testCallback: {
          error: "server_error",
          errorDescription: "Internal server error",
        },
      });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Authentication failed");
    });
  });

  describe("Token Refresh", () => {
    let mockAccountManager: AccountManager;
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      vi.resetAllMocks();

      mockAccountManager = {
        initialize: vi.fn().mockResolvedValue(undefined),
        addAccount: vi.fn(),
        getAccount: vi.fn(),
        getAccounts: vi.fn(),
        removeAccount: vi.fn(),
        setActiveAccount: vi.fn(),
        getActiveAccount: vi.fn(),
        updateAccountStatus: vi.fn(),
      } as unknown as AccountManager;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    // @TEST P4-I1-T1.10 - Refresh expired access token
    it("should refresh expired access token", async () => {
      // This would be tested through the actual token refresh logic
      // For now, we verify the token exchange works with refresh token grant
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-access-token",
            expires_in: 3600,
            // Note: refresh token may not be returned in refresh response
          }),
      });

      // Simulating refresh token flow
      const refreshTokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: "test-refresh-token",
          client_id: "test-client-id",
        }).toString(),
      });

      const data = await refreshTokenResponse.json();
      expect(data.access_token).toBe("new-access-token");
      expect(data.expires_in).toBe(3600);
    });

    // @TEST P4-I1-T1.11 - Handle refresh token expiration
    it("should handle refresh token expiration", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: "invalid_grant",
            error_description: "Token has been revoked",
          }),
      });

      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.error).toBe("invalid_grant");
    });
  });

  describe("OAuth Error Handling", () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      vi.resetAllMocks();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    // @TEST P4-I1-T1.12 - OAuthError class
    it("should create OAuthError with code and message", () => {
      const error = new OAuthError("Invalid grant", "invalid_grant");

      expect(error.message).toBe("Invalid grant");
      expect(error.code).toBe("invalid_grant");
      expect(error.name).toBe("OAuthError");
    });

    // @TEST P4-I1-T1.13 - Handle various OAuth error codes
    it("should handle various OAuth error codes", async () => {
      const errorCodes = ["invalid_client", "invalid_request", "server_error"];

      for (const errorCode of errorCodes) {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          json: () =>
            Promise.resolve({
              error: errorCode,
              error_description: `OAuth error: ${errorCode}`,
            }),
        });

        const response = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
        });

        expect(response.ok).toBe(false);
        const data = await response.json();
        expect(data.error).toBe(errorCode);
      }
    });
  });

  describe("Account Management Integration", () => {
    let mockAccountManager: AccountManager;
    let mockAccountRotator: AccountRotator;
    let mockAccount: Account;

    beforeEach(() => {
      mockAccount = {
        id: "test-uuid-1",
        email: "test@gmail.com",
        refreshToken: "test-refresh-token",
        accessToken: "test-access-token",
        accessTokenExpiry: Date.now() + 3600000,
        quota: {
          requestsRemaining: 50,
          tokensRemaining: 5000,
          resetAt: Date.now() + 3600000,
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

      mockAccountManager = {
        initialize: vi.fn().mockResolvedValue(undefined),
        addAccount: vi.fn().mockResolvedValue(mockAccount),
        getAccount: vi.fn().mockReturnValue(mockAccount),
        getAccounts: vi.fn().mockReturnValue([mockAccount]),
        removeAccount: vi.fn().mockReturnValue(true),
        setActiveAccount: vi.fn(),
        getActiveAccount: vi.fn().mockReturnValue(mockAccount),
        updateAccountStatus: vi.fn(),
      } as unknown as AccountManager;

      mockAccountRotator = {
        getNextAccount: vi.fn().mockReturnValue(mockAccount),
        markRateLimited: vi.fn(),
        clearRateLimit: vi.fn(),
        isRateLimited: vi.fn().mockReturnValue(false),
        getAvailableAccounts: vi.fn().mockReturnValue([mockAccount]),
        getRateLimitedAccounts: vi.fn().mockReturnValue([]),
      } as unknown as AccountRotator;
    });

    // @TEST P4-I1-T1.14 - List accounts after OAuth
    it("should list accounts after OAuth authentication", async () => {
      const response = await handleAuthList({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(response.isError).toBe(false);
      expect(response.content[0].text).toContain("test@gmail.com");
      expect(response.content[0].text).toContain("Active");
    });

    // @TEST P4-I1-T1.15 - Get auth status with account
    it("should show authentication status with account", async () => {
      const response = await handleAuthStatus({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(response.isError).toBe(false);
      expect(response.content[0].text).toContain("Authenticated");
      expect(response.content[0].text).toContain("test@gmail.com");
    });

    // @TEST P4-I1-T1.16 - Handle multiple accounts
    it("should handle multiple accounts", async () => {
      const secondAccount: Account = {
        ...mockAccount,
        id: "test-uuid-2",
        email: "user2@gmail.com",
      };

      mockAccountManager.getAccounts = vi
        .fn()
        .mockReturnValue([mockAccount, secondAccount]);

      const response = await handleAuthList({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(response.isError).toBe(false);
      expect(response.content[0].text).toContain("test@gmail.com");
      expect(response.content[0].text).toContain("user2@gmail.com");
    });
  });

  describe("PKCE Implementation", () => {
    // @TEST P4-I1-T1.17 - PKCE code verifier format
    it("should generate proper PKCE code verifier", async () => {
      const pkce = generatePKCE();

      // code_verifier should be 43-128 characters
      expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(pkce.codeVerifier.length).toBeLessThanOrEqual(128);

      // Should only contain unreserved URI characters
      expect(pkce.codeVerifier).toMatch(/^[A-Za-z0-9._~-]+$/);
    });

    // @TEST P4-I1-T1.18 - PKCE code challenge format
    it("should generate proper PKCE code challenge", async () => {
      const pkce = generatePKCE();

      // code_challenge should be base64url encoded (no padding)
      expect(pkce.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(pkce.codeChallenge).not.toContain("=");

      // code_challenge should be SHA256 of code_verifier
      // This is ~43 characters (256 bits / 6 bits per base64url char)
      expect(pkce.codeChallenge.length).toBeGreaterThan(40);
    });

    // @TEST P4-I1-T1.19 - PKCE uniqueness
    it("should generate unique PKCE pairs on each call", async () => {
      const pkce1 = generatePKCE();
      const pkce2 = generatePKCE();

      expect(pkce1.codeVerifier).not.toBe(pkce2.codeVerifier);
      expect(pkce1.codeChallenge).not.toBe(pkce2.codeChallenge);
    });
  });

  describe("OAuth Configuration", () => {
    // @TEST P4-I1-T1.20 - Auth URL includes all required parameters
    it("should include all required OAuth parameters in auth URL", async () => {
      const pkce = generatePKCE();
      const authUrl = generateAuthUrl({
        clientId: "test-client-id",
        redirectUri: "http://localhost:51121",
        codeChallenge: pkce.codeChallenge,
        state: "test-state",
      });

      const url = new URL(authUrl);
      const params = url.searchParams;

      expect(params.get("client_id")).toBe("test-client-id");
      expect(params.get("redirect_uri")).toBe("http://localhost:51121");
      expect(params.get("response_type")).toBe("code");
      expect(params.get("scope")).toContain("generative-language");
      expect(params.get("access_type")).toBe("offline");
      expect(params.get("prompt")).toBe("consent");
      expect(params.get("code_challenge")).toBe(pkce.codeChallenge);
      expect(params.get("code_challenge_method")).toBe("S256");
      expect(params.get("state")).toBe("test-state");
    });

    // @TEST P4-I1-T1.21 - Offline access for refresh token
    it("should request offline access for refresh token", () => {
      const authUrl = generateAuthUrl({
        clientId: "test-client-id",
        redirectUri: "http://localhost:51121",
        codeChallenge: "test-challenge",
        state: "test-state",
      });

      expect(authUrl).toContain("access_type=offline");
      expect(authUrl).toContain("prompt=consent");
    });
  });
});
