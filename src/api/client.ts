// @TASK P2-M6-T1 - Gemini API Client Implementation
// @SPEC Antigravity API call, Bearer Token auth, Rate Limit (429), Network retry (3x), Account rotation

import { TokenManager } from "../auth/token.js";
import { AccountRotator } from "../accounts/rotator.js";
import { QuotaTracker } from "../accounts/quota.js";
import { RateLimitError, ApiError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const STANDARD_API_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

const ANTIGRAVITY_API_BASE_URLS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
];

export const DEFAULT_MODEL = "gemini-2.5-flash";

function isAntigravityModel(model: string): boolean {
  return model.startsWith("gemini-3") || model.startsWith("claude-");
}

function generateRequestId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `req_${timestamp}_${random}`;
}

function generateSessionId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `sess_${timestamp}_${random}`;
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

export interface GeminiClientConfig {
  tokenManager: TokenManager;
  rotator: AccountRotator;
  quotaTracker: QuotaTracker;
  generationConfig?: GenerationConfig;
  delayFn?: DelayFn;
}

interface GeminiRequest {
  contents: Array<{
    role: string;
    parts: Array<{ text: string }>;
  }>;
  generationConfig?: GenerationConfig;
}

interface AntigravityRequest {
  project: string;
  requestId: string;
  model: string;
  userAgent: string;
  requestType: string;
  request: {
    contents: Array<{
      role: string;
      parts: Array<{ text: string }>;
    }>;
    session_id: string;
    generationConfig: {
      responseModalities: string[];
      temperature: number;
      maxOutputTokens: number;
    };
  };
}

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

interface AntigravitySSEData {
  response?: {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
}

export interface GeminiClient {
  generateContent(prompt: string, model?: string): Promise<string>;
  chat(messages: ChatMessage[], model?: string): Promise<string>;
}

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
    const contents = [{ role: "user", parts: [{ text: prompt }] }];
    return this.callApi(contents, model ?? DEFAULT_MODEL);
  }

  async chat(messages: ChatMessage[], model?: string): Promise<string> {
    const contents = messages.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.content }],
    }));
    return this.callApi(contents, model ?? DEFAULT_MODEL);
  }

  private async callApi(
    contents: Array<{ role: string; parts: Array<{ text: string }> }>,
    model: string
  ): Promise<string> {
    const useAntigravity = isAntigravityModel(model);

    if (useAntigravity) {
      return this.callAntigravityApi(contents, model);
    }
    return this.callStandardApi(contents, model);
  }

  private async callStandardApi(
    contents: Array<{ role: string; parts: Array<{ text: string }> }>,
    model: string
  ): Promise<string> {
    let lastError: Error | null = null;
    let networkRetryCount = 0;

    while (networkRetryCount <= MAX_RETRIES) {
      const account = this.rotator.getNextAccount();

      try {
        const accessToken = await this.tokenManager.getAccessToken(account.id);
        const request: GeminiRequest = { contents, generationConfig: this.generationConfig };
        const apiUrl = `${STANDARD_API_BASE_URL}/${model}:generateContent`;

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        });

        if (response.status === 429) {
          const retryAfterHeader = response.headers.get("Retry-After");
          const retryAfterMs = retryAfterHeader
            ? parseInt(retryAfterHeader, 10) * 1000
            : DEFAULT_RATE_LIMIT_MS;

          logger.warn("Rate limit hit", { accountId: account.id, retryAfterMs });
          this.rotator.markRateLimited(account.id, retryAfterMs);
          continue;
        }

        if (!response.ok) {
          const errorData = (await response.json()) as GeminiResponse;
          const errorMessage = errorData.error?.message || `HTTP ${response.status}`;

          if (response.status >= 500) {
            networkRetryCount++;
            lastError = new ApiError(`Server error: ${errorMessage}`, { status: response.status });
            if (networkRetryCount <= MAX_RETRIES) {
              await this.delayFn(this.getBackoffDelay(networkRetryCount));
              continue;
            }
          }
          throw new ApiError(`API error: ${errorMessage}`, { status: response.status });
        }

        const data = (await response.json()) as GeminiResponse;
        const text = this.extractStandardResponseText(data);
        this.quotaTracker.incrementUsage(account.id);
        return text;
      } catch (error) {
        if (error instanceof RateLimitError || error instanceof ApiError) {
          throw error;
        }
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
    throw new ApiError(
      `Request failed after ${MAX_RETRIES} retries: ${lastError?.message || "Unknown error"}`,
      { retries: MAX_RETRIES }
    );
  }

  private async callAntigravityApi(
    contents: Array<{ role: string; parts: Array<{ text: string }> }>,
    model: string
  ): Promise<string> {
    let lastError: Error | null = null;
    let networkRetryCount = 0;

    while (networkRetryCount <= MAX_RETRIES) {
      const account = this.rotator.getNextAccount();
      const projectId = account.projectId;

      if (!projectId) {
        logger.warn("No projectId for Antigravity account, skipping", {
          accountId: account.id,
          email: account.email,
        });
        continue;
      }

      try {
        const accessToken = await this.tokenManager.getAccessToken(account.id);
        const request: AntigravityRequest = {
          project: projectId,
          requestId: generateRequestId(),
          model: model,
          userAgent: "antigravity",
          requestType: "agent",
          request: {
            contents,
            session_id: generateSessionId(),
            generationConfig: {
              responseModalities: ["TEXT"],
              temperature: this.generationConfig?.temperature ?? 0.7,
              maxOutputTokens: this.generationConfig?.maxOutputTokens ?? 4096,
            },
          },
        };

        // Track which endpoints returned 429 for THIS request
        let rateLimitedEndpointCount = 0;
        let lastRateLimitRetryMs = DEFAULT_RATE_LIMIT_MS;

        for (const baseUrl of ANTIGRAVITY_API_BASE_URLS) {
          try {
            const apiUrl = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;

            const response = await fetch(apiUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "User-Agent": "antigravity",
              },
              body: JSON.stringify(request),
            });

            if (response.status === 429) {
              const retryAfterHeader = response.headers.get("Retry-After");
              const retryAfterMs = retryAfterHeader
                ? parseInt(retryAfterHeader, 10) * 1000
                : DEFAULT_RATE_LIMIT_MS;

              logger.warn("Rate limit hit on Antigravity endpoint, trying next", {
                accountId: account.id,
                baseUrl,
                retryAfterMs,
              });
              
              // Track this endpoint's 429, but DON'T mark account yet
              rateLimitedEndpointCount++;
              lastRateLimitRetryMs = Math.max(lastRateLimitRetryMs, retryAfterMs);
              continue; // Try next endpoint instead of breaking
            }

            if (response.status === 404 || response.status >= 500) {
              logger.warn("Antigravity endpoint unavailable, trying next", {
                baseUrl,
                status: response.status,
              });
              continue;
            }

            if (!response.ok) {
              const errorText = await response.text();
              throw new ApiError(`Antigravity API error: ${errorText.slice(0, 500)}`, {
                status: response.status,
              });
            }

            const text = await this.parseAntigravitySSEResponse(response);
            if (text) {
              this.quotaTracker.incrementUsage(account.id);
              logger.info("Antigravity generation complete", {
                accountId: account.id,
                model,
                responseLength: text.length,
              });
              return text;
            }

            throw new ApiError("Empty response from Antigravity API", {});
          } catch (error) {
            if (error instanceof ApiError) throw error;
            logger.warn("Antigravity endpoint error", {
              baseUrl,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Only mark account as rate limited if ALL endpoints returned 429
        if (rateLimitedEndpointCount === ANTIGRAVITY_API_BASE_URLS.length) {
          logger.warn("All Antigravity endpoints rate limited, marking account", {
            accountId: account.id,
            retryAfterMs: lastRateLimitRetryMs,
          });
          this.rotator.markRateLimited(account.id, lastRateLimitRetryMs);
        }

        networkRetryCount++;
        lastError = new ApiError("All Antigravity endpoints failed", {});
        if (networkRetryCount <= MAX_RETRIES) {
          await this.delayFn(this.getBackoffDelay(networkRetryCount));
        }
      } catch (error) {
        if (error instanceof RateLimitError || error instanceof ApiError) {
          throw error;
        }
        networkRetryCount++;
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn("Antigravity network error, retrying", {
          attempt: networkRetryCount,
          maxRetries: MAX_RETRIES,
          error: lastError.message,
        });
        if (networkRetryCount <= MAX_RETRIES) {
          await this.delayFn(this.getBackoffDelay(networkRetryCount));
        }
      }
    }

    throw new ApiError(
      `Antigravity request failed after ${MAX_RETRIES} retries: ${lastError?.message || "Unknown error"}`,
      { retries: MAX_RETRIES }
    );
  }

  private async parseAntigravitySSEResponse(response: Response): Promise<string> {
    const fullResponse = await response.text();
    let fullText = "";

    for (const line of fullResponse.split("\n")) {
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith("data:")) continue;

      const jsonStr = trimmedLine.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;

      try {
        const data = JSON.parse(jsonStr) as AntigravitySSEData;
        const candidates = data.response?.candidates;
        if (!candidates?.length) continue;

        const parts = candidates[0]?.content?.parts;
        if (!parts) continue;

        for (const part of parts) {
          if (part.text) {
            fullText += part.text;
          }
        }
      } catch {
        // JSON parse error - skip this line
      }
    }

    return fullText;
  }

  private extractStandardResponseText(data: GeminiResponse): string {
    if (!data.candidates || data.candidates.length === 0) {
      throw new ApiError("Empty response: no candidates", { response: data });
    }

    const firstCandidate = data.candidates[0];
    if (!firstCandidate?.content?.parts || firstCandidate.content.parts.length === 0) {
      throw new ApiError("Empty response: no content parts", { response: data });
    }

    const text = firstCandidate.content.parts[0]?.text;
    if (!text) {
      throw new ApiError("Empty response: no text content", { response: data });
    }

    return text;
  }

  private getBackoffDelay(attempt: number): number {
    return BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
  }

  private defaultDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createGeminiClient(config: GeminiClientConfig): GeminiClient {
  return new GeminiClientImpl(config);
}
