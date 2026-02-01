// Antigravity OAuth Implementation
// Based on opencode-antigravity-auth but with ESM compatibility

import * as crypto from "crypto";

// Default Antigravity OAuth credentials (from opencode-antigravity-auth)
// Users can override these via environment variables for custom OAuth apps
const DEFAULT_ANTIGRAVITY_CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const DEFAULT_ANTIGRAVITY_CLIENT_SECRET = "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";
const DEFAULT_ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";

// Antigravity OAuth constants - configurable via environment variables
const ANTIGRAVITY_CLIENT_ID = process.env.GEMINI_CLIENT_ID ?? DEFAULT_ANTIGRAVITY_CLIENT_ID;
const ANTIGRAVITY_CLIENT_SECRET =
  process.env.GEMINI_CLIENT_SECRET ?? DEFAULT_ANTIGRAVITY_CLIENT_SECRET;
const ANTIGRAVITY_REDIRECT_URI =
  process.env.GEMINI_REDIRECT_URI ?? DEFAULT_ANTIGRAVITY_REDIRECT_URI;
const ANTIGRAVITY_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/cloud-platform",
];

// Types
export interface AntigravityAuthorization {
  url: string;
  verifier: string;
  projectId: string;
}

export interface AntigravityTokenExchangeSuccess {
  type: "success";
  refresh: string;
  access: string;
  expires: number;
  email?: string;
  projectId: string;
}

export interface AntigravityTokenExchangeFailure {
  type: "failed";
  error: string;
}

export type AntigravityTokenExchangeResult =
  | AntigravityTokenExchangeSuccess
  | AntigravityTokenExchangeFailure;

/**
 * Generate PKCE challenge and verifier
 */
function generatePKCE(): { verifier: string; challenge: string } {
  // Generate 32 bytes of random data for verifier
  const verifier = crypto.randomBytes(32).toString("base64url");

  // SHA256 hash of verifier, base64url encoded
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  return { verifier, challenge };
}

/**
 * Encode state payload to base64url
 */
function encodeState(payload: { verifier: string; projectId: string }): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Decode state from base64url
 */
function decodeState(state: string): { verifier: string; projectId: string } {
  // Handle both base64url and standard base64
  const normalized = state.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const json = Buffer.from(padded, "base64").toString("utf8");
  const parsed = JSON.parse(json);

  if (typeof parsed.verifier !== "string") {
    throw new Error("Missing PKCE verifier in state");
  }

  return {
    verifier: parsed.verifier,
    projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
  };
}

/**
 * Build the Antigravity OAuth authorization URL
 */
export async function authorizeAntigravity(projectId = ""): Promise<AntigravityAuthorization> {
  const pkce = generatePKCE();

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", ANTIGRAVITY_REDIRECT_URI);
  url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "));
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", encodeState({ verifier: pkce.verifier, projectId }));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  return {
    url: url.toString(),
    verifier: pkce.verifier,
    projectId,
  };
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeAntigravity(
  code: string,
  state: string
): Promise<AntigravityTokenExchangeResult> {
  try {
    const { verifier, projectId } = decodeState(state);
    const startTime = Date.now();

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: new URLSearchParams({
        client_id: ANTIGRAVITY_CLIENT_ID,
        client_secret: ANTIGRAVITY_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: ANTIGRAVITY_REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return { type: "failed", error: errorText };
    }

    const tokenPayload = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    // Get user info
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
      },
    });

    const userInfo = userInfoResponse.ok
      ? ((await userInfoResponse.json()) as { email?: string })
      : {};

    const refreshToken = tokenPayload.refresh_token;
    if (!refreshToken) {
      return { type: "failed", error: "Missing refresh token in response" };
    }

    // Store refresh token with project ID
    const storedRefresh = `${refreshToken}|${projectId || ""}`;

    return {
      type: "success",
      refresh: storedRefresh,
      access: tokenPayload.access_token,
      expires: startTime + tokenPayload.expires_in * 1000,
      email: userInfo.email,
      projectId: projectId || "",
    };
  } catch (error) {
    return {
      type: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
