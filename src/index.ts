// @TASK P0-T0.2 - Gemini OAuth MCP Server Entry Point
// @SPEC docs/planning/01-prd.md#overview

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

/**
 * Main entry point for the Gemini OAuth MCP Server.
 *
 * This server provides OAuth-based access to Gemini API through
 * the Model Context Protocol (MCP).
 *
 * Transport: stdio (standard input/output)
 * - Reads JSON-RPC messages from stdin
 * - Writes JSON-RPC responses to stdout
 * - Logs errors to stderr
 */
async function main(): Promise<void> {
  try {
    // Create MCP server instance
    const server = createServer();

    // Create stdio transport for communication
    const transport = new StdioServerTransport();

    // Connect server to transport and start listening
    await server.connect(transport);

    // Log startup message to stderr (stdout is reserved for MCP protocol)
    console.error("Gemini OAuth MCP Server started");
  } catch (error) {
    console.error("Failed to start MCP server:", error);
    process.exit(1);
  }
}

// Run the server
void main();
