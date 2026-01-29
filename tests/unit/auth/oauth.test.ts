// @TASK P1-M3-T1 - OAuth 2.0 Authentication Flow Unit Tests
// @SPEC Google OAuth 2.0 with PKCE (generatePKCE, generateAuthUrl, exchangeCodeForTokens)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generatePKCE,
  generateAuthUrl,
  exchangeCodeForTokens,
  OAuthConfig,
  TokenExchangeParams,
} from "../../../src/auth/oauth.js";

describe("OAuth", () => {
  describe("generatePKCE", () => {
    it("should generate code verifier and challenge", async () => {
      const pkce = generatePKCE();
      expect(pkce.codeVerifier).toBeDefined();
      expect(pkce.codeChallenge).toBeDefined();
      expect(pkce.codeVerifier.length).toBeGreaterThan(40);
    });

    it("should generate base64url encoded code challenge", async () => {
      const pkce = generatePKCE();
      // Base64url uses only these characters: A-Z, a-z, 0-9, -, _
      expect(pkce.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("should generate unique values on each call", async () => {
      const pkce1 = generatePKCE();
      const pkce2 = generatePKCE();
      expect(pkce1.codeVerifier).not.toBe(pkce2.codeVerifier);
      expect(pkce1.codeChallenge).not.toBe(pkce2.codeChallenge);
    });
  });

  describe("generateAuthUrl", () => {
    it("should generate valid authorization URL", () => {
      const config: OAuthConfig = {
        clientId: "test-client-id",
        redirectUri: "http://localhost:51121",
        codeChallenge: "test-challenge",
        state: "test-state",
      };

      const url = generateAuthUrl(config);
      expect(url).toContain("accounts.google.com/o/oauth2/v2/auth");
      expect(url).toContain("client_id=test-client-id");
      expect(url).toContain("redirect_uri=http");
      expect(url).toContain("code_challenge=test-challenge");
      expect(url).toContain("state=test-state");
      expect(url).toContain("scope=");
    });

    it("should include required OAuth parameters", () => {
      const config: OAuthConfig = {
        clientId: "test-client-id",
        redirectUri: "http://localhost:51121",
        codeChallenge: "test-challenge",
        state: "test-state",
      };

      const url = generateAuthUrl(config);
      expect(url).toContain("response_type=code");
      expect(url).toContain("access_type=offline");
      expect(url).toContain("code_challenge_method=S256");
      expect(url).toContain("prompt=consent");
    });

    it("should include Gemini API scope", () => {
      const config: OAuthConfig = {
        clientId: "test-client-id",
        redirectUri: "http://localhost:51121",
        codeChallenge: "test-challenge",
        state: "test-state",
      };

      const url = generateAuthUrl(config);
      expect(url).toContain(
        encodeURIComponent("https://www.googleapis.com/auth/generative-language.tuning")
      );
    });
  });

  describe("exchangeCodeForTokens", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      vi.resetAllMocks();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("should exchange auth code for tokens", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "test-access-token",
            refresh_token: "test-refresh-token",
            expires_in: 3600,
          }),
      });

      const params: TokenExchangeParams = {
        code: "test-code",
        codeVerifier: "test-verifier",
        clientId: "test-client-id",
        redirectUri: "http://localhost:51121",
      };

      const tokens = await exchangeCodeForTokens(params);

      expect(tokens.accessToken).toBe("test-access-token");
      expect(tokens.refreshToken).toBe("test-refresh-token");
      expect(tokens.expiresIn).toBe(3600);
    });

    it("should call Google token endpoint with correct parameters", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "test-access-token",
            refresh_token: "test-refresh-token",
            expires_in: 3600,
          }),
      });
      global.fetch = mockFetch;

      const params: TokenExchangeParams = {
        code: "test-code",
        codeVerifier: "test-verifier",
        clientId: "test-client-id",
        redirectUri: "http://localhost:51121",
      };

      await exchangeCodeForTokens(params);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://oauth2.googleapis.com/token");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

      const body = new URLSearchParams(options.body);
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("test-code");
      expect(body.get("code_verifier")).toBe("test-verifier");
      expect(body.get("client_id")).toBe("test-client-id");
      expect(body.get("redirect_uri")).toBe("http://localhost:51121");
    });

    it("should throw error on failed token exchange", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: "invalid_grant",
            error_description: "Code has already been used.",
          }),
      });

      const params: TokenExchangeParams = {
        code: "used-code",
        codeVerifier: "test-verifier",
        clientId: "test-client-id",
        redirectUri: "http://localhost:51121",
      };

      await expect(exchangeCodeForTokens(params)).rejects.toThrow();
    });
  });
});
