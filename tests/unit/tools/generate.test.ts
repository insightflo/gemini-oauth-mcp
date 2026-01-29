// @TASK P3-T2-T2 - generate_content MCP Tool Unit Tests
// @SPEC prompt processing, model parameter, rate limit handling, response format

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateContentTool,
  handleGenerateContent,
  formatGenerateResponse,
  type GenerateToolContext,
} from "../../../src/tools/generate.js";
import { RateLimitError, ApiError } from "../../../src/utils/errors.js";

/**
 * Mock dependencies for testing
 */
function createMockContext(): GenerateToolContext {
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

describe("generateContentTool", () => {
  describe("schema", () => {
    it("should have correct name", () => {
      expect(generateContentTool.name).toBe("generate_content");
    });

    it("should have description", () => {
      expect(generateContentTool.description).toContain("Generate");
    });

    it("should accept prompt parameter", () => {
      const schema = generateContentTool.inputSchema;
      const result = schema.safeParse({ prompt: "Write a haiku" });
      expect(result.success).toBe(true);
    });

    it("should reject empty prompt", () => {
      const schema = generateContentTool.inputSchema;
      const result = schema.safeParse({ prompt: "" });
      expect(result.success).toBe(false);
    });

    it("should accept optional model parameter", () => {
      const schema = generateContentTool.inputSchema;
      const result = schema.safeParse({
        prompt: "Write a poem",
        model: "gemini-2.5-pro",
      });
      expect(result.success).toBe(true);
    });

    it("should use default model when not specified", () => {
      const schema = generateContentTool.inputSchema;
      const result = schema.safeParse({ prompt: "Hello" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.model).toBeUndefined();
      }
    });
  });
});

describe("formatGenerateResponse", () => {
  it("should format response with model and email", () => {
    const result = formatGenerateResponse(
      "Lines of logic flow\nSilent keystrokes in the night\nBugs bloom like spring flowers",
      "gemini-2.5-flash",
      "user@gmail.com"
    );

    expect(result).toContain("[Gemini 2.5 Flash via user@gmail.com]");
    expect(result).toContain("Lines of logic flow");
  });

  it("should handle different models", () => {
    const result = formatGenerateResponse(
      "Generated content",
      "gemini-2.5-pro",
      "test@gmail.com"
    );

    expect(result).toContain("[Gemini 2.5 Pro via test@gmail.com]");
    expect(result).toContain("Generated content");
  });

  it("should preserve multiline content", () => {
    const multilineContent = "Line 1\nLine 2\nLine 3";
    const result = formatGenerateResponse(
      multilineContent,
      "gemini-2.5-flash",
      "user@gmail.com"
    );

    expect(result).toContain("Line 1\nLine 2\nLine 3");
  });
});

describe("handleGenerateContent", () => {
  let mockContext: GenerateToolContext;

  beforeEach(() => {
    mockContext = createMockContext();
  });

  describe("basic functionality", () => {
    it("should call client.generateContent with prompt", async () => {
      const mockGenerate = vi.fn().mockResolvedValue("Generated haiku");
      mockContext.client.generateContent = mockGenerate;
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      const result = await handleGenerateContent(
        { prompt: "Write a haiku about coding" },
        mockContext
      );

      expect(mockGenerate).toHaveBeenCalledWith(
        "Write a haiku about coding",
        "gemini-2.5-flash" // default model
      );
      expect(result.content[0].text).toContain("Generated haiku");
    });

    it("should use custom model when specified", async () => {
      const mockGenerate = vi.fn().mockResolvedValue("Response");
      mockContext.client.generateContent = mockGenerate;
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      await handleGenerateContent(
        { prompt: "Write a story", model: "gemini-2.5-pro" },
        mockContext
      );

      expect(mockGenerate).toHaveBeenCalledWith("Write a story", "gemini-2.5-pro");
    });

    it("should format response correctly", async () => {
      mockContext.client.generateContent = vi
        .fn()
        .mockResolvedValue("The generated content is here.");
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      const result = await handleGenerateContent(
        { prompt: "Generate something" },
        mockContext
      );

      expect(result.content[0].text).toContain(
        "[Gemini 2.5 Flash via user@gmail.com]"
      );
      expect(result.content[0].text).toContain("The generated content is here.");
    });

    it("should return isError false on success", async () => {
      mockContext.client.generateContent = vi.fn().mockResolvedValue("OK");
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      const result = await handleGenerateContent(
        { prompt: "Test" },
        mockContext
      );

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

      const result = await handleGenerateContent(
        { prompt: "Test" },
        mockContext
      );

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

      const result = await handleGenerateContent(
        { prompt: "Test" },
        mockContext
      );

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

      const result = await handleGenerateContent(
        { prompt: "Test" },
        mockContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("rate limit");
    });

    it("should retry up to MAX_RATE_LIMIT_RETRIES times", async () => {
      let callCount = 0;
      mockContext.client.generateContent = vi.fn().mockImplementation(() => {
        callCount++;
        throw new RateLimitError("Rate limited", 60);
      });
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");
      mockContext.rotator.getNextAccount = vi.fn().mockReturnValue({
        id: "id-1",
        email: "user@gmail.com",
        status: "ready" as const,
        addedAt: new Date(),
      });

      await handleGenerateContent({ prompt: "Test" }, mockContext);

      // Initial call + 3 retries = 4 total calls
      expect(callCount).toBe(4);
    });
  });

  describe("error handling", () => {
    it("should handle API errors", async () => {
      mockContext.client.generateContent = vi
        .fn()
        .mockRejectedValue(new ApiError("Server error"));
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      const result = await handleGenerateContent(
        { prompt: "Test" },
        mockContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("error");
    });

    it("should handle unexpected errors", async () => {
      mockContext.client.generateContent = vi
        .fn()
        .mockRejectedValue(new Error("Network failure"));
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      const result = await handleGenerateContent(
        { prompt: "Test" },
        mockContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text.toLowerCase()).toContain("error");
    });

    it("should format error message properly", async () => {
      mockContext.client.generateContent = vi
        .fn()
        .mockRejectedValue(new ApiError("Invalid prompt format"));
      mockContext.getCurrentEmail = vi.fn().mockReturnValue("user@gmail.com");

      const result = await handleGenerateContent(
        { prompt: "Test" },
        mockContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid prompt format");
    });
  });
});
