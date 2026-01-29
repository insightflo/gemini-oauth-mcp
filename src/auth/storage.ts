// @TASK P1-M2-T1 - Account Storage Implementation
// @SPEC accounts.json 파일 저장소 (Zod 검증, 자동 백업, 파일 권한 600)

import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { constants } from "fs";

// Zod Schemas
export const QuotaStatusSchema = z.object({
  requestsRemaining: z.number().nullable(),
  tokensRemaining: z.number().nullable(),
  resetAt: z.number().nullable(),
  updatedAt: z.number(),
});

export const RateLimitStatusSchema = z.object({
  isLimited: z.boolean(),
  limitedUntil: z.number().nullable(),
  consecutiveHits: z.number(),
});

export const AccountSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  refreshToken: z.string(),
  accessToken: z.string().nullable(),
  accessTokenExpiry: z.number().nullable(),
  quota: QuotaStatusSchema,
  rateLimit: RateLimitStatusSchema,
  createdAt: z.number(),
  lastUsedAt: z.number(),
});

export const AccountsStorageSchema = z.object({
  version: z.string(),
  activeAccountId: z.string().nullable(),
  accounts: z.array(AccountSchema),
  updatedAt: z.number(),
});

// Type exports
export type QuotaStatus = z.infer<typeof QuotaStatusSchema>;
export type RateLimitStatus = z.infer<typeof RateLimitStatusSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type AccountsStorage = z.infer<typeof AccountsStorageSchema>;

const ACCOUNTS_FILENAME = "accounts.json";
const BACKUP_SUFFIX = ".backup";
const FILE_PERMISSION = 0o600; // rw------- (owner only)

/**
 * AccountStorage - accounts.json 파일 저장소 관리
 *
 * 기능:
 * - load(): 파일 로드 (없으면 기본값 반환)
 * - save(): 파일 저장 (백업 생성, 권한 설정)
 * - Zod 스키마 검증
 */
export class AccountStorage {
  private readonly filePath: string;
  private readonly backupPath: string;

  constructor(configPath?: string) {
    const baseDir = configPath ?? this.getDefaultConfigPath();
    this.filePath = path.join(baseDir, ACCOUNTS_FILENAME);
    this.backupPath = path.join(baseDir, `${ACCOUNTS_FILENAME}${BACKUP_SUFFIX}`);
  }

  /**
   * 계정 데이터 로드
   * 파일이 없으면 기본 빈 저장소 반환
   */
  async load(): Promise<AccountsStorage> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      const data: unknown = JSON.parse(content);
      return AccountsStorageSchema.parse(data);
    } catch (error) {
      if (this.isFileNotFoundError(error)) {
        return this.getDefaultStorage();
      }
      throw error;
    }
  }

  /**
   * 계정 데이터 저장
   * 기존 파일이 있으면 백업 생성
   * 파일 권한 600 설정 (민감한 토큰 보호)
   */
  async save(data: AccountsStorage): Promise<void> {
    // Zod 검증
    const validated = AccountsStorageSchema.parse(data);

    // 기존 파일이 있으면 백업 생성
    await this.createBackupIfExists();

    // 디렉토리 생성 (없으면)
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    // 파일 저장
    const content = JSON.stringify(validated, null, 2);
    await fs.writeFile(this.filePath, content, { encoding: "utf-8", mode: FILE_PERMISSION });
  }

  /**
   * 기존 파일이 있으면 백업 생성
   */
  private async createBackupIfExists(): Promise<void> {
    try {
      await fs.access(this.filePath, constants.F_OK);
      await fs.copyFile(this.filePath, this.backupPath);
    } catch {
      // 파일이 없으면 백업 생성 안 함
    }
  }

  /**
   * 기본 설정 경로 (OS별)
   */
  private getDefaultConfigPath(): string {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return path.join(home, ".config", "gemini-oauth-mcp");
  }

  /**
   * 기본 빈 저장소
   */
  private getDefaultStorage(): AccountsStorage {
    return {
      version: "1.0.0",
      activeAccountId: null,
      accounts: [],
      updatedAt: Date.now(),
    };
  }

  /**
   * 파일 없음 에러 확인
   */
  private isFileNotFoundError(error: unknown): boolean {
    return (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    );
  }
}
