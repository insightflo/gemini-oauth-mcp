// @TASK P1-M3-T1 - OAuth 2.0 Authentication Flow
// @SPEC Google OAuth 2.0 with PKCE (code_verifier, code_challenge, token exchange)

import * as crypto from "crypto";

// OAuth 상수
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GEMINI_SCOPE = "https://www.googleapis.com/auth/generative-language.tuning https://www.googleapis.com/auth/userinfo.email";
export const DEFAULT_REDIRECT_URI = "http://localhost:51121";

// Types
export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

export interface OAuthConfig {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}

export interface TokenExchangeParams {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * PKCE code_verifier와 code_challenge 생성
 *
 * RFC 7636 PKCE 스펙:
 * - code_verifier: 43-128자의 unreserved URI characters
 * - code_challenge: SHA256(code_verifier)의 base64url 인코딩
 */
export function generatePKCE(): PKCEPair {
  // 32 bytes = 43자 base64url 인코딩 (padding 제외)
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));

  // SHA256 해시 후 base64url 인코딩
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  const codeChallenge = base64UrlEncode(hash);

  return {
    codeVerifier,
    codeChallenge,
  };
}

/**
 * Google OAuth 인증 URL 생성
 *
 * Required parameters:
 * - response_type: code (Authorization Code Flow)
 * - access_type: offline (refresh token 발급 필요)
 * - prompt: consent (항상 동의 화면 표시 = refresh token 보장)
 * - code_challenge_method: S256 (SHA256 PKCE)
 */
export function generateAuthUrl(config: OAuthConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GEMINI_SCOPE,
    access_type: "offline",
    prompt: "consent",
    code_challenge: config.codeChallenge,
    code_challenge_method: "S256",
    state: config.state,
  });

  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Authorization code를 access token과 refresh token으로 교환
 *
 * Google Token Endpoint: POST https://oauth2.googleapis.com/token
 * Content-Type: application/x-www-form-urlencoded
 */
export async function exchangeCodeForTokens(
  params: TokenExchangeParams
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
  });

  // Add client_secret if provided
  if (params.clientSecret) {
    body.set("client_secret", params.clientSecret);
  }

  // Debug logging
  console.error("[DEBUG] Token exchange request:", {
    endpoint: GOOGLE_TOKEN_ENDPOINT,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_length: params.code.length,
    code_verifier_length: params.codeVerifier.length,
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorData = (await response.json()) as {
      error?: string;
      error_description?: string;
    };
    console.error("[DEBUG] Token exchange error:", errorData);
    throw new OAuthError(
      `Token exchange failed: ${errorData.error_description ?? errorData.error ?? "Unknown error"}`,
      errorData.error ?? "unknown"
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Base64url 인코딩 (RFC 4648)
 * - Standard base64에서 +를 -, /를 _로 변경
 * - Padding(=) 제거
 */
function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * OAuth 관련 에러
 */
export class OAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "OAuthError";
  }
}
