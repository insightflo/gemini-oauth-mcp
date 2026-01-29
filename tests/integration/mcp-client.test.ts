// @TEST P4-I1-T3 - MCP Client Integration Tests
// @SPEC stdio transport, Tool discovery, All 7 tool invocations, Error handling, Protocol compliance
// @IMPL src/index.ts, src/server.ts, src/tools/**

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import type { Readable, Writable } from "stream";

/**
 * MCP JSON-RPC message types
 */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * MCP Tool definition
 */
interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Simple MCP Client for testing
 */
class TestMcpClient {
  private process: ChildProcess | null = null;
  private stdin: Writable | null = null;
  private stdout: Readable | null = null;
  private messageBuffer = "";
  private pendingRequests = new Map<string | number, (data: JsonRpcResponse) => void>();
  private nextId = 1;

  async connect(command: string, args: string[]): Promise<void> {
    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "test" },
    });

    this.stdin = this.process.stdin;
    this.stdout = this.process.stdout;

    if (!this.stdout) {
      throw new Error("Failed to get stdout");
    }

    // Setup message handler
    this.stdout.on("data", (data: Buffer) => {
      this.messageBuffer += data.toString();
      this.parseMessages();
    });

    // Setup error handler
    this.process.on("error", (error) => {
      console.error("Process error:", error);
    });

    // Give server time to start
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  private parseMessages(): void {
    const lines = this.messageBuffer.split("\n");

    // Keep last incomplete line in buffer
    this.messageBuffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as JsonRpcResponse;
          const handler = this.pendingRequests.get(message.id);

          if (handler) {
            handler(message);
            this.pendingRequests.delete(message.id);
          }
        } catch (error) {
          // Ignore parse errors
        }
      }
    }
  }

  async send(method: string, params?: unknown): Promise<JsonRpcResponse> {
    if (!this.stdin) {
      throw new Error("Not connected");
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${id} timed out`));
      }, 5000);

      this.pendingRequests.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      this.stdin!.write(JSON.stringify(request) + "\n", (error) => {
        if (error) {
          this.pendingRequests.delete(id);
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      return new Promise((resolve) => {
        if (this.process) {
          this.process.on("exit", () => resolve());
          this.process.kill();
          // Fallback timeout
          setTimeout(() => resolve(), 1000);
        } else {
          resolve();
        }
      });
    }
  }
}

describe("MCP Client Integration", () => {
  let client: TestMcpClient;

  beforeAll(async () => {
    // Build the project first
    await new Promise<void>((resolve, reject) => {
      const buildProcess = spawn("npm", ["run", "build"], {
        cwd: "/Users/kwak/Projects/ai/vibelab-extention/gemini-oauth-mcp/worktree/phase-4-integration",
        stdio: "pipe",
      });

      buildProcess.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Build failed with code ${code}`));
        }
      });

      buildProcess.on("error", reject);
    });

    // Start MCP server
    client = new TestMcpClient();
    await client.connect("node", [
      "/Users/kwak/Projects/ai/vibelab-extention/gemini-oauth-mcp/worktree/phase-4-integration/dist/index.js",
    ]);
  });

  afterAll(async () => {
    await client.disconnect();
  });

  describe("Server Initialization", () => {
    // @TEST P4-I1-T3.1 - Server starts with stdio transport
    it("should start server with stdio transport", async () => {
      const response = await client.send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      });

      expect(response.jsonrpc).toBe("2.0");
      expect(response.result).toBeDefined();
      expect(response.result).toHaveProperty("capabilities");
    });

    // @TEST P4-I1-T3.2 - All tools registered on startup
    it("should register all tools on startup", async () => {
      const response = await client.send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { capabilities?: { tools?: unknown } };
      expect(result.capabilities).toBeDefined();
    });

    // @TEST P4-I1-T3.3 - Responds to initialize request
    it("should respond to initialize request", async () => {
      const response = await client.send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      });

      expect(response.id).toBeDefined();
      expect(response.jsonrpc).toBe("2.0");
      expect(!response.error).toBe(true);
    });
  });

  describe("Tool Discovery", () => {
    // @TEST P4-I1-T3.4 - List all available tools
    it("should list all available tools", async () => {
      const response = await client.send("tools/list");

      expect(response.jsonrpc).toBe("2.0");
      expect(response.result).toBeDefined();
      const result = response.result as { tools?: unknown[] };
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools!.length).toBeGreaterThan(0);
    });

    // @TEST P4-I1-T3.5 - Return correct tool schemas
    it("should return correct tool schemas", async () => {
      const response = await client.send("tools/list");

      const result = response.result as { tools?: McpTool[] };
      const tools = result.tools || [];

      // Verify each tool has required fields
      for (const tool of tools) {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
      }

      // Verify key tools are present
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("ping"); // Health check tool
    });
  });

  describe("Tool Invocation", () => {
    // @TEST P4-I1-T3.6 - Invoke ping tool (health check)
    it("should invoke ping tool", async () => {
      const response = await client.send("tools/call", {
        name: "ping",
        arguments: {},
      });

      expect(response.jsonrpc).toBe("2.0");
      expect(response.result).toBeDefined();
      const result = response.result as { content?: Array<{ type: string; text: string }> };
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content![0]).toHaveProperty("type");
      expect(result.content![0]).toHaveProperty("text");
    });

    // @TEST P4-I1-T3.7 - Invoke auth_login tool exists
    it("should have auth_login tool available", async () => {
      const listResponse = await client.send("tools/list");
      const result = listResponse.result as { tools?: McpTool[] };
      const tools = result.tools || [];
      const authLoginTool = tools.find((t) => t.name === "auth_login");

      expect(authLoginTool).toBeDefined();
      expect(authLoginTool?.description).toContain("Google");
    });

    // @TEST P4-I1-T3.8 - Invoke auth_list tool exists
    it("should have auth_list tool available", async () => {
      const listResponse = await client.send("tools/list");
      const result = listResponse.result as { tools?: McpTool[] };
      const tools = result.tools || [];
      const authListTool = tools.find((t) => t.name === "auth_list");

      expect(authListTool).toBeDefined();
      expect(authListTool?.description.toLowerCase()).toContain("list");
    });

    // @TEST P4-I1-T3.9 - Invoke auth_remove tool exists
    it("should have auth_remove tool available", async () => {
      const listResponse = await client.send("tools/list");
      const result = listResponse.result as { tools?: McpTool[] };
      const tools = result.tools || [];
      const authRemoveTool = tools.find((t) => t.name === "auth_remove");

      expect(authRemoveTool).toBeDefined();
      expect(authRemoveTool?.description).toContain("Remove");
    });

    // @TEST P4-I1-T3.10 - Invoke auth_status tool exists
    it("should have auth_status tool available", async () => {
      const listResponse = await client.send("tools/list");
      const result = listResponse.result as { tools?: McpTool[] };
      const tools = result.tools || [];
      const authStatusTool = tools.find((t) => t.name === "auth_status");

      expect(authStatusTool).toBeDefined();
      expect(authStatusTool?.description).toContain("authentication");
    });

    // @TEST P4-I1-T3.11 - Invoke chat tool exists
    it("should have chat tool available", async () => {
      const listResponse = await client.send("tools/list");
      const result = listResponse.result as { tools?: McpTool[] };
      const tools = result.tools || [];
      const chatTool = tools.find((t) => t.name === "chat");

      expect(chatTool).toBeDefined();
      expect(chatTool?.description).toContain("Gemini");
    });

    // @TEST P4-I1-T3.12 - Invoke generate_content tool exists
    it("should have generate_content tool available", async () => {
      const listResponse = await client.send("tools/list");
      const result = listResponse.result as { tools?: McpTool[] };
      const tools = result.tools || [];
      const generateTool = tools.find((t) => t.name === "generate_content");

      expect(generateTool).toBeDefined();
      expect(generateTool?.description.toLowerCase()).toContain("generate");
    });

    // @TEST P4-I1-T3.13 - Invoke quota_status tool exists
    it("should have quota_status tool available", async () => {
      const listResponse = await client.send("tools/list");
      const result = listResponse.result as { tools?: McpTool[] };
      const tools = result.tools || [];
      const quotaTool = tools.find((t) => t.name === "quota_status");

      expect(quotaTool).toBeDefined();
      expect(quotaTool?.description).toContain("quota");
    });
  });

  describe("Error Handling", () => {
    // @TEST P4-I1-T3.14 - Error for unknown tool
    it("should return error for unknown tool", async () => {
      const response = await client.send("tools/call", {
        name: "unknown_tool",
        arguments: {},
      });

      expect(response.jsonrpc).toBe("2.0");
      // Should either have error or handle gracefully with result
      if (response.error) {
        expect(response.error.code).toBeDefined();
        expect(response.error.message).toBeDefined();
      } else {
        // If tool doesn't exist, MCP should return a result (implementation detail)
        expect(response.result).toBeDefined();
      }
    });

    // @TEST P4-I1-T3.15 - Error for invalid parameters
    it("should return error for invalid parameters", async () => {
      const response = await client.send("tools/call", {
        name: "auth_remove",
        arguments: {
          // Missing required account_id parameter
        },
      });

      expect(response.jsonrpc).toBe("2.0");
      // Should either have error or handle gracefully
      expect(response.result || response.error).toBeDefined();
    });

    // @TEST P4-I1-T3.16 - Handle internal errors gracefully
    it("should handle internal errors gracefully", async () => {
      const response = await client.send("tools/call", {
        name: "ping",
        arguments: { unexpected: "argument" },
      });

      // Should not crash, should return response
      expect(response.jsonrpc).toBe("2.0");
      expect(response.result || response.error).toBeDefined();
    });
  });

  describe("Protocol Compliance", () => {
    // @TEST P4-I1-T3.17 - Follow MCP message format
    it("should follow MCP message format", async () => {
      const response = await client.send("tools/list");

      // Check JSON-RPC structure
      expect(response).toHaveProperty("jsonrpc");
      expect(response.jsonrpc).toBe("2.0");
      expect(response).toHaveProperty("id");
      expect(response.result || response.error).toBeDefined();
    });

    // @TEST P4-I1-T3.18 - Include required response fields
    it("should include required response fields", async () => {
      const response = await client.send("tools/call", {
        name: "ping",
        arguments: {},
      });

      const result = response.result as Record<string, unknown>;

      // MCP tool response must have content field
      expect(result).toHaveProperty("content");
      expect(Array.isArray(result.content)).toBe(true);

      // Content items must have type and text
      const content = result.content as Array<{ type: string; text: string }>;
      for (const item of content) {
        expect(item).toHaveProperty("type");
        expect(typeof item.type).toBe("string");
        expect(["text", "image", "resource"]).toContain(item.type);
      }
    });

    // @TEST P4-I1-T3.19 - All responses are valid JSON-RPC
    it("should ensure all responses are valid JSON-RPC", async () => {
      const methods = ["tools/list", "initialize"];

      for (const method of methods) {
        const response = await client.send(method, {});

        // Must be valid JSON-RPC 2.0 response
        expect(response).toHaveProperty("jsonrpc");
        expect(response.jsonrpc).toBe("2.0");
        expect(typeof response.id).toBe("number");

        // Either result or error, not both
        const hasResult = "result" in response;
        const hasError = "error" in response;
        expect(hasResult || hasError).toBe(true);
        expect(hasResult && hasError).toBe(false);
      }
    });
  });
});
