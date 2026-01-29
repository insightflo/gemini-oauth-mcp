// @TASK P3-T3-T1 - Quota Status MCP Tool Implementation
// @SPEC 계정별 할당량 조회, 프로그레스 바 출력, 리셋 시간 표시, Total Available 계산

import { z } from "zod";
import { QuotaTracker, QuotaInfo } from "../accounts/quota.js";

/**
 * MCP Tool Response type
 */
export interface ToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

/**
 * Dependencies for handleQuotaStatus
 */
export interface QuotaStatusToolDeps {
  quotaTracker: QuotaTracker;
}

/**
 * Quota Status Tool Definition
 */
export const quotaStatusTool = {
  name: "quota_status" as const,
  description: "Show quota status for all accounts with visual progress bars",
  inputSchema: z.object({}),
};

/**
 * Create a visual progress bar
 * @param percentage - Usage percentage (0-100+)
 * @param width - Bar width in characters (default: 10)
 * @returns Progress bar string (e.g., "████████░░")
 */
export function createProgressBar(percentage: number, width: number = 10): string {
  // Clamp percentage to 0-100 range
  const clampedPercentage = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((clampedPercentage / 100) * width);
  const empty = width - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

/**
 * Truncate string with ellipsis if too long
 */
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Format time duration from now to target date
 */
function formatTimeDuration(targetDate: Date, now: Date): string {
  const diffMs = targetDate.getTime() - now.getTime();
  if (diffMs <= 0) {
    return "now";
  }

  const diffMinutes = Math.round(diffMs / (1000 * 60));
  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""}`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""}`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays !== 1 ? "s" : ""}`;
}

/**
 * Pad string to specified width
 */
function padRight(str: string, width: number): string {
  return str.padEnd(width);
}

/**
 * Format quota status output
 * @param quotas - Array of QuotaInfo
 * @param totalAvailable - Total available requests
 * @returns Formatted string output
 */
export function formatQuotaStatus(quotas: QuotaInfo[], totalAvailable: number): string {
  const lines: string[] = [];
  const separator = "\u2550".repeat(55); // ═
  const thinSeparator = "\u2500".repeat(17); // ─

  // Header
  lines.push("Quota Status");
  lines.push(separator);
  lines.push("");

  if (quotas.length === 0) {
    lines.push("  No accounts registered");
    lines.push("");
  } else {
    // Table header
    lines.push(`  ${padRight("Account", 20)}  ${padRight("Requests", 11)}  Status`);
    lines.push(`  ${thinSeparator}    ${thinSeparator.slice(0, 11)}   ${thinSeparator.slice(0, 14)}`);

    // Account rows
    for (const quota of quotas) {
      const email = truncateString(quota.email, 20);
      const requests = `${quota.used}/${quota.limit}`;
      const progressBar = createProgressBar(quota.percentage);
      const percentDisplay = quota.isLimited
        ? "Limited"
        : `${Math.round(quota.percentage)}%`;

      lines.push(
        `  ${padRight(email, 20)}  ${padRight(requests, 11)}  ${progressBar} ${percentDisplay}`
      );
    }

    lines.push("");
  }

  lines.push(separator);
  lines.push("");

  // Summary section
  lines.push(`  Total Available:     ${totalAvailable} requests`);

  // Rate limited accounts count
  const limitedAccounts = quotas.filter((q) => q.isLimited);
  if (limitedAccounts.length > 0) {
    const accountWord = limitedAccounts.length === 1 ? "account" : "accounts";
    const limitedEmails = limitedAccounts.map((q) => q.email).join(", ");
    lines.push(
      `  Rate Limited:        ${limitedAccounts.length} ${accountWord} (${truncateString(limitedEmails, 20)})`
    );
  }

  // Next reset time (earliest reset time among limited accounts)
  const now = new Date();
  const resetTimes = quotas
    .filter((q) => q.resetAt !== null)
    .map((q) => q.resetAt!)
    .filter((d) => d.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());

  if (resetTimes.length > 0) {
    const nextReset = resetTimes[0]!;
    lines.push(`  Next Reset:          ${formatTimeDuration(nextReset, now)}`);
  }

  lines.push("");
  lines.push(separator);

  return lines.join("\n");
}

/**
 * Handle quota_status tool call
 * @param deps - Tool dependencies (quotaTracker)
 * @returns MCP Tool response with formatted quota status
 */
export function handleQuotaStatus(deps: QuotaStatusToolDeps): ToolResponse {
  const quotas = deps.quotaTracker.getAllQuotas();
  const totalAvailable = deps.quotaTracker.getTotalAvailable();

  const formattedOutput = formatQuotaStatus(quotas, totalAvailable);

  return {
    content: [
      {
        type: "text" as const,
        text: formattedOutput,
      },
    ],
  };
}
