// @TASK P3-T2-T1 - chat MCP Tool Implementation
// @SPEC message processing, model parameter, rate limit auto-switch, response format

import { z } from "zod";
import type { GeminiClient } from "../api/client.js";
import type { AccountRotator } from "../accounts/rotator.js";
import { RateLimitError } from "../utils/errors.js";

/**
 * Default model for chat tool
 */
export const DEFAULT_CHAT_MODEL = "gemini-2.5-flash";

/**
 * Maximum retry attempts for rate limit
 */
const MAX_RATE_LIMIT_RETRIES = 3;

/**
 * Chat tool input schema
 */
export const chatInputSchema = z.object({
  message: z.string().min(1).describe("The message to send"),
  model: z.string().optional().describe("Model name (default: gemini-2.5-flash)"),
});

/**
 * Chat tool definition for MCP
 */
export const chatTool = {
  name: "chat",
  description: "Chat with Gemini AI",
  inputSchema: chatInputSchema,
};

/**
 * Chat tool input type
 */
export type ChatInput = z.infer<typeof chatInputSchema>;

/**
 * MCP Tool response format
 */
export interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Context for chat tool execution
 */
export interface ChatToolContext {
  client: GeminiClient;
  rotator: AccountRotator;
  getCurrentEmail: () => string;
}

/**
 * Formats a model name to a human-readable display name.
 *
 * @param model - The model identifier (e.g., "gemini-2.5-flash")
 * @returns Formatted display name (e.g., "Gemini 2.5 Flash")
 *
 * @example
 * formatModelDisplayName("gemini-2.5-flash") // => "Gemini 2.5 Flash"
 * formatModelDisplayName("gemini-2.5-pro") // => "Gemini 2.5 Pro"
 */
export function formatModelDisplayName(model: string): string {
  // Split by hyphens and capitalize each word
  return model
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Formats the chat response with model and email header.
 *
 * @param response - The raw response text from Gemini
 * @param model - The model identifier used
 * @param email - The email of the account used
 * @returns Formatted response string
 *
 * @example
 * formatChatResponse("Paris is the capital.", "gemini-2.5-flash", "user@gmail.com")
 * // => "[Gemini 2.5 Flash via user@gmail.com]\n\nParis is the capital."
 */
export function formatChatResponse(
  response: string,
  model: string,
  email: string
): string {
  const displayName = formatModelDisplayName(model);
  return `[${displayName} via ${email}]\n\n${response}`;
}

/**
 * Formats rate limit warning message.
 *
 * @param oldEmail - The rate-limited account email
 * @param newEmail - The new account email being switched to
 * @returns Formatted warning string
 */
function formatRateLimitWarning(oldEmail: string, newEmail: string): string {
  return `\u26A0 Rate limit on ${oldEmail}\n  \u2192 Switching to ${newEmail}\n\n`;
}

/**
 * Handles the chat tool execution with rate limit retry logic.
 *
 * @param args - Tool input arguments
 * @param context - Execution context with dependencies
 * @returns MCP tool response
 */
export async function handleChat(
  args: ChatInput,
  context: ChatToolContext
): Promise<ToolResponse> {
  const { message, model = DEFAULT_CHAT_MODEL } = args;
  const { client, rotator, getCurrentEmail } = context;

  let retryCount = 0;
  let rateLimitWarnings = "";

  // Get email BEFORE the request (this is the account we'll try first)
  let currentEmail = getCurrentEmail();

  while (retryCount <= MAX_RATE_LIMIT_RETRIES) {
    try {
      const response = await client.generateContent(message, model);

      // Build final response with any warnings
      // Use currentEmail which reflects the account that succeeded
      const formattedResponse = formatChatResponse(response, model, currentEmail);
      const finalText = rateLimitWarnings + formattedResponse;

      return {
        content: [{ type: "text", text: finalText }],
        isError: false,
      };
    } catch (error) {
      if (error instanceof RateLimitError) {
        const rateLimitedEmail = currentEmail;
        retryCount++;

        if (retryCount > MAX_RATE_LIMIT_RETRIES) {
          // All retries exhausted
          return {
            content: [
              {
                type: "text",
                text: `Error: All accounts are rate limited. Please try again later.`,
              },
            ],
            isError: true,
          };
        }

        // Trigger account rotation
        // The rotator.getNextAccount() causes getCurrentEmail to return new value
        rotator.getNextAccount();

        // Get new email after rotation
        const newEmail = getCurrentEmail();

        // Add warning if email changed
        if (rateLimitedEmail !== newEmail) {
          rateLimitWarnings += formatRateLimitWarning(rateLimitedEmail, newEmail);
        }

        currentEmail = newEmail;
        continue;
      }

      // Handle other errors
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  // Should not reach here, but handle gracefully
  return {
    content: [{ type: "text", text: "Error: Unexpected error in chat handler" }],
    isError: true,
  };
}
