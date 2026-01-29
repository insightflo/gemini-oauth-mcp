// @TASK P3-T2-T1 - chat MCP Tool Unit Tests
// @SPEC Rate Limit auto-switch, message processing, response format

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  chatTool,
  handleChat,
  formatChatResponse,
  formatModelDisplayName,
  type ChatToolContext,
} from "../../../src/tools/chat.js";
import { RateLimitError, ApiError } from "../../../src/utils/errors.js";

/**
 * Mock dependencies for testing
 */
function createMockContext(): ChatToolContext {
  return {
    client: {
      generateContent: vi.fn(),
      chat: vi.fn(),
    },
    rotator: {
      getNextAccount: vi.fn(),
      markRateLimited: vi.fn(),
      clearRateLimit: vi.fn(),
      isRateLimited: vi.fn(),
      getAvailableAccounts: vi.fn(),
      getRateLimitedAccounts: vi.fn(),
    },
    getCurrentEmail: vi.fn(),
  };
}

describe("chatTool", () => {
  describe("schema", () => {
    it("should have correct name", () => {
      expect(chatTool.name).toBe("chat");
    });

    it("should have description", () => {
      expect(chatTool.description).toContain("Gemini");
    });

    it("should accept message parameter", () => {
      const schema = chatTool.inputSchema;
      const result = schema.safeParse({ message: "Hello" });
      expect(result.success).toBe(true);
    });

    it("should reject empty message", () => {
      const schema = chatTool.inputSchema;
      const result = schema.safeParse({ message: "" });
      expect(result.success).toBe(false);
    });

    it("should accept optional model parameter", () => {
      const schema = chatTool.inputSchema;
      const result = schema.safeParse({
        message: "Hello",
        model: "gemini-2.5-pro",
      });
      expect(result.success).toBe(true);
    });

    it("should use default model when not specified", () => {
      const schema = chatTool.inputSchema;
      const result = schema.safeParse({ message: "Hello" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.model).toBeUndefined();
      }
    });
  });
});

describe("formatModelDisplayName", () => {
  it("should format gemini-2.5-flash correctly", () => {
    expect(formatModelDisplayName("gemini-2.5-flash")).toBe("Gemini 2.5 Flash");
  });

  it("should format gemini-2.5-pro correctly", () => {
    expect(formatModelDisplayName("gemini-2.5-pro")).toBe("Gemini 2.5 Pro");
  });

  it("should format gemini-2.0-flash correctly", () => {
    expect(formatModelDisplayName("gemini-2.0-flash")).toBe("Gemini 2.0 Flash");
  });

  it("should handle full model names with preview suffix", () => {
    expect(formatModelDisplayName("gemini-2.5-flash-preview-04-17")).toBe(
      "Gemini 2.5 Flash Preview 04 17"
    );
  });

  it("should capitalize unknown models", () => {
    expect(formatModelDisplayName("custom-model")).toBe("Custom Model");
  });
});

describe("formatChatResponse", () => {
  it("should format response with model and email", () => {
    const result = formatChatResponse(
      "The capital of France is Paris.",
      "gemini-2.5-flash",
      "user@gmail.com"
    );

    expect(result).toContain("[Gemini 2.5 Flash via user@gmail.com]");
    expect(result).toContain("The capital of France is Paris.");
  });

  it("should handle different models", () => {
    const result = formatChatResponse(
      "Hello!",
      "gemini-2.5-pro",
      "test@gmail.com"
    );

    expect(result).toContain("[Gemini 2.5 Pro via test@gmail.com]");
    expect(result).toContain("Hello!");
  });

  it("should preserve newlines in response", () => {
    const multilineResponse = "Line 1\nLine 2\nLine 3";
    const result = formatChatResponse(
      multilineResponse,
      "gemini-2.5-flash",
      "user@gmail.com"
    );

    expect(result).toContain("Line 1\nLine 2\nLine 3");
  });
});

describe("handleChat", () => {
  let mockContext: ChatToolContext;

  beforeEach(() => {
    mockContext = createMockContext();
  });

  describe("basic functionality", () => {
    it("should call client.generateContent with message", async () => {
      const mockGenerate = vi.fn().mockResolvedValue("Paris is the capital.");
      mockContext.client.generateContent = mockGenerate;
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      const result = await handleChat(
        { message: "What is the capital of France?" },
        mockContext
      );

      expect(mockGenerate).toHaveBeenCalledWith(
        "What is the capital of France?",
        "gemini-2.5-flash" // default model
      );
      expect(result.content[0].text).toContain("Paris is the capital.");
    });

    it("should use custom model when specified", async () => {
      const mockGenerate = vi.fn().mockResolvedValue("Response");
      mockContext.client.generateContent = mockGenerate;
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      await handleChat(
        { message: "Hello", model: "gemini-2.5-pro" },
        mockContext
      );

      expect(mockGenerate).toHaveBeenCalledWith("Hello", "gemini-2.5-pro");
    });

    it("should format response correctly", async () => {
      mockContext.client.generateContent = vi
        .fn()
        .mockResolvedValue("The answer is 42.");
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      const result = await handleChat({ message: "What is 6*7?" }, mockContext);

      expect(result.content[0].text).toContain(
        "[Gemini 2.5 Flash via user@gmail.com]"
      );
      expect(result.content[0].text).toContain("The answer is 42.");
    });

    it("should return isError false on success", async () => {
      mockContext.client.generateContent = vi.fn().mockResolvedValue("OK");
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      const result = await handleChat({ message: "Test" }, mockContext);

      expect(result.isError).toBe(false);
    });
  });

  describe("rate limit handling", () => {
    it("should auto-retry on rate limit with different account", async () => {
      // First call fails with rate limit
      let callCount = 0;
      mockContext.client.generateContent = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new RateLimitError("Rate limited", 60);
        }
        return Promise.resolve("Success after retry");
      });

      // Track email switches - starts with user1, switches to user2 after rotation
      let currentEmailIndex = 0;
      const emails = ["user1@gmail.com", "user2@gmail.com"];
      mockContext.getCurrentEmail = vi.fn().mockImplementation(() => {
        return emails[currentEmailIndex];
      });

      // Simulate account rotation on rate limit - calling getNextAccount advances the email
      mockContext.rotator.getNextAccount = vi.fn().mockImplementation(() => {
        currentEmailIndex = 1; // Switch to user2
        return {
          id: "id-2",
          email: emails[1],
          status: "ready" as const,
          addedAt: new Date(),
        };
      });

      const result = await handleChat({ message: "Test" }, mockContext);

      expect(result.content[0].text).toContain("Rate limit");
      expect(result.content[0].text).toContain("user1@gmail.com");
      expect(result.content[0].text).toContain("user2@gmail.com");
      expect(result.content[0].text).toContain("Success after retry");
    });

    it("should include rate limit warning in response", async () => {
      let callCount = 0;
      mockContext.client.generateContent = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new RateLimitError("Rate limited", 60);
        }
        return Promise.resolve("OK");
      });

      // Track email switches
      let currentEmailIndex = 0;
      const emails = ["user1@gmail.com", "user2@gmail.com"];
      mockContext.getCurrentEmail = vi.fn().mockImplementation(() => {
        return emails[currentEmailIndex];
      });

      // getNextAccount triggers the switch
      mockContext.rotator.getNextAccount = vi.fn().mockImplementation(() => {
        currentEmailIndex = 1;
        return {
          id: "id-2",
          email: "user2@gmail.com",
          status: "ready" as const,
          addedAt: new Date(),
        };
      });

      const result = await handleChat({ message: "Test" }, mockContext);

      expect(result.content[0].text).toContain(
        "Rate limit on user1@gmail.com"
      );
      expect(result.content[0].text).toContain("Switching to user2@gmail.com");
    });

    it("should fail gracefully when all accounts are rate limited", async () => {
      mockContext.client.generateContent = vi.fn().mockImplementation(() => {
        throw new RateLimitError("All accounts rate limited", 300);
      });
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      const result = await handleChat({ message: "Test" }, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("rate limit");
    });
  });

  describe("error handling", () => {
    it("should handle API errors", async () => {
      mockContext.client.generateContent = vi.fn().mockRejectedValue(
        new ApiError("Server error")
      );
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      const result = await handleChat({ message: "Test" }, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("error");
    });

    it("should handle unexpected errors", async () => {
      mockContext.client.generateContent = vi
        .fn()
        .mockRejectedValue(new Error("Network failure"));
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      const result = await handleChat({ message: "Test" }, mockContext);

      expect(result.isError).toBe(true);
      // Check for "Error" (capital E) in output
      expect(result.content[0].text.toLowerCase()).toContain("error");
    });
  });
});
