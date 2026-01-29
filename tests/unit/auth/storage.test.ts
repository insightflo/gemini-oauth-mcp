// @TASK P1-M2-T1 - Account Storage Unit Tests
// @SPEC accounts.json 파일 저장소 TDD 테스트

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AccountStorage } from "../../../src/auth/storage.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

describe("AccountStorage", () => {
  let storage: AccountStorage;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `gemini-oauth-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new AccountStorage(testDir);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("load", () => {
    it("should return empty storage if file does not exist", async () => {
      const data = await storage.load();
      expect(data.accounts).toEqual([]);
      expect(data.version).toBe("1.0.0");
    });

    it("should load existing data", async () => {
      const testData = {
        version: "1.0.0",
        activeAccountId: null,
        accounts: [],
        updatedAt: Date.now(),
      };
      await fs.writeFile(
        path.join(testDir, "accounts.json"),
        JSON.stringify(testData)
      );

      const data = await storage.load();
      expect(data.version).toBe("1.0.0");
    });
  });

  describe("save", () => {
    it("should save data to file", async () => {
      const testData = {
        version: "1.0.0",
        activeAccountId: null,
        accounts: [],
        updatedAt: Date.now(),
      };

      await storage.save(testData);

      const content = await fs.readFile(
        path.join(testDir, "accounts.json"),
        "utf-8"
      );
      expect(JSON.parse(content)).toEqual(testData);
    });

    it("should create backup before save", async () => {
      const initialData = {
        version: "1.0.0",
        activeAccountId: null,
        accounts: [],
        updatedAt: Date.now(),
      };
      await storage.save(initialData);

      const newData = { ...initialData, updatedAt: Date.now() + 1000 };
      await storage.save(newData);

      const backup = await fs.readFile(
        path.join(testDir, "accounts.json.backup"),
        "utf-8"
      );
      expect(JSON.parse(backup)).toEqual(initialData);
    });

    it("should set file permission to 600 (owner only)", async () => {
      const testData = {
        version: "1.0.0",
        activeAccountId: null,
        accounts: [],
        updatedAt: Date.now(),
      };

      await storage.save(testData);

      const stats = await fs.stat(path.join(testDir, "accounts.json"));
      // 0o600 = 384 in decimal, check only permission bits (last 9 bits)
      const permissions = stats.mode & 0o777;
      expect(permissions).toBe(0o600);
    });
  });

  describe("validation", () => {
    it("should reject invalid data on load", async () => {
      const invalidData = {
        version: "1.0.0",
        activeAccountId: null,
        accounts: [{ invalid: "account" }], // Missing required fields
        updatedAt: Date.now(),
      };
      await fs.writeFile(
        path.join(testDir, "accounts.json"),
        JSON.stringify(invalidData)
      );

      await expect(storage.load()).rejects.toThrow();
    });

    it("should reject invalid data on save", async () => {
      const invalidData = {
        version: "1.0.0",
        activeAccountId: null,
        accounts: [{ invalid: "account" }], // Missing required fields
        updatedAt: Date.now(),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(storage.save(invalidData as any)).rejects.toThrow();
    });
  });
});
