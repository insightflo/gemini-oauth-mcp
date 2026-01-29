// @TASK P2-M6-T1 - API Module Entry Point
// @SPEC Re-exports for Gemini API client and transform utilities

export type {
  GeminiClient,
  ChatMessage,
  GenerationConfig,
  GeminiClientConfig,
  DelayFn,
} from "./client.js";

export {
  createGeminiClient,
  ANTIGRAVITY_URL,
  DEFAULT_MODEL,
  MAX_RETRIES,
} from "./client.js";

// @TASK P2-M6-T2 - Transform utilities
export type {
  McpChatRequest,
  AntigravityRequest,
  AntigravityResponse,
} from "./transform.js";

export {
  MODEL_MAP,
  mapModelName,
  transformToAntigravity,
  transformFromAntigravity,
  parseErrorResponse,
} from "./transform.js";
