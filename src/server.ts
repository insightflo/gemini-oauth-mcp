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
import {
  configGetTool,
  configSetTool,
  handleConfigGet,
  handleConfigSet,
  modelTool,
  handleModel,
  useFlashTool,
  useProTool,
  useFlash20Tool,
  useFlash15Tool,
  usePro15Tool,
  handleUseModel,
  geminiGenerateTextTool,
  type ConfigSetInput,
  type ModelInput,
  type GeminiGenerateTextInput,
} from "./tools/config.js";
import { AVAILABLE_MODELS } from "./utils/config.js";
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
 * OAuth Credentials
 *
 * Using Antigravity credentials as default since they work for both:
 * - Standard Gemini API (2.5 models)
 * - Antigravity API (3.0 models)
 *
 * Users can override with their own credentials via environment variables.
 */
const OAUTH_CLIENT_ID =
  process.env.GEMINI_CLIENT_ID ??
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";

const OAUTH_CLIENT_SECRET =
  process.env.GEMINI_CLIENT_SECRET ?? "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";

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

  // Initialize storage and manager
  // Note: AccountStorage appends "accounts.json" internally
  const storage = new AccountStorage(configPath);
  const accountManager = createAccountManager(storage);
  await accountManager.initialize();

  // Initialize rotator
  const rotator = createAccountRotator(accountManager);

  // Initialize token manager
  const tokenManager = createTokenManager(storage, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);

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
    clientId: OAUTH_CLIENT_ID.substring(0, 20) + "...",
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
      inputSchema: z.object({
        mode: z.enum(["standard", "antigravity"]).optional().describe("Auth mode: 'standard' for regular Gemini API (2.5 models), 'antigravity' for Gemini 3.0 (experimental). Default: standard"),
      }),
    },
    async (args: { mode?: "standard" | "antigravity" }) => {
      const { accountManager, tokenManager } = await initializeDependencies();
      const response = await handleAuthLogin({
        accountManager,
        config: { clientId: OAUTH_CLIENT_ID, clientSecret: OAUTH_CLIENT_SECRET },
        mode: args.mode ?? "standard",
      });
      // Clear token cache to ensure fresh account data is loaded
      if (!response.isError) {
        tokenManager.clearCache();
      }
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
      const { accountManager, tokenManager } = await initializeDependencies();
      const response = handleAuthRemove(args, { accountManager });
      // Clear token cache to ensure fresh account data is loaded
      if (!response.isError) {
        tokenManager.clearCache();
      }
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
        model: z.string().optional().describe("Model name (default: gemini-3.0-flash)"),
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
        model: z.string().optional().describe("Model name (default: gemini-3.0-flash)"),
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

  // Register config_get tool
  server.registerTool(
    configGetTool.name,
    {
      description: configGetTool.description,
      inputSchema: z.object({}),
    },
    () => {
      const response = handleConfigGet();
      return {
        content: response.content,
      };
    }
  );

  // Register config_set tool
  server.registerTool(
    configSetTool.name,
    {
      description: configSetTool.description,
      inputSchema: z.object({
        key: z.enum(["default_model"]).describe("Configuration key to set"),
        value: z.string().describe("Value to set. Models: " + AVAILABLE_MODELS.join(", ")),
      }),
    },
    (args: ConfigSetInput) => {
      const response = handleConfigSet(args);
      return {
        content: response.content,
        isError: response.isError,
      };
    }
  );

  // Register model tool (simple model selector)
  server.registerTool(
    modelTool.name,
    {
      description: modelTool.description,
      inputSchema: z.object({
        name: z
          .enum(AVAILABLE_MODELS as unknown as [string, ...string[]])
          .optional()
          .describe("Model to set as default"),
      }),
    },
    (args: ModelInput) => {
      const response = handleModel(args);
      return {
        content: response.content,
      };
    }
  );

  // Register shortcut tools for quick model switching
  server.registerTool(
    useFlashTool.name,
    {
      description: useFlashTool.description,
      inputSchema: z.object({}),
    },
    () => {
      const response = handleUseModel("gemini-3.0-flash");
      return { content: response.content };
    }
  );

  server.registerTool(
    useProTool.name,
    {
      description: useProTool.description,
      inputSchema: z.object({}),
    },
    () => {
      const response = handleUseModel("gemini-3.0-pro");
      return { content: response.content };
    }
  );

  server.registerTool(
    useFlash20Tool.name,
    {
      description: useFlash20Tool.description,
      inputSchema: z.object({}),
    },
    () => {
      const response = handleUseModel("gemini-2.0-flash");
      return { content: response.content };
    }
  );

  server.registerTool(
    useFlash15Tool.name,
    {
      description: useFlash15Tool.description,
      inputSchema: z.object({}),
    },
    () => {
      const response = handleUseModel("gemini-1.5-flash");
      return { content: response.content };
    }
  );

  server.registerTool(
    usePro15Tool.name,
    {
      description: usePro15Tool.description,
      inputSchema: z.object({}),
    },
    () => {
      const response = handleUseModel("gemini-1.5-pro");
      return { content: response.content };
    }
  );

  // Register gemini_generate_text (legacy alias for generate_content)
  server.registerTool(
    geminiGenerateTextTool.name,
    {
      description: geminiGenerateTextTool.description,
      inputSchema: z.object({
        prompt: z.string().describe("The prompt for text generation"),
        model: z.string().optional().describe("Model name (default: gemini-3.0-flash)"),
      }),
    },
    async (args: GeminiGenerateTextInput) => {
      const { client, rotator } = await initializeDependencies();
      const response = await handleGenerateContent(
        { prompt: args.prompt, model: args.model },
        {
          client,
          rotator,
          getCurrentEmail: () => getCurrentEmail(rotator),
        }
      );
      return {
        content: response.content,
        isError: response.isError,
      };
    }
  );

  return server;
}

/**
 * Export server constants for testing
 */
export { SERVER_NAME, SERVER_VERSION, OAUTH_CLIENT_ID };
