// @TASK P1-M1-T1 - Config 모듈 단위 테스트
// @SPEC docs/planning/02-trd.md#config

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig, getConfigPath } from "../../../src/utils/config.js";

describe("Config", () => {
  describe("getConfigPath", () => {
    it("should return platform-specific config path", () => {
      const path = getConfigPath();
      expect(path).toContain("gemini-oauth-mcp");
    });
  });

  describe("getConfig", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Clear relevant env vars before each test
      delete process.env.LOG_LEVEL;
      delete process.env.OAUTH_PORT;
    });

    afterEach(() => {
      // Restore original env
      process.env = { ...originalEnv };
    });

    it("should return default values", () => {
      const config = getConfig();
      expect(config.logLevel).toBe("info");
      expect(config.oauthPort).toBe(51121);
    });

    it("should respect environment variables", () => {
      process.env.LOG_LEVEL = "debug";
      process.env.OAUTH_PORT = "3000";

      const config = getConfig();
      expect(config.logLevel).toBe("debug");
      expect(config.oauthPort).toBe(3000);
    });
  });
});
