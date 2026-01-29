// @TASK P3-T2-T2 - generate_content MCP Tool Implementation
// @SPEC prompt processing, model parameter, rate limit auto-switch, response format

import { z } from "zod";
import type { GeminiClient } from "../api/client.js";
import type { AccountRotator } from "../accounts/rotator.js";
import { RateLimitError } from "../utils/errors.js";

/**
 * Default model for generate_content tool
 */
export const DEFAULT_GENERATE_MODEL = "gemini-2.5-flash";

/**
 * Maximum retry attempts for rate limit
 */
const MAX_RATE_LIMIT_RETRIES = 3;

/**
 * Generate content tool input schema
 */
export const generateContentInputSchema = z.object({
  prompt: z.string().min(1).describe("The prompt for content generation"),
  model: z
    .string()
    .optional()
    .describe("Model name (default: gemini-2.5-flash)"),
});

/**
 * Generate content tool definition for MCP
 */
export const generateContentTool = {
  name: "generate_content",
  description: "Generate content with Gemini AI",
  inputSchema: generateContentInputSchema,
};

/**
 * Generate content tool input type
 */
export type GenerateContentInput = z.infer<typeof generateContentInputSchema>;

/**
 * MCP Tool response format
 */
export interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Context for generate content tool execution
 */
export interface GenerateToolContext {
  client: GeminiClient;
  rotator: AccountRotator;
  getCurrentEmail: () => string;
}

/**
 * Formats a model name to a human-readable display name.
 *
 * @param model - The model identifier (e.g., "gemini-2.5-flash")
 * @returns Formatted display name (e.g., "Gemini 2.5 Flash")
 */
function formatModelDisplayName(model: string): string {
  return model
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Formats the generate response with model and email header.
 *
 * @param response - The raw response text from Gemini
 * @param model - The model identifier used
 * @param email - The email of the account used
 * @returns Formatted response string
 *
 * @example
 * formatGenerateResponse("Content here", "gemini-2.5-flash", "user@gmail.com")
 * // => "[Gemini 2.5 Flash via user@gmail.com]\n\nContent here"
 */
export function formatGenerateResponse(
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
 * Handles the generate_content tool execution with rate limit retry logic.
 *
 * @param args - Tool input arguments
 * @param context - Execution context with dependencies
 * @returns MCP tool response
 */
export async function handleGenerateContent(
  args: GenerateContentInput,
  context: GenerateToolContext
): Promise<ToolResponse> {
  const { prompt, model = DEFAULT_GENERATE_MODEL } = args;
  const { client, rotator, getCurrentEmail } = context;

  let retryCount = 0;
  let rateLimitWarnings = "";

  // Get email BEFORE the request (this is the account we'll try first)
  let currentEmail = getCurrentEmail();

  while (retryCount <= MAX_RATE_LIMIT_RETRIES) {
    try {
      const response = await client.generateContent(prompt, model);

      // Build final response with any warnings
      const formattedResponse = formatGenerateResponse(
        response,
        model,
        currentEmail
      );
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
        rotator.getNextAccount();

        // Get new email after rotation
        const newEmail = getCurrentEmail();

        // Add warning if email changed
        if (rateLimitedEmail !== newEmail) {
          rateLimitWarnings += formatRateLimitWarning(
            rateLimitedEmail,
            newEmail
          );
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
    content: [
      { type: "text", text: "Error: Unexpected error in generate handler" },
    ],
    isError: true,
  };
}
