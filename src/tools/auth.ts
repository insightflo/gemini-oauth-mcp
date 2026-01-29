// @TASK P3-T1-T1 - auth_login MCP Tool Implementation
// @TASK P3-T1-T2 - auth_list MCP Tool Implementation
// @SPEC OAuth flow start, browser open, callback wait, success/failure messages
// @SPEC Account list display with status icons and table format

import { z } from "zod";
import {
  generatePKCE,
  generateAuthUrl,
  exchangeCodeForTokens,
  DEFAULT_REDIRECT_URI,
  OAuthError,
} from "../auth/oauth.js";
import type { AccountManager } from "../accounts/manager.js";
import type { AccountRotator } from "../accounts/rotator.js";
import type { Account } from "../auth/storage.js";
import { AuthenticationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import * as http from "http";
import * as crypto from "crypto";

// Tool Definition
export const authLoginTool = {
  name: "auth_login",
  description: "Add a new Google account for Gemini API access",
  inputSchema: z.object({}),
};

// Types
export interface ToolResponse {
  isError: boolean;
  content: Array<{ type: "text"; text: string }>;
}

interface CallbackResult {
  code?: string | undefined;
  state?: string | undefined;
  error?: string | undefined;
  errorDescription?: string | undefined;
  timeout?: boolean | undefined;
}

interface HandleAuthLoginParams {
  accountManager: AccountManager;
  config: { clientId: string; clientSecret?: string };
  testCallback?: CallbackResult;
  timeoutMs?: number;
}

interface AuthSuccessParams {
  email: string;
  totalAccounts: number;
}

interface AuthFailureParams {
  reason: string;
}

// Google userinfo endpoint
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/**
 * Format success message according to design system
 */
export function formatAuthSuccess({ email, totalAccounts }: AuthSuccessParams): string {
  const accountWord = totalAccounts === 1 ? "account" : "accounts";
  return `[OK] Successfully authenticated!

  Account: ${email}
  Status:  Ready to use
  Total:   ${totalAccounts} ${accountWord} registered`;
}

/**
 * Format failure message according to design system
 */
export function formatAuthFailure({ reason }: AuthFailureParams): string {
  return `[ERROR] Authentication failed

  Reason: ${reason}`;
}

/**
 * Get user email from Google userinfo endpoint
 */
async function getUserEmail(accessToken: string): Promise<string> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new AuthenticationError("Failed to get user info", {
      status: response.status,
    });
  }

  const data = (await response.json()) as { email: string };
  return data.email;
}

/**
 * Start local callback server to receive OAuth redirect
 */
function startCallbackServer(
  expectedState: string,
  timeoutMs: number
): Promise<CallbackResult> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "", `http://localhost`);

      // Handle favicon requests
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");

      // Send response HTML
      const isSuccess = code && state === expectedState;
      const html = isSuccess
        ? `<!DOCTYPE html><html><head><title>Authentication Successful</title></head>
           <body style="font-family: system-ui; text-align: center; padding: 50px;">
           <h1>Authentication Successful!</h1>
           <p>You can close this window and return to your terminal.</p>
           </body></html>`
        : `<!DOCTYPE html><html><head><title>Authentication Failed</title></head>
           <body style="font-family: system-ui; text-align: center; padding: 50px;">
           <h1>Authentication Failed</h1>
           <p>${error ? `Error: ${errorDescription || error}` : "Invalid state parameter"}</p>
           </body></html>`;

      res.writeHead(isSuccess ? 200 : 400, { "Content-Type": "text/html" });
      res.end(html);

      // Close server and resolve
      server.close();

      if (error) {
        resolve({ error, errorDescription: errorDescription ?? undefined });
      } else if (code && state === expectedState) {
        resolve({ code, state });
      } else {
        resolve({ error: "invalid_state", errorDescription: "State mismatch" });
      }
    });

    // Extract port from DEFAULT_REDIRECT_URI
    const port = new URL(DEFAULT_REDIRECT_URI).port || "51121";

    server.listen(parseInt(port, 10), () => {
      logger.debug("Callback server started", { port });
    });

    // Timeout handler
    const timeoutId = setTimeout(() => {
      server.close();
      resolve({ timeout: true });
    }, timeoutMs);

    server.on("close", () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Handle auth_login tool execution
 *
 * OAuth Flow:
 * 1. Generate PKCE pair (code_verifier, code_challenge)
 * 2. Generate state for CSRF protection
 * 3. Build authorization URL
 * 4. Open browser (or return URL for user)
 * 5. Start local callback server
 * 6. Wait for callback with auth code
 * 7. Exchange code for tokens
 * 8. Get user email from userinfo
 * 9. Add account to manager
 * 10. Return success/failure message
 */
export async function handleAuthLogin({
  accountManager,
  config,
  testCallback,
  timeoutMs = 300000, // 5 minutes default
}: HandleAuthLoginParams): Promise<ToolResponse> {
  try {
    // Initialize account manager if needed
    await accountManager.initialize();

    // Generate PKCE pair
    const pkce = generatePKCE();

    // Generate state for CSRF protection
    const state = crypto.randomBytes(16).toString("hex");

    // Generate authorization URL
    const authUrl = generateAuthUrl({
      clientId: config.clientId,
      redirectUri: DEFAULT_REDIRECT_URI,
      codeChallenge: pkce.codeChallenge,
      state,
    });

    logger.info("Starting OAuth flow", { authUrl });

    // For testing: use provided callback result
    let callbackResult: CallbackResult;
    if (testCallback) {
      callbackResult = testCallback;
    } else {
      // Open browser
      const open = (await import("open")).default as (url: string) => Promise<unknown>;
      await open(authUrl);

      // Wait for callback
      callbackResult = await startCallbackServer(state, timeoutMs);
    }

    // Handle timeout
    if (callbackResult.timeout) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: formatAuthFailure({ reason: "Authentication timed out" }),
          },
        ],
      };
    }

    // Handle error from OAuth provider
    if (callbackResult.error) {
      const reason =
        callbackResult.errorDescription ||
        (callbackResult.error === "access_denied"
          ? "User denied access"
          : callbackResult.error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: formatAuthFailure({ reason }),
          },
        ],
      };
    }

    // Exchange code for tokens
    if (!callbackResult.code) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: formatAuthFailure({ reason: "No authorization code received" }),
          },
        ],
      };
    }

    let tokens;
    try {
      tokens = await exchangeCodeForTokens({
        code: callbackResult.code,
        codeVerifier: pkce.codeVerifier,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: DEFAULT_REDIRECT_URI,
      });
    } catch (error) {
      const message =
        error instanceof OAuthError
          ? error.message  // Use full message with error_description
          : error instanceof Error
            ? error.message
            : "Unknown error";
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: formatAuthFailure({ reason: message }),
          },
        ],
      };
    }

    // Get user email
    let email: string;
    try {
      email = await getUserEmail(tokens.accessToken);
    } catch {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: formatAuthFailure({
              reason: "Failed to get user email from Google",
            }),
          },
        ],
      };
    }

    // Add account
    try {
      await accountManager.addAccount(tokens.refreshToken, email);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: formatAuthFailure({
                reason: `Account already exists: ${email}`,
              }),
            },
          ],
        };
      }
      throw error;
    }

    // Get total accounts for message
    const totalAccounts = accountManager.getAccounts().length;

    logger.info("OAuth flow completed successfully", { email, totalAccounts });

    return {
      isError: false,
      content: [
        {
          type: "text",
          text: formatAuthSuccess({ email, totalAccounts }),
        },
      ],
    };
  } catch (error) {
    logger.error("OAuth flow failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: formatAuthFailure({
            reason: error instanceof Error ? error.message : "Unknown error",
          }),
        },
      ],
    };
  }
}

// ============================================================================
// @TASK P3-T1-T2 - auth_list MCP Tool
// ============================================================================

// Tool Definition
export const authListTool = {
  name: "auth_list",
  description: "List all registered Google accounts with status",
  inputSchema: z.object({}),
};

// Types for auth_list
type AccountStatusType = "active" | "ready" | "limited";

interface AccountListItem {
  account: Account;
  status: AccountStatusType;
  lastUsedAt: number;
  remainingMs?: number | undefined;
}

interface HandleAuthListParams {
  accountManager: AccountManager;
  accountRotator: AccountRotator;
}

interface FormatAccountListParams {
  accounts: AccountListItem[];
  totalCount: number;
}

// Status icons following design system
const STATUS_ICONS: Record<AccountStatusType, string> = {
  active: "\u25CF",  // ● (filled circle)
  ready: "\u25CB",   // ○ (empty circle)
  limited: "\u25CC", // ◌ (dotted circle)
};

const STATUS_LABELS: Record<AccountStatusType, string> = {
  active: "Active",
  ready: "Ready",
  limited: "Limited",
};

/**
 * Format relative time from timestamp
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return "just now";
  } else if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  } else if (hours < 24) {
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  } else {
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }
}

/**
 * Format remaining time for rate limited accounts
 */
function formatRemainingTime(remainingMs: number): string {
  const minutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m remaining`
      : `${hours}h remaining`;
  }
  return `${minutes} min remaining`;
}

/**
 * Format no accounts message
 */
export function formatNoAccounts(): string {
  return `No accounts registered.

To add an account:
  \u2192 Use auth_login`;
}

/**
 * Format account list in table format
 */
export function formatAccountList({ accounts, totalCount }: FormatAccountListParams): string {
  const header = `Registered Accounts (${totalCount})
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  #  Email                  Status         Last Used
  \u2500  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`;

  const rows = accounts.map((item, index) => {
    const num = (index + 1).toString().padEnd(2);
    const email = item.account.email.padEnd(21);
    const icon = STATUS_ICONS[item.status];
    const label = STATUS_LABELS[item.status];
    const statusStr = `${icon} ${label}`.padEnd(13);

    let lastUsed: string;
    if (item.status === "limited" && item.remainingMs !== undefined) {
      lastUsed = formatRemainingTime(item.remainingMs);
    } else {
      lastUsed = formatRelativeTime(item.lastUsedAt);
    }

    return `  ${num} ${email}  ${statusStr}  ${lastUsed}`;
  });

  const footer = `
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

Status Legend:
  ${STATUS_ICONS.active} Active   - Currently in use
  ${STATUS_ICONS.ready} Ready    - Available for use
  ${STATUS_ICONS.limited} Limited  - Rate limited, waiting for reset`;

  return [header, ...rows, footer].join("\n");
}

/**
 * Handle auth_list tool execution
 */
export function handleAuthList({
  accountManager,
  accountRotator,
}: HandleAuthListParams): ToolResponse {
  try {
    // Get all accounts
    const accounts = accountManager.getAccounts();

    // No accounts case
    if (accounts.length === 0) {
      return {
        isError: false,
        content: [
          {
            type: "text",
            text: formatNoAccounts(),
          },
        ],
      };
    }

    // Get active account
    const activeAccount = accountManager.getActiveAccount();

    // Get rate limited accounts info
    const rateLimitedInfo = accountRotator.getRateLimitedAccounts();
    const rateLimitedMap = new Map(
      rateLimitedInfo.map((info) => [
        info.account.id,
        info.availableAt.getTime() - Date.now(),
      ])
    );

    // Build account list with status
    const accountItems: AccountListItem[] = accounts.map((account) => {
      let status: AccountStatusType;
      let remainingMs: number | undefined;

      if (accountRotator.isRateLimited(account.id)) {
        status = "limited";
        remainingMs = rateLimitedMap.get(account.id);
      } else if (activeAccount && activeAccount.id === account.id) {
        status = "active";
      } else {
        status = "ready";
      }

      return {
        account,
        status,
        lastUsedAt: account.lastUsedAt,
        remainingMs,
      };
    });

    logger.debug("auth_list executed", { accountCount: accounts.length });

    return {
      isError: false,
      content: [
        {
          type: "text",
          text: formatAccountList({
            accounts: accountItems,
            totalCount: accounts.length,
          }),
        },
      ],
    };
  } catch (error) {
    logger.error("auth_list failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `[ERROR] Failed to list accounts: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
    };
  }
}

// ============================================================================
// @TASK P3-T1-T4 - auth_status MCP Tool
// ============================================================================

// Tool Definition
export const authStatusTool = {
  name: "auth_status",
  description: "Show current authentication status",
  inputSchema: z.object({}),
};

// Types for auth_status
interface AuthStatusAuthenticatedParams {
  email: string;
  tokenExpiryMs: number | null;
  totalAccounts: number;
  rateLimitedCount: number;
  availableCount: number;
}

interface AuthStatusNotAuthenticatedParams {
  reason: string;
}

interface HandleAuthStatusParams {
  accountManager: AccountManager;
  accountRotator: AccountRotator;
}

/**
 * Format token expiry time
 */
function formatTokenExpiry(expiryMs: number | null): string {
  if (expiryMs === null) {
    return "Token pending (will refresh on first use)";
  }

  if (expiryMs <= 0) {
    return "Token expired (will refresh on next request)";
  }

  const minutes = Math.floor(expiryMs / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${hours} ${hours === 1 ? "hour" : "hours"} ${remainingMinutes} ${remainingMinutes === 1 ? "minute" : "minutes"} remaining`;
    }
    return `${hours} ${hours === 1 ? "hour" : "hours"} remaining`;
  }

  return `${minutes} ${minutes === 1 ? "minute" : "minutes"} remaining`;
}

/**
 * Format authenticated status message according to design system
 */
export function formatAuthStatusAuthenticated({
  email,
  tokenExpiryMs,
  totalAccounts,
  rateLimitedCount,
  availableCount,
}: AuthStatusAuthenticatedParams): string {
  const tokenExpiryStr = formatTokenExpiry(tokenExpiryMs);
  const rateLimitedWord = rateLimitedCount === 1 ? "account" : "accounts";
  const availableWord = availableCount === 1 ? "account" : "accounts";

  return `Authentication Status
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  Status:         \u2713 Authenticated
  Active Account: ${email}
  Token Expiry:   ${tokenExpiryStr}

  Accounts:       ${totalAccounts} registered
  Rate Limited:   ${rateLimitedCount} ${rateLimitedWord}
  Available:      ${availableCount} ${availableWord}

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`;
}

/**
 * Format not authenticated status message
 */
export function formatAuthStatusNotAuthenticated({
  reason,
}: AuthStatusNotAuthenticatedParams): string {
  return `Authentication Status
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  Status:   \u2717 Not authenticated
  Reason:   ${reason}

To authenticate:
  \u2192 Use auth_login

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`;
}

/**
 * Handle auth_status tool execution
 *
 * Status check flow:
 * 1. Get all accounts
 * 2. Check if any accounts exist
 * 3. Get active account
 * 4. Calculate token expiry time
 * 5. Get rate limited and available counts
 * 6. Return formatted status message
 */
export function handleAuthStatus({
  accountManager,
  accountRotator,
}: HandleAuthStatusParams): ToolResponse {
  try {
    // Get all accounts
    const accounts = accountManager.getAccounts();

    // No accounts case
    if (accounts.length === 0) {
      return {
        isError: false,
        content: [
          {
            type: "text",
            text: formatAuthStatusNotAuthenticated({
              reason: "No accounts registered",
            }),
          },
        ],
      };
    }

    // Get active account (or use first available)
    let activeAccount = accountManager.getActiveAccount();
    if (!activeAccount) {
      // Use first available account for display
      const availableAccounts = accountRotator.getAvailableAccounts();
      activeAccount = availableAccounts[0] ?? accounts[0] ?? null;
    }

    // Calculate token expiry
    let tokenExpiryMs: number | null = null;
    if (activeAccount && activeAccount.accessTokenExpiry) {
      tokenExpiryMs = activeAccount.accessTokenExpiry - Date.now();
    }

    // Get rate limited and available counts
    const rateLimitedAccounts = accountRotator.getRateLimitedAccounts();
    const availableAccounts = accountRotator.getAvailableAccounts();

    logger.debug("auth_status executed", {
      totalAccounts: accounts.length,
      rateLimitedCount: rateLimitedAccounts.length,
      availableCount: availableAccounts.length,
    });

    return {
      isError: false,
      content: [
        {
          type: "text",
          text: formatAuthStatusAuthenticated({
            email: activeAccount?.email ?? "Unknown",
            tokenExpiryMs,
            totalAccounts: accounts.length,
            rateLimitedCount: rateLimitedAccounts.length,
            availableCount: availableAccounts.length,
          }),
        },
      ],
    };
  } catch (error) {
    logger.error("auth_status failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `[ERROR] Failed to get authentication status: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
    };
  }
}

// ============================================================================
// @TASK P3-T1-T3 - auth_remove MCP Tool
// ============================================================================

// Tool Definition
export const authRemoveTool = {
  name: "auth_remove",
  description: "Remove a Google account from the registered accounts",
  inputSchema: z.object({
    account_id: z.string().describe("Account ID or email address to remove"),
  }),
};

// Types for auth_remove
interface RemoveSuccessParams {
  email: string;
  remainingAccounts: number;
}

interface RemoveNotFoundParams {
  searchTerm: string;
}

export interface AuthToolContext {
  accountManager: AccountManager;
}

/**
 * Format success message for account removal
 */
export function formatRemoveSuccess({ email, remainingAccounts }: RemoveSuccessParams): string {
  const accountWord = remainingAccounts === 1 ? "account" : "accounts";
  return `\u2713 Account removed

  Removed: ${email}
  Remaining: ${remainingAccounts} ${accountWord}`;
}

/**
 * Format not found message
 */
export function formatRemoveNotFound({ searchTerm }: RemoveNotFoundParams): string {
  return `\u2717 Account not found

  Searched for: ${searchTerm}

Use auth_list to see registered accounts.`;
}

/**
 * Format last account protection message
 */
export function formatRemoveLastAccount(): string {
  return `\u2717 Cannot remove last account

  At least one account must remain registered.

To add a new account before removing:
  \u2192 Use auth_login first`;
}

/**
 * Handle auth_remove tool execution
 *
 * Removal flow:
 * 1. Get all accounts to check count
 * 2. Find account by ID or email
 * 3. Prevent removal if last account
 * 4. Remove account
 * 5. Return success/failure message
 */
export function handleAuthRemove(
  args: { account_id: string },
  context: AuthToolContext
): ToolResponse {
  const { accountManager } = context;
  const { account_id } = args;

  try {
    // Get all accounts
    const accounts = accountManager.getAccounts();

    // Try to find account by ID first
    let targetAccount = accountManager.getAccount(account_id);

    // If not found by ID, try to find by email (case-insensitive)
    if (!targetAccount) {
      targetAccount = accounts.find(
        (a) => a.email.toLowerCase() === account_id.toLowerCase()
      ) ?? null;
    }

    // Account not found
    if (!targetAccount) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: formatRemoveNotFound({ searchTerm: account_id }),
          },
        ],
      };
    }

    // Prevent removing last account
    if (accounts.length === 1) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: formatRemoveLastAccount(),
          },
        ],
      };
    }

    // Remove the account
    const removed = accountManager.removeAccount(targetAccount.id);

    if (!removed) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: formatRemoveNotFound({ searchTerm: account_id }),
          },
        ],
      };
    }

    // Get remaining account count
    const remainingAccounts = accountManager.getAccounts().length;

    logger.info("Account removed", {
      email: targetAccount.email,
      remainingAccounts,
    });

    return {
      isError: false,
      content: [
        {
          type: "text",
          text: formatRemoveSuccess({
            email: targetAccount.email,
            remainingAccounts,
          }),
        },
      ],
    };
  } catch (error) {
    logger.error("auth_remove failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `[ERROR] Failed to remove account: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
    };
  }
}
