// @TASK P1-M1-T2 - Logger 모듈 구현
// @SPEC docs/planning/02-trd.md#logging

/**
 * 로그 레벨 타입 정의
 * 우선순위: error > warn > info > debug
 */
export type LogLevel = "error" | "warn" | "info" | "debug";

/**
 * 로그 레벨 우선순위 매핑
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/**
 * 현재 로그 레벨 (기본값: info)
 */
let currentLogLevel: LogLevel = "info";

/**
 * 로그 레벨 설정
 * @param level - 설정할 로그 레벨
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

/**
 * 현재 로그 레벨 조회
 * @returns 현재 로그 레벨
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

/**
 * 로그 메시지 출력 여부 확인
 * @param level - 체크할 로그 레벨
 * @returns 출력 가능 여부
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[currentLogLevel];
}

/**
 * 로그 출력 함수 (JSON 포맷으로 stderr에 출력)
 * stdout은 MCP 프로토콜용으로 예약되어 있음
 * @param level - 로그 레벨
 * @param message - 로그 메시지
 * @param data - 추가 데이터 (선택)
 */
function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) {
    return;
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };

  process.stderr.write(JSON.stringify(logEntry) + "\n");
}

/**
 * Logger 객체
 * - error: 항상 출력
 * - warn: warn 이상 레벨에서 출력
 * - info: info 이상 레벨에서 출력
 * - debug: debug 레벨에서만 출력
 */
export const logger = {
  /**
   * 에러 로그 출력 (항상 출력)
   */
  error(message: string, data?: Record<string, unknown>): void {
    log("error", message, data);
  },

  /**
   * 경고 로그 출력 (warn 이상에서 출력)
   */
  warn(message: string, data?: Record<string, unknown>): void {
    log("warn", message, data);
  },

  /**
   * 정보 로그 출력 (info 이상에서 출력)
   */
  info(message: string, data?: Record<string, unknown>): void {
    log("info", message, data);
  },

  /**
   * 디버그 로그 출력 (debug 레벨에서만 출력)
   */
  debug(message: string, data?: Record<string, unknown>): void {
    log("debug", message, data);
  },
};
