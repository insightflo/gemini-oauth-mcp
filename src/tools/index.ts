// @TASK P3-T1-T1 - MCP Tools Index
// @SPEC Export all MCP tools for server registration

export { authLoginTool, handleAuthLogin, formatAuthSuccess, formatAuthFailure } from "./auth.js";
export type { ToolResponse } from "./auth.js";

// @TASK P3-T2-T1 - Chat Tool
export {
  chatTool,
  handleChat,
  formatChatResponse,
  formatModelDisplayName,
  DEFAULT_CHAT_MODEL,
} from "./chat.js";
export type { ChatInput, ChatToolContext } from "./chat.js";

// @TASK P3-T2-T2 - Generate Content Tool
export {
  generateContentTool,
  handleGenerateContent,
  formatGenerateResponse,
  DEFAULT_GENERATE_MODEL,
} from "./generate.js";
export type { GenerateContentInput, GenerateToolContext } from "./generate.js";
