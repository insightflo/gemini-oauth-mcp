// @TASK P1-M1-T2 - Logger 모듈 테스트
// @SPEC docs/planning/02-trd.md#logging

import { describe, it, expect, vi, beforeEach } from "vitest";
import { logger, LogLevel, setLogLevel } from "../../../src/utils/logger.js";

describe("Logger", () => {
  beforeEach(() => {
    setLogLevel("debug");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  describe("log levels", () => {
    it("should log error messages", () => {
      logger.error("test error");
      expect(process.stderr.write).toHaveBeenCalled();
    });

    it("should log warn messages", () => {
      logger.warn("test warn");
      expect(process.stderr.write).toHaveBeenCalled();
    });

    it("should log info messages", () => {
      logger.info("test info");
      expect(process.stderr.write).toHaveBeenCalled();
    });

    it("should log debug messages when level is debug", () => {
      logger.debug("test debug");
      expect(process.stderr.write).toHaveBeenCalled();
    });

    it("should not log debug messages when level is info", () => {
      setLogLevel("info");
      logger.debug("test debug");
      expect(process.stderr.write).not.toHaveBeenCalled();
    });
  });

  describe("output format", () => {
    it("should output JSON format", () => {
      logger.info("test message", { key: "value" });
      const call = (process.stderr.write as any).mock.calls[0][0];
      const parsed = JSON.parse(call);
      expect(parsed.level).toBe("info");
      expect(parsed.message).toBe("test message");
      expect(parsed.key).toBe("value");
    });
  });
});
