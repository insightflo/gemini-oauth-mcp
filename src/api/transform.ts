// @TASK P2-M6-T2 - Request/Response Transform Implementation
// @SPEC MCP <-> Antigravity 형식 변환, 모델명 매핑, 에러 응답 파싱

import { ApiError } from "../utils/errors.js";

/**
 * Model name mapping from user-friendly names to full API model identifiers
 */
export const MODEL_MAP: Record<string, string> = {
  "gemini-2.5-flash": "gemini-2.5-flash-preview-04-17",
  "gemini-2.5-pro": "gemini-2.5-pro-preview-05-06",
  "gemini-2.0-flash": "gemini-2.0-flash",
};

/**
 * Default model to use when not specified
 */
export const DEFAULT_MODEL = "gemini-2.0-flash";

/**
 * MCP chat request interface
 */
export interface McpChatRequest {
  message: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  history?: Array<{
    role: "user" | "model";
    content: string;
  }>;
}

/**
 * Antigravity request format
 */
export interface AntigravityRequest {
  model: string;
  contents: Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
  }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

/**
 * Antigravity response format
 */
export interface AntigravityResponse {
  candidates?: Array<{
    content: {
      parts: Array<{ text?: string }>;
      role: string;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/**
 * Antigravity error response format
 */
interface AntigravityErrorResponse {
  error: {
    code?: number;
    message?: string;
    status?: string;
    details?: unknown[];
  };
}

/**
 * Maps a user-friendly model name to its full API identifier.
 *
 * @param model - The model name to map
 * @returns The mapped model name, or the input as-is if not found in MODEL_MAP
 *
 * @example
 * mapModelName("gemini-2.5-flash") // => "gemini-2.5-flash-preview-04-17"
 * mapModelName("custom-model") // => "custom-model"
 */
export function mapModelName(model: string): string {
  return MODEL_MAP[model] ?? model;
}

/**
 * Transforms an MCP chat request to Antigravity API format.
 *
 * @param request - The MCP request to transform
 * @returns The Antigravity-formatted request
 *
 * @example
 * transformToAntigravity({ message: "Hello" })
 * // => { model: "gemini-2.0-flash", contents: [{ role: "user", parts: [{ text: "Hello" }] }] }
 */
export function transformToAntigravity(request: McpChatRequest): AntigravityRequest {
  // Build contents array from history (if any) plus current message
  const contents: AntigravityRequest["contents"] = [];

  // Add history messages first
  if (request.history && request.history.length > 0) {
    for (const historyItem of request.history) {
      contents.push({
        role: historyItem.role,
        parts: [{ text: historyItem.content }],
      });
    }
  }

  // Add current message
  contents.push({
    role: "user",
    parts: [{ text: request.message }],
  });

  // Build result
  const result: AntigravityRequest = {
    model: mapModelName(request.model ?? DEFAULT_MODEL),
    contents,
  };

  // Add generationConfig if temperature or maxOutputTokens provided
  if (request.temperature !== undefined || request.maxOutputTokens !== undefined) {
    result.generationConfig = {};

    if (request.temperature !== undefined) {
      result.generationConfig.temperature = request.temperature;
    }

    if (request.maxOutputTokens !== undefined) {
      result.generationConfig.maxOutputTokens = request.maxOutputTokens;
    }
  }

  return result;
}

/**
 * Transforms an Antigravity API response to MCP format (extracts text).
 *
 * @param response - The Antigravity response to transform
 * @returns The extracted text content
 * @throws {ApiError} If the response is empty or malformed
 *
 * @example
 * transformFromAntigravity({
 *   candidates: [{ content: { parts: [{ text: "Hello!" }], role: "model" }, finishReason: "STOP" }]
 * })
 * // => "Hello!"
 */
export function transformFromAntigravity(response: AntigravityResponse): string {
  // Check for empty candidates
  if (!response.candidates || response.candidates.length === 0) {
    throw new ApiError("Empty response: no candidates", { response });
  }

  const firstCandidate = response.candidates[0];

  // Check for empty parts
  if (!firstCandidate?.content?.parts || firstCandidate.content.parts.length === 0) {
    throw new ApiError("Empty response: no content parts", { response });
  }

  // Extract and concatenate text from all parts
  const textParts: string[] = [];

  for (const part of firstCandidate.content.parts) {
    if (part.text !== undefined && part.text !== "") {
      textParts.push(part.text);
    }
  }

  // Check if we got any text
  if (textParts.length === 0) {
    throw new ApiError("Empty response: no text content", { response });
  }

  return textParts.join("");
}

/**
 * Type guard to check if an object is an Antigravity error response
 */
function isAntigravityError(obj: unknown): obj is AntigravityErrorResponse {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "error" in obj &&
    typeof (obj as AntigravityErrorResponse).error === "object"
  );
}

/**
 * Parses various error types into an ApiError.
 *
 * @param error - The error to parse (can be Error, string, object, etc.)
 * @returns An ApiError instance
 *
 * @example
 * parseErrorResponse(new Error("Network error")) // => ApiError("Network error")
 * parseErrorResponse({ error: { message: "Bad request" } }) // => ApiError("Bad request")
 */
export function parseErrorResponse(error: unknown): ApiError {
  // If already an ApiError, return as-is
  if (error instanceof ApiError) {
    return error;
  }

  // If an Error instance, wrap it
  if (error instanceof Error) {
    return new ApiError(error.message);
  }

  // If a string, wrap it
  if (typeof error === "string") {
    return new ApiError(error);
  }

  // If a number, convert to string
  if (typeof error === "number") {
    return new ApiError(String(error));
  }

  // If an Antigravity error response object
  if (isAntigravityError(error)) {
    const { code, message, status, details } = error.error;

    return new ApiError(message ?? `API error: ${status ?? "unknown"}`, {
      code,
      status,
      details,
    });
  }

  // Unknown error type
  return new ApiError("Unknown error occurred");
}
