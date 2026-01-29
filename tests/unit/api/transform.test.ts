// @TASK P2-M6-T2 - Request/Response Transform Tests
// @SPEC MCP <-> Antigravity 형식 변환, 모델명 매핑, 에러 응답 파싱

import { describe, it, expect } from "vitest";
import {
  transformToAntigravity,
  transformFromAntigravity,
  mapModelName,
  parseErrorResponse,
  MODEL_MAP,
  type McpChatRequest,
  type AntigravityRequest,
  type AntigravityResponse,
} from "../../../src/api/transform.js";
import { ApiError } from "../../../src/utils/errors.js";

describe("transform", () => {
  describe("MODEL_MAP", () => {
    it("should have correct mappings for known models", () => {
      expect(MODEL_MAP["gemini-2.5-flash"]).toBe("gemini-2.5-flash-preview-04-17");
      expect(MODEL_MAP["gemini-2.5-pro"]).toBe("gemini-2.5-pro-preview-05-06");
      expect(MODEL_MAP["gemini-2.0-flash"]).toBe("gemini-2.0-flash");
    });
  });

  describe("mapModelName", () => {
    it("should map known model names to their full versions", () => {
      expect(mapModelName("gemini-2.5-flash")).toBe("gemini-2.5-flash-preview-04-17");
      expect(mapModelName("gemini-2.5-pro")).toBe("gemini-2.5-pro-preview-05-06");
      expect(mapModelName("gemini-2.0-flash")).toBe("gemini-2.0-flash");
    });

    it("should return input as-is for unknown models", () => {
      expect(mapModelName("some-custom-model")).toBe("some-custom-model");
      expect(mapModelName("gemini-3.0-ultra")).toBe("gemini-3.0-ultra");
    });

    it("should handle empty string", () => {
      expect(mapModelName("")).toBe("");
    });
  });

  describe("transformToAntigravity", () => {
    it("should transform simple MCP request to Antigravity format", () => {
      const mcpRequest: McpChatRequest = {
        message: "Hello, world!",
      };

      const result = transformToAntigravity(mcpRequest);

      expect(result).toEqual({
        model: "gemini-2.0-flash",
        contents: [
          {
            role: "user",
            parts: [{ text: "Hello, world!" }],
          },
        ],
      });
    });

    it("should use mapped model name when model is specified", () => {
      const mcpRequest: McpChatRequest = {
        message: "Test message",
        model: "gemini-2.5-flash",
      };

      const result = transformToAntigravity(mcpRequest);

      expect(result.model).toBe("gemini-2.5-flash-preview-04-17");
    });

    it("should use custom model name as-is when not in MODEL_MAP", () => {
      const mcpRequest: McpChatRequest = {
        message: "Test message",
        model: "custom-model-v1",
      };

      const result = transformToAntigravity(mcpRequest);

      expect(result.model).toBe("custom-model-v1");
    });

    it("should include generationConfig when provided", () => {
      const mcpRequest: McpChatRequest = {
        message: "Test message",
        temperature: 0.7,
        maxOutputTokens: 1000,
      };

      const result = transformToAntigravity(mcpRequest);

      expect(result.generationConfig).toEqual({
        temperature: 0.7,
        maxOutputTokens: 1000,
      });
    });

    it("should handle partial generationConfig (only temperature)", () => {
      const mcpRequest: McpChatRequest = {
        message: "Test message",
        temperature: 0.5,
      };

      const result = transformToAntigravity(mcpRequest);

      expect(result.generationConfig).toEqual({
        temperature: 0.5,
      });
    });

    it("should handle partial generationConfig (only maxOutputTokens)", () => {
      const mcpRequest: McpChatRequest = {
        message: "Test message",
        maxOutputTokens: 2000,
      };

      const result = transformToAntigravity(mcpRequest);

      expect(result.generationConfig).toEqual({
        maxOutputTokens: 2000,
      });
    });

    it("should not include generationConfig when not provided", () => {
      const mcpRequest: McpChatRequest = {
        message: "Test message",
      };

      const result = transformToAntigravity(mcpRequest);

      expect(result.generationConfig).toBeUndefined();
    });

    it("should handle message history when provided", () => {
      const mcpRequest: McpChatRequest = {
        message: "What is 2+2?",
        history: [
          { role: "user", content: "Hello" },
          { role: "model", content: "Hi there!" },
        ],
      };

      const result = transformToAntigravity(mcpRequest);

      expect(result.contents).toHaveLength(3);
      expect(result.contents[0]).toEqual({
        role: "user",
        parts: [{ text: "Hello" }],
      });
      expect(result.contents[1]).toEqual({
        role: "model",
        parts: [{ text: "Hi there!" }],
      });
      expect(result.contents[2]).toEqual({
        role: "user",
        parts: [{ text: "What is 2+2?" }],
      });
    });

    it("should handle empty history", () => {
      const mcpRequest: McpChatRequest = {
        message: "Hello",
        history: [],
      };

      const result = transformToAntigravity(mcpRequest);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].parts[0].text).toBe("Hello");
    });
  });

  describe("transformFromAntigravity", () => {
    it("should extract text from successful response", () => {
      const response: AntigravityResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: "Hello! How can I help you?" }],
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20,
          totalTokenCount: 30,
        },
      };

      const result = transformFromAntigravity(response);

      expect(result).toBe("Hello! How can I help you?");
    });

    it("should concatenate multiple parts", () => {
      const response: AntigravityResponse = {
        candidates: [
          {
            content: {
              parts: [
                { text: "Part 1. " },
                { text: "Part 2. " },
                { text: "Part 3." },
              ],
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
      };

      const result = transformFromAntigravity(response);

      expect(result).toBe("Part 1. Part 2. Part 3.");
    });

    it("should throw ApiError when candidates array is empty", () => {
      const response: AntigravityResponse = {
        candidates: [],
      };

      expect(() => transformFromAntigravity(response)).toThrow(ApiError);
      expect(() => transformFromAntigravity(response)).toThrow("Empty response: no candidates");
    });

    it("should throw ApiError when candidates is undefined", () => {
      const response: AntigravityResponse = {} as AntigravityResponse;

      expect(() => transformFromAntigravity(response)).toThrow(ApiError);
      expect(() => transformFromAntigravity(response)).toThrow("Empty response: no candidates");
    });

    it("should throw ApiError when content parts are empty", () => {
      const response: AntigravityResponse = {
        candidates: [
          {
            content: {
              parts: [],
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
      };

      expect(() => transformFromAntigravity(response)).toThrow(ApiError);
      expect(() => transformFromAntigravity(response)).toThrow("Empty response: no content parts");
    });

    it("should throw ApiError when all parts have no text", () => {
      const response: AntigravityResponse = {
        candidates: [
          {
            content: {
              parts: [{}] as Array<{ text: string }>,
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
      };

      expect(() => transformFromAntigravity(response)).toThrow(ApiError);
      expect(() => transformFromAntigravity(response)).toThrow("Empty response: no text content");
    });

    it("should handle response with SAFETY finishReason", () => {
      const response: AntigravityResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: "I cannot respond to that." }],
              role: "model",
            },
            finishReason: "SAFETY",
          },
        ],
      };

      const result = transformFromAntigravity(response);

      expect(result).toBe("I cannot respond to that.");
    });

    it("should skip empty text parts and concatenate non-empty ones", () => {
      const response: AntigravityResponse = {
        candidates: [
          {
            content: {
              parts: [
                { text: "" },
                { text: "Valid text" },
                { text: "" },
              ],
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
      };

      const result = transformFromAntigravity(response);

      expect(result).toBe("Valid text");
    });
  });

  describe("parseErrorResponse", () => {
    it("should parse Error instance", () => {
      const error = new Error("Something went wrong");

      const result = parseErrorResponse(error);

      expect(result).toBeInstanceOf(ApiError);
      expect(result.message).toBe("Something went wrong");
    });

    it("should return ApiError as-is", () => {
      const apiError = new ApiError("API failed", { status: 500 });

      const result = parseErrorResponse(apiError);

      expect(result).toBe(apiError);
      expect(result.message).toBe("API failed");
    });

    it("should parse Antigravity error response object", () => {
      const errorResponse = {
        error: {
          code: 400,
          message: "Invalid request format",
          status: "INVALID_ARGUMENT",
        },
      };

      const result = parseErrorResponse(errorResponse);

      expect(result).toBeInstanceOf(ApiError);
      expect(result.message).toBe("Invalid request format");
      expect(result.details?.code).toBe(400);
      expect(result.details?.status).toBe("INVALID_ARGUMENT");
    });

    it("should parse string error", () => {
      const result = parseErrorResponse("Network timeout");

      expect(result).toBeInstanceOf(ApiError);
      expect(result.message).toBe("Network timeout");
    });

    it("should handle unknown error type", () => {
      const result = parseErrorResponse(null);

      expect(result).toBeInstanceOf(ApiError);
      expect(result.message).toBe("Unknown error occurred");
    });

    it("should handle undefined error", () => {
      const result = parseErrorResponse(undefined);

      expect(result).toBeInstanceOf(ApiError);
      expect(result.message).toBe("Unknown error occurred");
    });

    it("should handle numeric error", () => {
      const result = parseErrorResponse(500);

      expect(result).toBeInstanceOf(ApiError);
      expect(result.message).toBe("500");
    });

    it("should parse error with nested structure", () => {
      const errorResponse = {
        error: {
          code: 429,
          message: "Resource has been exhausted",
          status: "RESOURCE_EXHAUSTED",
          details: [
            { "@type": "type.googleapis.com/google.rpc.QuotaFailure" },
          ],
        },
      };

      const result = parseErrorResponse(errorResponse);

      expect(result).toBeInstanceOf(ApiError);
      expect(result.message).toBe("Resource has been exhausted");
      expect(result.details?.code).toBe(429);
    });

    it("should handle error object without message field", () => {
      const errorResponse = {
        error: {
          code: 401,
        },
      };

      const result = parseErrorResponse(errorResponse);

      expect(result).toBeInstanceOf(ApiError);
      expect(result.message).toContain("API error");
    });
  });
});
