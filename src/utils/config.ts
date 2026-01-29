// @TASK P1-M1-T1 - Config 모듈 구현
// @SPEC docs/planning/02-trd.md#config

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 설정 인터페이스
 */
export interface Config {
  logLevel: string;
  oauthPort: number;
}

/**
 * 플랫폼별 config 디렉토리 경로 반환
 * - macOS/Linux: ~/.config/gemini-oauth-mcp/
 * - Windows: %APPDATA%\gemini-oauth-mcp\
 */
export function getConfigPath(): string {
  const platform = process.platform;

  if (platform === "win32") {
    // Windows: %APPDATA%\gemini-oauth-mcp\
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "gemini-oauth-mcp");
  }

  // macOS/Linux: ~/.config/gemini-oauth-mcp/
  const configDir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configDir, "gemini-oauth-mcp");
}

/**
 * 환경 변수 + 기본값으로 설정 반환
 */
export function getConfig(): Config {
  const logLevel = process.env.LOG_LEVEL ?? "info";
  const oauthPort = parseInt(process.env.OAUTH_PORT ?? "51121", 10);

  return {
    logLevel,
    oauthPort,
  };
}
