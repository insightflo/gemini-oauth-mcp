// @TASK P0-T0.2 - MCP Server Setup
// @SPEC docs/planning/01-prd.md#mcp-tools

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  authLoginTool,
  authListTool,
  authRemoveTool,
  authStatusTool,
  handleAuthLogin,
  handleAuthList,
  handleAuthRemove,
  handleAuthStatus,
} from "./tools/auth.js";
import { chatTool, handleChat, type ChatInput } from "./tools/chat.js";
import {
  generateContentTool,
  handleGenerateContent,
  type GenerateContentInput,
} from "./tools/generate.js";
import { quotaStatusTool, handleQuotaStatus } from "./tools/quota.js";
import { AccountStorage } from "./auth/storage.js";
import { createAccountManager, type AccountManager } from "./accounts/manager.js";
import { createAccountRotator, type AccountRotator } from "./accounts/rotator.js";
import { createTokenManager, type TokenManager } from "./auth/token.js";
import { createQuotaTracker, type QuotaTracker } from "./accounts/quota.js";
import { createGeminiClient, type GeminiClient } from "./api/client.js";
import { getConfigPath } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import * as path from "path";

/**
 * MCP Server name and version
 */
const SERVER_NAME = "gemini-oauth";
const SERVER_VERSION = "0.1.0";

/**
 * Google OAuth Client ID (from environment or default)
 *
 * This is a public client ID for installed applications.
 * Users can override with their own Client ID via GOOGLE_CLIENT_ID env var.
 */
const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ??
  "590546207341-0d8s1spi7mi1jc6mhe3e2bs1gu10jd2d.apps.googleusercontent.com";

/**
 * Google OAuth Client Secret (from environment, optional for some flows)
 */
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

/**
 * Server dependencies (lazy initialized)
 */
interface ServerDependencies {
  storage: AccountStorage;
  accountManager: AccountManager;
  rotator: AccountRotator;
  tokenManager: TokenManager;
  quotaTracker: QuotaTracker;
  client: GeminiClient;
  initialized: boolean;
}

let deps: ServerDependencies | null = null;

/**
 * Initialize server dependencies
 */
async function initializeDependencies(): Promise<ServerDependencies> {
  if (deps?.initialized) {
    return deps;
  }

  const configPath = getConfigPath();
  const storagePath = path.join(configPath, "accounts.json");

  // Initialize storage and manager
  const storage = new AccountStorage(storagePath);
  const accountManager = createAccountManager(storage);
  await accountManager.initialize();

  // Initialize rotator
  const rotator = createAccountRotator(accountManager);

  // Initialize token manager
  const tokenManager = createTokenManager(storage, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);

  // Initialize quota tracker
  const quotaTracker = createQuotaTracker(accountManager);

  // Initialize Gemini client
  const client = createGeminiClient({
    tokenManager,
    rotator,
    quotaTracker,
  });

  deps = {
    storage,
    accountManager,
    rotator,
    tokenManager,
    quotaTracker,
    client,
    initialized: true,
  };

  logger.info("Server dependencies initialized", {
    accountCount: accountManager.getAccounts().length,
    clientId: GOOGLE_CLIENT_ID.substring(0, 20) + "...",
  });

  return deps;
}

/**
 * Get current email from rotator
 */
function getCurrentEmail(rotator: AccountRotator): string {
  try {
    const account = rotator.getNextAccount();
    return account.email;
  } catch {
    return "unknown";
  }
}

/**
 * Creates and configures the MCP Server instance.
 *
 * The server is configured with:
 * - Basic server info (name, version)
 * - Tool capabilities enabled
 * - All 7 MCP tools registered with actual handlers
 *
 * @returns Configured McpServer instance
 */
export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register health check tool
  server.registerTool(
    "ping",
    {
      description: "Check if the server is running",
    },
    () => ({
      content: [
        {
          type: "text" as const,
          text: "pong",
        },
      ],
    })
  );

  // Register auth_login tool
  server.registerTool(
    authLoginTool.name,
    {
      description: authLoginTool.description,
      inputSchema: z.object({}),
    },
    async () => {
      const { accountManager } = await initializeDependencies();
      const response = await handleAuthLogin({
        accountManager,
        config: { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET },
      });
      return {
        content: response.content,
        isError: response.isError,
      };
    }
  );

  // Register auth_list tool
  server.registerTool(
    authListTool.name,
    {
      description: authListTool.description,
      inputSchema: z.object({}),
    },
    async () => {
      const { accountManager, rotator } = await initializeDependencies();
      const response = handleAuthList({
        accountManager,
        accountRotator: rotator,
      });
      return {
        content: response.content,
        isError: response.isError,
      };
    }
  );

  // Register auth_remove tool
  server.registerTool(
    authRemoveTool.name,
    {
      description: authRemoveTool.description,
      inputSchema: z.object({
        account_id: z.string().describe("Account ID or email to remove"),
      }),
    },
    async (args: { account_id: string }) => {
      const { accountManager } = await initializeDependencies();
      const response = handleAuthRemove(args, { accountManager });
      return {
        content: response.content,
        isError: response.isError,
      };
    }
  );

  // Register auth_status tool
  server.registerTool(
    authStatusTool.name,
    {
      description: authStatusTool.description,
      inputSchema: z.object({}),
    },
    async () => {
      const { accountManager, rotator } = await initializeDependencies();
      const response = handleAuthStatus({
        accountManager,
        accountRotator: rotator,
      });
      return {
        content: response.content,
        isError: response.isError,
      };
    }
  );

  // Register chat tool
  server.registerTool(
    chatTool.name,
    {
      description: chatTool.description,
      inputSchema: z.object({
        message: z.string().describe("The message to send"),
        model: z.string().optional().describe("Model name (default: gemini-2.5-flash)"),
      }),
    },
    async (args: ChatInput) => {
      const { client, rotator } = await initializeDependencies();
      const response = await handleChat(args, {
        client,
        rotator,
        getCurrentEmail: () => getCurrentEmail(rotator),
      });
      return {
        content: response.content,
        isError: response.isError,
      };
    }
  );

  // Register generate_content tool
  server.registerTool(
    generateContentTool.name,
    {
      description: generateContentTool.description,
      inputSchema: z.object({
        prompt: z.string().describe("The prompt for content generation"),
        model: z.string().optional().describe("Model name (default: gemini-2.5-flash)"),
      }),
    },
    async (args: GenerateContentInput) => {
      const { client, rotator } = await initializeDependencies();
      const response = await handleGenerateContent(args, {
        client,
        rotator,
        getCurrentEmail: () => getCurrentEmail(rotator),
      });
      return {
        content: response.content,
        isError: response.isError,
      };
    }
  );

  // Register quota_status tool
  server.registerTool(
    quotaStatusTool.name,
    {
      description: quotaStatusTool.description,
      inputSchema: z.object({}),
    },
    async () => {
      const { quotaTracker } = await initializeDependencies();
      const response = handleQuotaStatus({ quotaTracker });
      return {
        content: response.content,
      };
    }
  );

  return server;
}

/**
 * Export server constants for testing
 */
export { SERVER_NAME, SERVER_VERSION, GOOGLE_CLIENT_ID };
