// @TASK P1-M1-T1 - Config 모듈 구현
// @SPEC docs/planning/02-trd.md#config

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

/**
 * Default model constant
 */
export const FALLBACK_DEFAULT_MODEL = "gemini-2.5-flash";

/**
 * Available models list
 *
 * Gemini 3.0 models require Antigravity auth (mode="antigravity")
 * Gemini 2.x and 1.x models work with standard auth (default)
 */
export const AVAILABLE_MODELS = [
  "gemini-3.0-flash",
  "gemini-3.0-pro",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
] as const;

/**
 * 설정 인터페이스
 */
export interface Config {
  logLevel: string;
  oauthPort: number;
  defaultModel: string;
}

/**
 * 저장 가능한 사용자 설정
 */
export interface UserConfig {
  defaultModel?: string;
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
 * 사용자 설정 파일 경로
 */
function getUserConfigPath(): string {
  return join(getConfigPath(), "config.json");
}

/**
 * 사용자 설정 파일에서 설정 로드
 */
export function loadUserConfig(): UserConfig {
  const configPath = getUserConfigPath();

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content) as UserConfig;
  } catch {
    return {};
  }
}

/**
 * 사용자 설정 파일에 설정 저장
 */
export function saveUserConfig(config: UserConfig): void {
  const configDir = getConfigPath();
  const configPath = getUserConfigPath();

  // 디렉토리가 없으면 생성
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // 기존 설정과 병합
  const existing = loadUserConfig();
  const merged = { ...existing, ...config };

  writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf-8");
}

/**
 * 기본 모델 가져오기 (우선순위: 사용자 설정 > 환경 변수 > 기본값)
 */
export function getDefaultModel(): string {
  // 1. 사용자 설정 파일
  const userConfig = loadUserConfig();
  if (userConfig.defaultModel) {
    return userConfig.defaultModel;
  }

  // 2. 환경 변수
  if (process.env.GEMINI_DEFAULT_MODEL) {
    return process.env.GEMINI_DEFAULT_MODEL;
  }

  // 3. 기본값
  return FALLBACK_DEFAULT_MODEL;
}

/**
 * 기본 모델 설정하기
 */
export function setDefaultModel(model: string): void {
  saveUserConfig({ defaultModel: model });
}

/**
 * 환경 변수 + 기본값으로 설정 반환
 */
export function getConfig(): Config {
  const logLevel = process.env.LOG_LEVEL ?? "info";
  const oauthPort = parseInt(process.env.OAUTH_PORT ?? "51121", 10);
  const defaultModel = getDefaultModel();

  return {
    logLevel,
    oauthPort,
    defaultModel,
  };
}
