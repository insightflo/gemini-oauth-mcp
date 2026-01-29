// @TASK P3-T1-T1 - auth_login MCP Tool Unit Tests
// @TASK P3-T1-T2 - auth_list MCP Tool Unit Tests
// @TASK P3-T1-T4 - auth_status MCP Tool Unit Tests
// @SPEC OAuth flow start, browser open, callback wait, success/failure messages
// @SPEC Account list display with status icons and table format
// @SPEC Authentication status display with token expiry information

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import {
  handleAuthLogin,
  authLoginTool,
  formatAuthSuccess,
  formatAuthFailure,
  handleAuthList,
  authListTool,
  formatAccountList,
  formatNoAccounts,
  handleAuthRemove,
  authRemoveTool,
  formatRemoveSuccess,
  formatRemoveNotFound,
  formatRemoveLastAccount,
  handleAuthStatus,
  authStatusTool,
  formatAuthStatusAuthenticated,
  formatAuthStatusNotAuthenticated,
} from "../../../src/tools/auth.js";
import type { AccountManager } from "../../../src/accounts/manager.js";
import type { AccountRotator } from "../../../src/accounts/rotator.js";
import type { Account } from "../../../src/auth/storage.js";

// Mock open package
vi.mock("open", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

describe("auth_login Tool", () => {
  describe("Tool Definition", () => {
    it("should have correct name", () => {
      expect(authLoginTool.name).toBe("auth_login");
    });

    it("should have description", () => {
      expect(authLoginTool.description).toContain("Google");
      expect(authLoginTool.description).toContain("account");
    });

    it("should have empty input schema (no required inputs)", () => {
      // auth_login requires no input from user
      const result = authLoginTool.inputSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("handleAuthLogin", () => {
    let mockAccountManager: AccountManager;
    let mockConfig: { clientId: string };
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      vi.resetAllMocks();

      mockAccountManager = {
        initialize: vi.fn().mockResolvedValue(undefined),
        addAccount: vi.fn().mockResolvedValue({
          id: "test-uuid",
          email: "user@gmail.com",
          refreshToken: "test-refresh-token",
          accessToken: null,
          accessTokenExpiry: null,
          quota: { requestsRemaining: null, tokensRemaining: null, resetAt: null, updatedAt: Date.now() },
          rateLimit: { isLimited: false, limitedUntil: null, consecutiveHits: 0 },
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
        }),
        getAccount: vi.fn(),
        getAccounts: vi.fn().mockReturnValue([
          { id: "1", email: "user@gmail.com" },
          { id: "2", email: "user2@gmail.com" },
        ]),
        removeAccount: vi.fn(),
        setActiveAccount: vi.fn(),
        getActiveAccount: vi.fn(),
        updateAccountStatus: vi.fn(),
      } as unknown as AccountManager;

      mockConfig = {
        clientId: "test-client-id",
      };
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("should start OAuth flow and return success message", async () => {
      // Mock the callback server to immediately receive auth code
      const mockCallbackResult = {
        code: "test-auth-code",
        state: "test-state",
      };

      // Mock token exchange
      global.fetch = vi.fn()
        // First call: token exchange
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              access_token: "test-access-token",
              refresh_token: "test-refresh-token",
              expires_in: 3600,
            }),
        })
        // Second call: get user info (email)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              email: "user@gmail.com",
            }),
        });

      const result = await handleAuthLogin({
        accountManager: mockAccountManager,
        config: mockConfig,
        // For testing: skip actual server and provide callback directly
        testCallback: mockCallbackResult,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Successfully authenticated");
      expect(result.content[0].text).toContain("user@gmail.com");
    });

    it("should return failure message when user denies access", async () => {
      const mockCallbackResult = {
        error: "access_denied",
        errorDescription: "User denied access",
      };

      const result = await handleAuthLogin({
        accountManager: mockAccountManager,
        config: mockConfig,
        testCallback: mockCallbackResult,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Authentication failed");
      expect(result.content[0].text).toContain("denied");
    });

    it("should return failure message on token exchange error", async () => {
      const mockCallbackResult = {
        code: "test-auth-code",
        state: "test-state",
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: "invalid_grant",
            error_description: "Code has expired",
          }),
      });

      const result = await handleAuthLogin({
        accountManager: mockAccountManager,
        config: mockConfig,
        testCallback: mockCallbackResult,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Authentication failed");
    });

    it("should return failure message on timeout", async () => {
      const result = await handleAuthLogin({
        accountManager: mockAccountManager,
        config: mockConfig,
        testCallback: { timeout: true },
        timeoutMs: 100, // Short timeout for test
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Authentication failed");
      expect(result.content[0].text.toLowerCase()).toContain("timed out");
    });

    it("should call accountManager.addAccount with correct params", async () => {
      const mockCallbackResult = {
        code: "test-auth-code",
        state: "test-state",
      };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              access_token: "test-access-token",
              refresh_token: "test-refresh-token",
              expires_in: 3600,
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              email: "user@gmail.com",
            }),
        });

      await handleAuthLogin({
        accountManager: mockAccountManager,
        config: mockConfig,
        testCallback: mockCallbackResult,
      });

      expect(mockAccountManager.addAccount).toHaveBeenCalledWith(
        "test-refresh-token",
        "user@gmail.com"
      );
    });
  });

  describe("formatAuthSuccess", () => {
    it("should format success message correctly", () => {
      const message = formatAuthSuccess({
        email: "user@gmail.com",
        totalAccounts: 2,
      });

      expect(message).toContain("Successfully authenticated");
      expect(message).toContain("user@gmail.com");
      expect(message).toContain("Ready to use");
      expect(message).toContain("2 accounts");
    });

    it("should handle single account", () => {
      const message = formatAuthSuccess({
        email: "user@gmail.com",
        totalAccounts: 1,
      });

      expect(message).toContain("1 account");
    });
  });

  describe("formatAuthFailure", () => {
    it("should format failure message for access denied", () => {
      const message = formatAuthFailure({
        reason: "User denied access",
      });

      expect(message).toContain("Authentication failed");
      expect(message).toContain("User denied access");
    });

    it("should format failure message for timeout", () => {
      const message = formatAuthFailure({
        reason: "Authentication timed out",
      });

      expect(message).toContain("Authentication failed");
      expect(message).toContain("timed out");
    });

    it("should format failure message for token error", () => {
      const message = formatAuthFailure({
        reason: "Token exchange failed: invalid_grant",
      });

      expect(message).toContain("Authentication failed");
      expect(message).toContain("invalid_grant");
    });
  });
});

// @TASK P3-T1-T2 - auth_list MCP Tool Unit Tests
describe("auth_list Tool", () => {
  describe("Tool Definition", () => {
    it("should have correct name", () => {
      expect(authListTool.name).toBe("auth_list");
    });

    it("should have description", () => {
      expect(authListTool.description).toContain("account");
    });

    it("should have empty input schema (no required inputs)", () => {
      const result = authListTool.inputSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("handleAuthList", () => {
    let mockAccountManager: AccountManager;
    let mockAccountRotator: AccountRotator;

    const createMockAccount = (
      id: string,
      email: string,
      lastUsedAt: number
    ): Account => ({
      id,
      email,
      refreshToken: "test-refresh-token",
      accessToken: null,
      accessTokenExpiry: null,
      quota: {
        requestsRemaining: null,
        tokensRemaining: null,
        resetAt: null,
        updatedAt: Date.now(),
      },
      rateLimit: {
        isLimited: false,
        limitedUntil: null,
        consecutiveHits: 0,
      },
      createdAt: Date.now(),
      lastUsedAt,
    });

    beforeEach(() => {
      vi.resetAllMocks();

      mockAccountManager = {
        initialize: vi.fn().mockResolvedValue(undefined),
        addAccount: vi.fn(),
        getAccount: vi.fn(),
        getAccounts: vi.fn().mockReturnValue([]),
        removeAccount: vi.fn(),
        setActiveAccount: vi.fn(),
        getActiveAccount: vi.fn().mockReturnValue(null),
        updateAccountStatus: vi.fn(),
      } as unknown as AccountManager;

      mockAccountRotator = {
        getNextAccount: vi.fn(),
        markRateLimited: vi.fn(),
        clearRateLimit: vi.fn(),
        isRateLimited: vi.fn().mockReturnValue(false),
        getAvailableAccounts: vi.fn().mockReturnValue([]),
        getRateLimitedAccounts: vi.fn().mockReturnValue([]),
      } as unknown as AccountRotator;
    });

    it("should return empty message when no accounts exist", async () => {
      (mockAccountManager.getAccounts as Mock).mockReturnValue([]);

      const result = await handleAuthList({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("No accounts registered");
      expect(result.content[0].text).toContain("auth_login");
    });

    it("should list accounts with Active status icon", async () => {
      const now = Date.now();
      const activeAccount = createMockAccount("1", "user1@gmail.com", now);

      (mockAccountManager.getAccounts as Mock).mockReturnValue([activeAccount]);
      (mockAccountManager.getActiveAccount as Mock).mockReturnValue(activeAccount);
      (mockAccountRotator.isRateLimited as Mock).mockReturnValue(false);

      const result = await handleAuthList({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("user1@gmail.com");
      expect(result.content[0].text).toContain("Active");
      // Status icon for active
      expect(result.content[0].text).toMatch(/[●]/);
    });

    it("should list accounts with Ready status icon", async () => {
      const now = Date.now();
      const activeAccount = createMockAccount("1", "active@gmail.com", now);
      const readyAccount = createMockAccount("2", "ready@gmail.com", now - 3600000);

      (mockAccountManager.getAccounts as Mock).mockReturnValue([
        activeAccount,
        readyAccount,
      ]);
      (mockAccountManager.getActiveAccount as Mock).mockReturnValue(activeAccount);
      (mockAccountRotator.isRateLimited as Mock).mockReturnValue(false);

      const result = await handleAuthList({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("ready@gmail.com");
      expect(result.content[0].text).toContain("Ready");
      // Status icon for ready
      expect(result.content[0].text).toMatch(/[○]/);
    });

    it("should list accounts with Limited status icon", async () => {
      const now = Date.now();
      const limitedAccount = createMockAccount("1", "limited@gmail.com", now);

      (mockAccountManager.getAccounts as Mock).mockReturnValue([limitedAccount]);
      (mockAccountManager.getActiveAccount as Mock).mockReturnValue(null);
      (mockAccountRotator.isRateLimited as Mock).mockReturnValue(true);
      (mockAccountRotator.getRateLimitedAccounts as Mock).mockReturnValue([
        {
          account: limitedAccount,
          availableAt: new Date(now + 15 * 60 * 1000), // 15 min remaining
        },
      ]);

      const result = await handleAuthList({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("limited@gmail.com");
      expect(result.content[0].text).toContain("Limited");
      // Status icon for limited
      expect(result.content[0].text).toMatch(/[◌]/);
    });

    it("should display correct account count in header", async () => {
      const now = Date.now();
      const accounts = [
        createMockAccount("1", "user1@gmail.com", now),
        createMockAccount("2", "user2@gmail.com", now),
        createMockAccount("3", "user3@gmail.com", now),
      ];

      (mockAccountManager.getAccounts as Mock).mockReturnValue(accounts);
      (mockAccountManager.getActiveAccount as Mock).mockReturnValue(accounts[0]);
      (mockAccountRotator.isRateLimited as Mock).mockReturnValue(false);

      const result = await handleAuthList({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Registered Accounts (3)");
    });

    it("should format last used time as relative time", async () => {
      const now = Date.now();
      const account = createMockAccount("1", "user@gmail.com", now - 2 * 60 * 1000); // 2 minutes ago

      (mockAccountManager.getAccounts as Mock).mockReturnValue([account]);
      (mockAccountManager.getActiveAccount as Mock).mockReturnValue(account);
      (mockAccountRotator.isRateLimited as Mock).mockReturnValue(false);

      const result = await handleAuthList({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(result.isError).toBe(false);
      // Should contain relative time like "2 minutes ago"
      expect(result.content[0].text).toMatch(/\d+ minutes? ago/);
    });

    it("should include status legend at bottom", async () => {
      const now = Date.now();
      const account = createMockAccount("1", "user@gmail.com", now);

      (mockAccountManager.getAccounts as Mock).mockReturnValue([account]);
      (mockAccountManager.getActiveAccount as Mock).mockReturnValue(account);
      (mockAccountRotator.isRateLimited as Mock).mockReturnValue(false);

      const result = await handleAuthList({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Status Legend");
      expect(result.content[0].text).toContain("Currently in use");
      expect(result.content[0].text).toContain("Available for use");
      expect(result.content[0].text).toContain("Rate limited");
    });
  });

  describe("formatAccountList", () => {
    const createMockAccount = (
      id: string,
      email: string,
      lastUsedAt: number
    ): Account => ({
      id,
      email,
      refreshToken: "test-refresh-token",
      accessToken: null,
      accessTokenExpiry: null,
      quota: {
        requestsRemaining: null,
        tokensRemaining: null,
        resetAt: null,
        updatedAt: Date.now(),
      },
      rateLimit: {
        isLimited: false,
        limitedUntil: null,
        consecutiveHits: 0,
      },
      createdAt: Date.now(),
      lastUsedAt,
    });

    it("should format single account correctly", () => {
      const now = Date.now();
      const account = createMockAccount("1", "user@gmail.com", now);

      const message = formatAccountList({
        accounts: [{ account, status: "active", lastUsedAt: now }],
        totalCount: 1,
      });

      expect(message).toContain("Registered Accounts (1)");
      expect(message).toContain("user@gmail.com");
      expect(message).toContain("Active");
    });

    it("should format multiple accounts in table", () => {
      const now = Date.now();

      const message = formatAccountList({
        accounts: [
          {
            account: createMockAccount("1", "user1@gmail.com", now),
            status: "active",
            lastUsedAt: now,
          },
          {
            account: createMockAccount("2", "user2@gmail.com", now - 3600000),
            status: "ready",
            lastUsedAt: now - 3600000,
          },
          {
            account: createMockAccount("3", "user3@gmail.com", now - 900000),
            status: "limited",
            lastUsedAt: now - 900000,
            remainingMs: 900000, // 15 min remaining
          },
        ],
        totalCount: 3,
      });

      expect(message).toContain("Registered Accounts (3)");
      expect(message).toContain("user1@gmail.com");
      expect(message).toContain("user2@gmail.com");
      expect(message).toContain("user3@gmail.com");
    });
  });

  describe("formatNoAccounts", () => {
    it("should return message with auth_login hint", () => {
      const message = formatNoAccounts();

      expect(message).toContain("No accounts registered");
      expect(message).toContain("auth_login");
    });
  });
});

// @TASK P3-T1-T3 - auth_remove MCP Tool Unit Tests
describe("auth_remove Tool", () => {
  describe("Tool Definition", () => {
    it("should have correct name", () => {
      expect(authRemoveTool.name).toBe("auth_remove");
    });

    it("should have description", () => {
      expect(authRemoveTool.description).toContain("Remove");
      expect(authRemoveTool.description).toContain("account");
    });

    it("should require account_id input", () => {
      // Should fail without account_id
      const result = authRemoveTool.inputSchema.safeParse({});
      expect(result.success).toBe(false);

      // Should succeed with account_id
      const validResult = authRemoveTool.inputSchema.safeParse({
        account_id: "test-id",
      });
      expect(validResult.success).toBe(true);
    });
  });

  describe("handleAuthRemove", () => {
    let mockAccountManager: AccountManager;

    const createMockAccount = (
      id: string,
      email: string,
      lastUsedAt: number
    ): Account => ({
      id,
      email,
      refreshToken: "test-refresh-token",
      accessToken: null,
      accessTokenExpiry: null,
      quota: {
        requestsRemaining: null,
        tokensRemaining: null,
        resetAt: null,
        updatedAt: Date.now(),
      },
      rateLimit: {
        isLimited: false,
        limitedUntil: null,
        consecutiveHits: 0,
      },
      createdAt: Date.now(),
      lastUsedAt,
    });

    beforeEach(() => {
      vi.resetAllMocks();

      mockAccountManager = {
        initialize: vi.fn().mockResolvedValue(undefined),
        addAccount: vi.fn(),
        getAccount: vi.fn(),
        getAccounts: vi.fn().mockReturnValue([]),
        removeAccount: vi.fn().mockReturnValue(true),
        setActiveAccount: vi.fn(),
        getActiveAccount: vi.fn().mockReturnValue(null),
        updateAccountStatus: vi.fn(),
      } as unknown as AccountManager;
    });

    it("should remove account by ID successfully", async () => {
      const now = Date.now();
      const account1 = createMockAccount("uuid-1", "user1@gmail.com", now);
      const account2 = createMockAccount("uuid-2", "user2@gmail.com", now);

      // First call returns both accounts, second call (after removal) returns only one
      (mockAccountManager.getAccounts as Mock)
        .mockReturnValueOnce([account1, account2])
        .mockReturnValueOnce([account2]);
      (mockAccountManager.getAccount as Mock).mockReturnValue(account1);
      (mockAccountManager.removeAccount as Mock).mockReturnValue(true);

      const result = await handleAuthRemove(
        { account_id: "uuid-1" },
        { accountManager: mockAccountManager }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Account removed");
      expect(result.content[0].text).toContain("user1@gmail.com");
      expect(result.content[0].text).toContain("1 account"); // Remaining (singular)
      expect(mockAccountManager.removeAccount).toHaveBeenCalledWith("uuid-1");
    });

    it("should remove account by email successfully", async () => {
      const now = Date.now();
      const account1 = createMockAccount("uuid-1", "user1@gmail.com", now);
      const account2 = createMockAccount("uuid-2", "user2@gmail.com", now);

      // First call returns both accounts, second call (after removal) returns only one
      (mockAccountManager.getAccounts as Mock)
        .mockReturnValueOnce([account1, account2])
        .mockReturnValueOnce([account1]);
      (mockAccountManager.getAccount as Mock).mockReturnValue(null); // Not found by ID
      (mockAccountManager.removeAccount as Mock).mockReturnValue(true);

      const result = await handleAuthRemove(
        { account_id: "user2@gmail.com" },
        { accountManager: mockAccountManager }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Account removed");
      expect(result.content[0].text).toContain("user2@gmail.com");
      expect(result.content[0].text).toContain("1 account"); // Remaining (singular)
      expect(mockAccountManager.removeAccount).toHaveBeenCalledWith("uuid-2");
    });

    it("should return error when account not found", async () => {
      const now = Date.now();
      const account1 = createMockAccount("uuid-1", "user1@gmail.com", now);

      (mockAccountManager.getAccounts as Mock).mockReturnValue([account1]);
      (mockAccountManager.getAccount as Mock).mockReturnValue(null);

      const result = await handleAuthRemove(
        { account_id: "nonexistent@gmail.com" },
        { accountManager: mockAccountManager }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Account not found");
      expect(result.content[0].text).toContain("nonexistent@gmail.com");
      expect(result.content[0].text).toContain("auth_list");
      expect(mockAccountManager.removeAccount).not.toHaveBeenCalled();
    });

    it("should prevent removing last account", async () => {
      const now = Date.now();
      const account1 = createMockAccount("uuid-1", "user1@gmail.com", now);

      (mockAccountManager.getAccounts as Mock).mockReturnValue([account1]);
      (mockAccountManager.getAccount as Mock).mockReturnValue(account1);

      const result = await handleAuthRemove(
        { account_id: "uuid-1" },
        { accountManager: mockAccountManager }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Cannot remove last account");
      expect(result.content[0].text).toContain("auth_login");
      expect(mockAccountManager.removeAccount).not.toHaveBeenCalled();
    });

    it("should handle case-insensitive email matching", async () => {
      const now = Date.now();
      const account1 = createMockAccount("uuid-1", "User1@Gmail.com", now);
      const account2 = createMockAccount("uuid-2", "user2@gmail.com", now);

      // First call returns both accounts, second call (after removal) returns only one
      (mockAccountManager.getAccounts as Mock)
        .mockReturnValueOnce([account1, account2])
        .mockReturnValueOnce([account2]);
      (mockAccountManager.getAccount as Mock).mockReturnValue(null);
      (mockAccountManager.removeAccount as Mock).mockReturnValue(true);

      const result = await handleAuthRemove(
        { account_id: "user1@gmail.com" },
        { accountManager: mockAccountManager }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Account removed");
      expect(result.content[0].text).toContain("1 account"); // Remaining (singular)
      expect(mockAccountManager.removeAccount).toHaveBeenCalledWith("uuid-1");
    });
  });

  describe("formatRemoveSuccess", () => {
    it("should format success message with email and remaining count", () => {
      const message = formatRemoveSuccess({
        email: "user@gmail.com",
        remainingAccounts: 2,
      });

      expect(message).toContain("Account removed");
      expect(message).toContain("user@gmail.com");
      expect(message).toContain("2 accounts");
    });

    it("should handle singular account", () => {
      const message = formatRemoveSuccess({
        email: "user@gmail.com",
        remainingAccounts: 1,
      });

      expect(message).toContain("1 account");
    });
  });

  describe("formatRemoveNotFound", () => {
    it("should format not found message with search term", () => {
      const message = formatRemoveNotFound({
        searchTerm: "user@gmail.com",
      });

      expect(message).toContain("Account not found");
      expect(message).toContain("user@gmail.com");
      expect(message).toContain("auth_list");
    });
  });

  describe("formatRemoveLastAccount", () => {
    it("should format last account protection message", () => {
      const message = formatRemoveLastAccount();

      expect(message).toContain("Cannot remove last account");
      expect(message).toContain("auth_login");
    });
  });
});

// @TASK P3-T1-T4 - auth_status MCP Tool Unit Tests
describe("auth_status Tool", () => {
  describe("Tool Definition", () => {
    it("should have correct name", () => {
      expect(authStatusTool.name).toBe("auth_status");
    });

    it("should have description", () => {
      expect(authStatusTool.description).toContain("authentication");
      expect(authStatusTool.description).toContain("status");
    });

    it("should have empty input schema (no required inputs)", () => {
      const result = authStatusTool.inputSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("handleAuthStatus", () => {
    let mockAccountManager: AccountManager;
    let mockAccountRotator: AccountRotator;

    const createMockAccount = (
      id: string,
      email: string,
      accessTokenExpiry: number | null = null
    ): Account => ({
      id,
      email,
      refreshToken: "test-refresh-token",
      accessToken: accessTokenExpiry ? "test-access-token" : null,
      accessTokenExpiry,
      quota: {
        requestsRemaining: null,
        tokensRemaining: null,
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
    });

    beforeEach(() => {
      vi.resetAllMocks();

      mockAccountManager = {
        initialize: vi.fn().mockResolvedValue(undefined),
        addAccount: vi.fn(),
        getAccount: vi.fn(),
        getAccounts: vi.fn().mockReturnValue([]),
        removeAccount: vi.fn(),
        setActiveAccount: vi.fn(),
        getActiveAccount: vi.fn().mockReturnValue(null),
        updateAccountStatus: vi.fn(),
      } as unknown as AccountManager;

      mockAccountRotator = {
        getNextAccount: vi.fn(),
        markRateLimited: vi.fn(),
        clearRateLimit: vi.fn(),
        isRateLimited: vi.fn().mockReturnValue(false),
        getAvailableAccounts: vi.fn().mockReturnValue([]),
        getRateLimitedAccounts: vi.fn().mockReturnValue([]),
      } as unknown as AccountRotator;
    });

    it("should return not authenticated when no accounts exist", async () => {
      (mockAccountManager.getAccounts as Mock).mockReturnValue([]);
      (mockAccountManager.getActiveAccount as Mock).mockReturnValue(null);

      const result = await handleAuthStatus({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Not authenticated");
      expect(result.content[0].text).toContain("No accounts registered");
      expect(result.content[0].text).toContain("auth_login");
    });

    it("should return authenticated status with active account", async () => {
      const now = Date.now();
      const futureExpiry = now + 45 * 60 * 1000; // 45 minutes from now
      const activeAccount = createMockAccount("1", "user1@gmail.com", futureExpiry);

      (mockAccountManager.getAccounts as Mock).mockReturnValue([activeAccount]);
      (mockAccountManager.getActiveAccount as Mock).mockReturnValue(activeAccount);
      (mockAccountRotator.isRateLimited as Mock).mockReturnValue(false);
      (mockAccountRotator.getRateLimitedAccounts as Mock).mockReturnValue([]);
      (mockAccountRotator.getAvailableAccounts as Mock).mockReturnValue([activeAccount]);

      const result = await handleAuthStatus({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Authenticated");
      expect(result.content[0].text).toContain("user1@gmail.com");
      expect(result.content[0].text).toContain("minutes remaining");
    });

    it("should show token expiry time correctly", async () => {
      const now = Date.now();
      const futureExpiry = now + 30 * 60 * 1000; // 30 minutes from now
      const activeAccount = createMockAccount("1", "user@gmail.com", futureExpiry);

      (mockAccountManager.getAccounts as Mock).mockReturnValue([activeAccount]);
      (mockAccountManager.getActiveAccount as Mock).mockReturnValue(activeAccount);
      (mockAccountRotator.isRateLimited as Mock).mockReturnValue(false);
      (mockAccountRotator.getRateLimitedAccounts as Mock).mockReturnValue([]);
      (mockAccountRotator.getAvailableAccounts as Mock).mockReturnValue([activeAccount]);

      const result = await handleAuthStatus({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(result.isError).toBe(false);
      // Should contain token expiry info
      expect(result.content[0].text).toMatch(/\d+ minutes? remaining/);
    });

    it("should show accounts summary with rate limited count", async () => {
      const now = Date.now();
      const futureExpiry = now + 45 * 60 * 1000;
      const account1 = createMockAccount("1", "user1@gmail.com", futureExpiry);
      const account2 = createMockAccount("2", "user2@gmail.com", futureExpiry);
      const account3 = createMockAccount("3", "user3@gmail.com", futureExpiry);

      (mockAccountManager.getAccounts as Mock).mockReturnValue([
        account1,
        account2,
        account3,
      ]);
      (mockAccountManager.getActiveAccount as Mock).mockReturnValue(account1);
      (mockAccountRotator.isRateLimited as Mock)
        .mockReturnValueOnce(false) // account1
        .mockReturnValueOnce(true) // account2
        .mockReturnValueOnce(false); // account3
      (mockAccountRotator.getRateLimitedAccounts as Mock).mockReturnValue([
        { account: account2, availableAt: new Date(now + 15 * 60 * 1000) },
      ]);
      (mockAccountRotator.getAvailableAccounts as Mock).mockReturnValue([
        account1,
        account3,
      ]);

      const result = await handleAuthStatus({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("3 registered");
      expect(result.content[0].text).toContain("1 account"); // Rate limited
      expect(result.content[0].text).toContain("2 accounts"); // Available
    });

    it("should show expired token status", async () => {
      const now = Date.now();
      const pastExpiry = now - 10 * 60 * 1000; // Expired 10 minutes ago
      const activeAccount = createMockAccount("1", "user@gmail.com", pastExpiry);

      (mockAccountManager.getAccounts as Mock).mockReturnValue([activeAccount]);
      (mockAccountManager.getActiveAccount as Mock).mockReturnValue(activeAccount);
      (mockAccountRotator.isRateLimited as Mock).mockReturnValue(false);
      (mockAccountRotator.getRateLimitedAccounts as Mock).mockReturnValue([]);
      (mockAccountRotator.getAvailableAccounts as Mock).mockReturnValue([activeAccount]);

      const result = await handleAuthStatus({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Authenticated");
      // Expired tokens should show "Token Expired" or "will refresh"
      expect(result.content[0].text).toMatch(/expired|will refresh/i);
    });

    it("should handle no active account but accounts exist", async () => {
      const now = Date.now();
      const futureExpiry = now + 45 * 60 * 1000;
      const account = createMockAccount("1", "user@gmail.com", futureExpiry);

      (mockAccountManager.getAccounts as Mock).mockReturnValue([account]);
      (mockAccountManager.getActiveAccount as Mock).mockReturnValue(null);
      (mockAccountRotator.isRateLimited as Mock).mockReturnValue(false);
      (mockAccountRotator.getRateLimitedAccounts as Mock).mockReturnValue([]);
      (mockAccountRotator.getAvailableAccounts as Mock).mockReturnValue([account]);

      const result = await handleAuthStatus({
        accountManager: mockAccountManager,
        accountRotator: mockAccountRotator,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Authenticated");
      expect(result.content[0].text).toContain("1 registered");
    });
  });

  describe("formatAuthStatusAuthenticated", () => {
    it("should format authenticated status correctly", () => {
      const message = formatAuthStatusAuthenticated({
        email: "user@gmail.com",
        tokenExpiryMs: 45 * 60 * 1000, // 45 minutes
        totalAccounts: 3,
        rateLimitedCount: 1,
        availableCount: 2,
      });

      expect(message).toContain("Authentication Status");
      expect(message).toContain("Authenticated");
      expect(message).toContain("user@gmail.com");
      expect(message).toContain("45 minutes remaining");
      expect(message).toContain("3 registered");
      expect(message).toContain("1 account");
      expect(message).toContain("2 accounts");
    });

    it("should handle singular/plural correctly", () => {
      const message = formatAuthStatusAuthenticated({
        email: "user@gmail.com",
        tokenExpiryMs: 60 * 1000, // 1 minute
        totalAccounts: 1,
        rateLimitedCount: 0,
        availableCount: 1,
      });

      expect(message).toContain("1 minute remaining");
      expect(message).toContain("1 registered");
      expect(message).toContain("1 account"); // Available
    });

    it("should handle expired token", () => {
      const message = formatAuthStatusAuthenticated({
        email: "user@gmail.com",
        tokenExpiryMs: -10 * 60 * 1000, // Expired 10 min ago
        totalAccounts: 1,
        rateLimitedCount: 0,
        availableCount: 1,
      });

      expect(message).toMatch(/expired|will refresh/i);
    });

    it("should handle null token expiry (no token yet)", () => {
      const message = formatAuthStatusAuthenticated({
        email: "user@gmail.com",
        tokenExpiryMs: null,
        totalAccounts: 1,
        rateLimitedCount: 0,
        availableCount: 1,
      });

      expect(message).toMatch(/not yet|pending|will refresh/i);
    });
  });

  describe("formatAuthStatusNotAuthenticated", () => {
    it("should format not authenticated message with reason", () => {
      const message = formatAuthStatusNotAuthenticated({
        reason: "No accounts registered",
      });

      expect(message).toContain("Authentication Status");
      expect(message).toContain("Not authenticated");
      expect(message).toContain("No accounts registered");
      expect(message).toContain("auth_login");
    });
  });
});
