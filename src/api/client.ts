// @TASK P2-M6-T1 - Gemini API Client Implementation
// @SPEC Antigravity API call, Bearer Token auth, Rate Limit (429), Network retry (3x), Account rotation

import { TokenManager } from "../auth/token.js";
import { AccountRotator } from "../accounts/rotator.js";
import { QuotaTracker } from "../accounts/quota.js";
import { RateLimitError, ApiError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Standard Gemini API Endpoint
 */
const STANDARD_API_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Antigravity API Endpoint (sandbox)
 */
const ANTIGRAVITY_API_BASE_URL =
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1/models";

/**
 * Default model for Gemini API
 */
export const DEFAULT_MODEL = "gemini-2.5-flash";

/**
 * Get API base URL based on model
 * Gemini 3.0 models use Antigravity API, others use standard API
 */
function getApiBaseUrl(model: string): string {
  if (model.startsWith("gemini-3.")) {
    return ANTIGRAVITY_API_BASE_URL;
  }
  return STANDARD_API_BASE_URL;
}

/**
 * Maximum number of retries for network errors
 */
export const MAX_RETRIES = 3;

/**
 * Default rate limit retry time in milliseconds
 */
const DEFAULT_RATE_LIMIT_MS = 60000;

/**
 * Base delay for exponential backoff (in ms)
 */
const BASE_RETRY_DELAY_MS = 1000;

/**
 * Chat message interface
 */
export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

/**
 * Generation configuration options
 */
export interface GenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Delay function type for testing
 */
export type DelayFn = (ms: number) => Promise<void>;

/**
 * Client configuration options
 */
export interface GeminiClientConfig {
  tokenManager: TokenManager;
  rotator: AccountRotator;
  quotaTracker: QuotaTracker;
  generationConfig?: GenerationConfig;
  /** Custom delay function for testing */
  delayFn?: DelayFn;
}

/**
 * Gemini API request format
 */
interface GeminiRequest {
  contents: Array<{
    role: string;
    parts: Array<{ text: string }>;
  }>;
  generationConfig?: GenerationConfig;
}

/**
 * Gemini API response format
 */
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

/**
 * GeminiClient interface for interacting with Gemini API
 */
export interface GeminiClient {
  /**
   * Generate content from a single prompt
   * @param prompt - The prompt text
   * @param model - Optional model override
   * @returns Generated text response
   */
  generateContent(prompt: string, model?: string): Promise<string>;

  /**
   * Chat with message history
   * @param messages - Array of chat messages
   * @param model - Optional model override
   * @returns Generated response text
   */
  chat(messages: ChatMessage[], model?: string): Promise<string>;
}

/**
 * GeminiClient implementation
 */
class GeminiClientImpl implements GeminiClient {
  private readonly tokenManager: TokenManager;
  private readonly rotator: AccountRotator;
  private readonly quotaTracker: QuotaTracker;
  private readonly generationConfig?: GenerationConfig;
  private readonly delayFn: DelayFn;

  constructor(config: GeminiClientConfig) {
    this.tokenManager = config.tokenManager;
    this.rotator = config.rotator;
    this.quotaTracker = config.quotaTracker;
    this.generationConfig = config.generationConfig;
    this.delayFn = config.delayFn ?? this.defaultDelay.bind(this);
  }

  async generateContent(prompt: string, model?: string): Promise<string> {
    const contents = [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ];

    return this.callApi(contents, model ?? DEFAULT_MODEL);
  }

  async chat(messages: ChatMessage[], model?: string): Promise<string> {
    const contents = messages.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.content }],
    }));

    return this.callApi(contents, model ?? DEFAULT_MODEL);
  }

  /**
   * Internal API call with retry and rotation logic
   */
  private async callApi(
    contents: Array<{ role: string; parts: Array<{ text: string }> }>,
    model: string
  ): Promise<string> {
    let lastError: Error | null = null;
    let networkRetryCount = 0;

    while (networkRetryCount <= MAX_RETRIES) {
      // Get next available account (may throw if all rate limited)
      const account = this.rotator.getNextAccount();

      try {
        // Get access token for this account
        const accessToken = await this.tokenManager.getAccessToken(account.id);

        // Build request
        const request: GeminiRequest = {
          contents,
          generationConfig: this.generationConfig,
        };

        // Build API URL with model (select endpoint based on model)
        const apiBaseUrl = getApiBaseUrl(model);
        const apiUrl = `${apiBaseUrl}/${model}:generateContent`;

        // Make API call
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        });

        // Handle rate limit (429)
        if (response.status === 429) {
          const retryAfterHeader = response.headers.get("Retry-After");
          const retryAfterMs = retryAfterHeader
            ? parseInt(retryAfterHeader, 10) * 1000
            : DEFAULT_RATE_LIMIT_MS;

          logger.warn("Rate limit hit", {
            accountId: account.id,
            retryAfterMs,
          });

          // Mark account as rate limited
          this.rotator.markRateLimited(account.id, retryAfterMs);

          // Try next account (don't count as network retry)
          continue;
        }

        // Handle other error responses
        if (!response.ok) {
          const errorData = (await response.json()) as GeminiResponse;
          const errorMessage =
            errorData.error?.message || `HTTP ${response.status}`;

          // Retry on 5xx errors
          if (response.status >= 500) {
            networkRetryCount++;
            lastError = new ApiError(`Server error: ${errorMessage}`, {
              status: response.status,
            });

            if (networkRetryCount <= MAX_RETRIES) {
              await this.delayFn(this.getBackoffDelay(networkRetryCount));
              continue;
            }
          }

          throw new ApiError(`API error: ${errorMessage}`, {
            status: response.status,
          });
        }

        // Parse successful response
        const data = (await response.json()) as GeminiResponse;
        const text = this.extractResponseText(data);

        // Update quota on success
        this.quotaTracker.incrementUsage(account.id);

        return text;
      } catch (error) {
        // Handle RateLimitError from rotator (all accounts limited)
        if (error instanceof RateLimitError) {
          throw error;
        }

        // Handle ApiError (non-retryable)
        if (error instanceof ApiError) {
          throw error;
        }

        // Network error - retry with backoff
        networkRetryCount++;
        lastError = error instanceof Error ? error : new Error(String(error));

        logger.warn("Network error, retrying", {
          attempt: networkRetryCount,
          maxRetries: MAX_RETRIES,
          error: lastError.message,
        });

        if (networkRetryCount <= MAX_RETRIES) {
          await this.delayFn(this.getBackoffDelay(networkRetryCount));
        }
      }
    }

    // All retries exhausted
    throw new ApiError(
      `Request failed after ${MAX_RETRIES} retries: ${lastError?.message || "Unknown error"}`,
      { retries: MAX_RETRIES }
    );
  }

  /**
   * Extract text from API response
   */
  private extractResponseText(data: GeminiResponse): string {
    if (!data.candidates || data.candidates.length === 0) {
      throw new ApiError("Empty response: no candidates", { response: data });
    }

    const firstCandidate = data.candidates[0];
    if (!firstCandidate?.content?.parts || firstCandidate.content.parts.length === 0) {
      throw new ApiError("Empty response: no content parts", {
        response: data,
      });
    }

    const text = firstCandidate.content.parts[0]?.text;
    if (!text) {
      throw new ApiError("Empty response: no text content", { response: data });
    }

    return text;
  }

  /**
   * Calculate exponential backoff delay
   */
  private getBackoffDelay(attempt: number): number {
    // Exponential backoff: 1s, 2s, 4s, ...
    return BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
  }

  /**
   * Default delay implementation
   */
  private defaultDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create a GeminiClient instance
 * @param config - Client configuration
 * @returns GeminiClient instance
 */
export function createGeminiClient(config: GeminiClientConfig): GeminiClient {
  return new GeminiClientImpl(config);
}
