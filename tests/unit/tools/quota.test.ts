// @TASK P3-T3-T1 - Quota Status Tool Unit Tests
// @SPEC quota_status MCP Tool - 계정별 할당량 조회, 프로그레스 바 출력, 리셋 시간 표시

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  createProgressBar,
  formatQuotaStatus,
  handleQuotaStatus,
  QuotaStatusToolDeps,
} from "../../../src/tools/quota";
import { QuotaTracker, QuotaInfo } from "../../../src/accounts/quota";

// Mock QuotaTracker
const createMockQuotaTracker = (): QuotaTracker & {
  _setQuotas: (quotas: QuotaInfo[]) => void;
  _setTotalAvailable: (total: number) => void;
} => {
  let quotas: QuotaInfo[] = [];
  let totalAvailable = 0;

  return {
    updateQuota: vi.fn(),
    getQuota: vi.fn((id: string) => quotas.find((q) => q.accountId === id) ?? null),
    getAllQuotas: vi.fn(() => quotas),
    incrementUsage: vi.fn(),
    resetQuota: vi.fn(),
    getTotalAvailable: vi.fn(() => totalAvailable),
    _setQuotas: (q: QuotaInfo[]) => {
      quotas = q;
    },
    _setTotalAvailable: (total: number) => {
      totalAvailable = total;
    },
  };
};

describe("createProgressBar", () => {
  it("should create empty bar for 0%", () => {
    const bar = createProgressBar(0);
    expect(bar).toBe("░░░░░░░░░░");
  });

  it("should create full bar for 100%", () => {
    const bar = createProgressBar(100);
    expect(bar).toBe("██████████");
  });

  it("should create half bar for 50%", () => {
    const bar = createProgressBar(50);
    expect(bar).toBe("█████░░░░░");
  });

  it("should create 80% filled bar", () => {
    const bar = createProgressBar(80);
    expect(bar).toBe("████████░░");
  });

  it("should handle custom width", () => {
    const bar = createProgressBar(50, 20);
    expect(bar).toBe("██████████░░░░░░░░░░");
  });

  it("should round percentage correctly", () => {
    // 15% should round to 2 filled blocks (out of 10)
    const bar15 = createProgressBar(15);
    expect(bar15).toBe("██░░░░░░░░");

    // 14% should round to 1 filled block
    const bar14 = createProgressBar(14);
    expect(bar14).toBe("█░░░░░░░░░");
  });

  it("should cap at 100% for values over 100", () => {
    const bar = createProgressBar(150);
    expect(bar).toBe("██████████");
  });

  it("should handle negative values as 0%", () => {
    const bar = createProgressBar(-10);
    expect(bar).toBe("░░░░░░░░░░");
  });
});

describe("formatQuotaStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should format empty quota list", () => {
    const output = formatQuotaStatus([], 0);
    expect(output).toContain("Quota Status");
    expect(output).toContain("No accounts registered");
    expect(output).toContain("Total Available:");
    expect(output).toContain("0 requests");
  });

  it("should format single account quota", () => {
    const quotas: QuotaInfo[] = [
      {
        accountId: "acc-1",
        email: "user1@gmail.com",
        used: 800,
        limit: 1000,
        percentage: 80,
        resetAt: null,
        isLimited: false,
      },
    ];

    const output = formatQuotaStatus(quotas, 200);

    expect(output).toContain("Quota Status");
    expect(output).toContain("user1@gmail.com");
    expect(output).toContain("800/1000");
    expect(output).toContain("████████░░");
    expect(output).toContain("80%");
    expect(output).toContain("Total Available:");
    expect(output).toContain("200 requests");
  });

  it("should format multiple accounts", () => {
    const quotas: QuotaInfo[] = [
      {
        accountId: "acc-1",
        email: "user1@gmail.com",
        used: 800,
        limit: 1000,
        percentage: 80,
        resetAt: null,
        isLimited: false,
      },
      {
        accountId: "acc-2",
        email: "user2@gmail.com",
        used: 1000,
        limit: 1000,
        percentage: 100,
        resetAt: new Date("2024-01-15T12:45:00Z"),
        isLimited: true,
      },
      {
        accountId: "acc-3",
        email: "user3@gmail.com",
        used: 0,
        limit: 1000,
        percentage: 0,
        resetAt: null,
        isLimited: false,
      },
    ];

    const output = formatQuotaStatus(quotas, 1200);

    expect(output).toContain("user1@gmail.com");
    expect(output).toContain("user2@gmail.com");
    expect(output).toContain("user3@gmail.com");
    expect(output).toContain("800/1000");
    expect(output).toContain("1000/1000");
    expect(output).toContain("0/1000");
  });

  it("should show rate limited accounts count", () => {
    const quotas: QuotaInfo[] = [
      {
        accountId: "acc-1",
        email: "user1@gmail.com",
        used: 1000,
        limit: 1000,
        percentage: 100,
        resetAt: null,
        isLimited: true,
      },
      {
        accountId: "acc-2",
        email: "user2@gmail.com",
        used: 1000,
        limit: 1000,
        percentage: 100,
        resetAt: null,
        isLimited: true,
      },
    ];

    const output = formatQuotaStatus(quotas, 0);

    expect(output).toContain("Rate Limited:");
    expect(output).toContain("2 account");
  });

  it("should show next reset time", () => {
    const resetAt = new Date("2024-01-15T12:45:00Z"); // 45 minutes from now
    const quotas: QuotaInfo[] = [
      {
        accountId: "acc-1",
        email: "user1@gmail.com",
        used: 1000,
        limit: 1000,
        percentage: 100,
        resetAt,
        isLimited: true,
      },
    ];

    const output = formatQuotaStatus(quotas, 0);

    expect(output).toContain("Next Reset:");
    expect(output).toContain("45 minutes");
  });

  it("should indicate Limited status for maxed out accounts", () => {
    const quotas: QuotaInfo[] = [
      {
        accountId: "acc-1",
        email: "user1@gmail.com",
        used: 1000,
        limit: 1000,
        percentage: 100,
        resetAt: null,
        isLimited: true,
      },
    ];

    const output = formatQuotaStatus(quotas, 0);

    expect(output).toContain("Limited");
  });

  it("should truncate long email addresses", () => {
    const quotas: QuotaInfo[] = [
      {
        accountId: "acc-1",
        email: "verylongemailaddress@example.com",
        used: 500,
        limit: 1000,
        percentage: 50,
        resetAt: null,
        isLimited: false,
      },
    ];

    const output = formatQuotaStatus(quotas, 500);

    // Email should be truncated if too long (max 20 chars including "...")
    expect(output).toContain("verylongemailaddr...");
  });
});

describe("handleQuotaStatus", () => {
  let mockQuotaTracker: ReturnType<typeof createMockQuotaTracker>;
  let deps: QuotaStatusToolDeps;

  beforeEach(() => {
    mockQuotaTracker = createMockQuotaTracker();
    deps = {
      quotaTracker: mockQuotaTracker,
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return formatted quota status", async () => {
    mockQuotaTracker._setQuotas([
      {
        accountId: "acc-1",
        email: "user@example.com",
        used: 500,
        limit: 1000,
        percentage: 50,
        resetAt: null,
        isLimited: false,
      },
    ]);
    mockQuotaTracker._setTotalAvailable(500);

    const result = await handleQuotaStatus(deps);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Quota Status");
    expect(result.content[0].text).toContain("user@example.com");
    expect(result.content[0].text).toContain("500/1000");
  });

  it("should call getAllQuotas from tracker", async () => {
    mockQuotaTracker._setQuotas([]);
    mockQuotaTracker._setTotalAvailable(0);

    await handleQuotaStatus(deps);

    expect(mockQuotaTracker.getAllQuotas).toHaveBeenCalled();
    expect(mockQuotaTracker.getTotalAvailable).toHaveBeenCalled();
  });

  it("should handle empty quota list", async () => {
    mockQuotaTracker._setQuotas([]);
    mockQuotaTracker._setTotalAvailable(0);

    const result = await handleQuotaStatus(deps);

    expect(result.content[0].text).toContain("No accounts registered");
  });

  it("should not throw errors for any valid input", async () => {
    // Test with various configurations
    const configs = [
      { quotas: [], total: 0 },
      {
        quotas: [
          {
            accountId: "1",
            email: "a@b.com",
            used: 0,
            limit: 0,
            percentage: 100,
            resetAt: null,
            isLimited: true,
          },
        ],
        total: 0,
      },
      {
        quotas: [
          {
            accountId: "1",
            email: "a@b.com",
            used: 999999,
            limit: 1000000,
            percentage: 99.9999,
            resetAt: new Date(),
            isLimited: false,
          },
        ],
        total: 1,
      },
    ];

    for (const config of configs) {
      mockQuotaTracker._setQuotas(config.quotas);
      mockQuotaTracker._setTotalAvailable(config.total);

      expect(() => handleQuotaStatus(deps)).not.toThrow();
    }
  });
});

describe("quota_status tool integration", () => {
  it("should have correct tool definition", async () => {
    const { quotaStatusTool } = await import("../../../src/tools/quota");

    expect(quotaStatusTool.name).toBe("quota_status");
    expect(quotaStatusTool.description).toBeDefined();
    expect(quotaStatusTool.inputSchema).toBeDefined();
  });
});
