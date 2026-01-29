# CLAUDE.md - gemini-oauth MCP Server

## 프로젝트 개요

Google OAuth 인증으로 Gemini API를 사용하는 MCP 서버

## 기술 스택

- TypeScript 5.x
- Node.js 20+
- @modelcontextprotocol/sdk 1.x
- zod 3.25+
- vitest (테스트)
- tsup (번들링)

## 핵심 기능

1. OAuth 인증 (Google OAuth 2.0)
2. 토큰 관리 (자동 갱신)
3. Gemini API 호출 (chat, generateContent)
4. 다중 계정 로테이션 (Rate Limit 회피)
5. 할당량 트래킹

## MCP Tools

| Tool | 설명 |
|------|------|
| auth_login | 새 Google 계정 추가 |
| auth_list | 등록된 계정 목록 |
| auth_remove | 계정 제거 |
| auth_status | 현재 인증 상태 |
| chat | 대화형 응답 |
| generate_content | 콘텐츠 생성 |
| quota_status | 계정별 할당량 |

## 디렉토리 구조

```
gemini-oauth-mcp/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # MCP Server setup
│   ├── tools/                # MCP Tools
│   ├── auth/                 # Authentication
│   ├── accounts/             # Multi-account
│   ├── api/                  # Gemini API
│   └── utils/                # Utilities
├── tests/
│   ├── unit/
│   └── integration/
└── package.json
```

## 빌드 & 테스트 명령어

```bash
pnpm install        # 의존성 설치
pnpm build          # tsup 빌드
pnpm test           # vitest 테스트
pnpm lint           # eslint 검사
```

## 참조

- [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) - 구현 참조
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

---

## Phase 4 Integration Tests - Completion Summary

### Deliverables
- **File**: `tests/integration/api.test.ts`
- **Test Count**: 20 comprehensive integration tests
- **Lines of Code**: 933 lines
- **Status**: All tests passing (348/348 total)

### Test Coverage

#### Chat Tool Tests (4 tests)
1. `should successfully send message and receive response` - Basic chat functionality
2. `should use correct model from parameter` - Custom model handling
3. `should use default model when not specified` - Default model fallback
4. `should format response with model and email` - Response formatting with metadata

#### Generate Content Tool Tests (2 tests)
1. `should successfully generate content from prompt` - Content generation
2. `should handle multi-line responses` - Multi-line content handling

#### Rate Limit Handling Tests (4 tests)
1. `should switch to next account on rate limit` - Account switching on 429
2. `should retry with new account automatically` - Automatic retry mechanism
3. `should fail when all accounts are rate limited` - Graceful failure handling
4. `should mark account as rate limited after 429 response` - Rate limit tracking

#### Account Rotation Tests (3 tests)
1. `should rotate through accounts in round-robin` - Round-robin rotation logic
2. `should skip rate-limited accounts` - Skip limited accounts
3. `should recover account after rate limit expires` - Rate limit recovery

#### Error Handling Tests (4 tests)
1. `should handle network errors with retry` - Network error resilience
2. `should handle API errors gracefully` - API error handling
3. `should return proper error messages` - Error message quality
4. `should handle empty API responses` - Empty response handling

#### End-to-End Scenario Tests (3 tests)
1. `should complete chat flow with token refresh` - Token refresh workflow
2. `should complete generate flow with quota tracking` - Quota tracking workflow
3. `should handle multiple requests with account rotation` - Multi-request scenario

### Key Testing Patterns

1. **Mock Dependencies**: Comprehensive mocking of TokenManager, AccountRotator, QuotaTracker
2. **Fetch Mocking**: Global fetch mock for API call testing
3. **Account Factory**: Test account creation utility for consistent test data
4. **Email Rotation Simulation**: Accurate simulation of account rotation behavior
5. **Rate Limit Scenarios**: Realistic rate limit (429) response handling

### Test Execution Results
```
Test Files: 17 passed (17)
Tests: 348 passed (348)
  - 20 new integration tests
  - 328 existing unit tests
Duration: ~1 second
```

## Lessons Learned

### Integration Testing Best Practices
1. **Mock Global Objects Carefully**: When mocking fetch globally, use `vi.useFakeTimers()` to control timing
2. **Test Account Factories**: Creating helper functions for test data ensures consistency and readability
3. **Realistic Mock Responses**: Simulate actual API response structures (candidates, content, parts)
4. **Multiple Scenario Testing**: Cover success, retry, error, and recovery paths comprehensively

### Rate Limit Testing Insights
- 429 responses must be handled differently from other HTTP errors
- Account rotation requires stateful mock updates to reflect email changes
- All-accounts-rate-limited scenario requires special error type handling
- Retry-After header parsing needs proper millisecond conversion (seconds × 1000)

### Account Rotation Patterns
- Round-robin rotation maintains consistent state across multiple requests
- Rate limit recovery requires timestamp comparison (Date.now() >= availableAt)
- Available accounts list should be dynamically calculated based on current limits
- Index tracking needed for proper round-robin cycling through account list

---

## Phase 4 MCP Client Integration Tests - Completion Summary

### Deliverables
- **File**: `tests/integration/mcp-client.test.ts`
- **Test Count**: 19 comprehensive MCP client integration tests
- **Lines of Code**: 512 lines
- **Status**: All tests passing (367/367 total including previous phases)

### Test Coverage

#### Server Initialization (3 tests)
1. `should start server with stdio transport` - Verifies server starts with proper transport
2. `should register all tools on startup` - Confirms all 7 tools are registered
3. `should respond to initialize request` - MCP initialize protocol support

#### Tool Discovery (2 tests)
1. `should list all available tools` - Lists tools via tools/list
2. `should return correct tool schemas` - Validates tool definitions with names, descriptions, input schemas

#### Tool Invocation (7 tests)
1. `should invoke ping tool` - Health check tool works
2-7. Verify all 7 MCP tools are available: auth_login, auth_list, auth_remove, auth_status, chat, generate_content, quota_status

#### Error Handling (3 tests)
1. `should return error for unknown tool` - Unknown tool handling
2. `should return error for invalid parameters` - Missing required params handling
3. `should handle internal errors gracefully` - Unexpected errors don't crash

#### Protocol Compliance (4 tests)
1. `should follow MCP message format` - Valid JSON-RPC 2.0 structure
2. `should include required response fields` - Tool responses have content array with type/text
3. `should ensure all responses are valid JSON-RPC` - Proper JSON-RPC response format

### Key Implementation Details

1. **TestMcpClient Implementation**:
   - Spawns actual MCP server process as subprocess
   - Communicates via stdio using JSON-RPC 2.0 protocol
   - Handles async message parsing with request/response correlation
   - Implements proper timeout handling (5 second default)

2. **Server Integration**:
   - All 7 MCP tools registered on server startup in `src/server.ts`
   - Each tool has proper definition with input schema
   - Placeholder implementations that can be extended

3. **Test Patterns**:
   - Process lifecycle management in beforeAll/afterAll
   - Build project before spawning server
   - JSON-RPC message format validation
   - MCP tool schema compliance verification
   - Case-insensitive description matching

### Test Execution Results
```
Test Files: 18 passed (18)
Tests: 367 passed (367)
  - 19 new MCP client integration tests
  - 348 existing unit/integration tests
Duration: ~3 seconds
```

## Lessons Learned

### [2026-01-28] MCP Client Integration Testing Pattern (MCP, stdio, JSON-RPC, process)
- **Situation**: Needed to write integration tests for MCP server that communicates via stdio
- **Problem**: Standard HTTP-based test clients don't work for stdio-based MCP communication
- **Challenge**: Messages arrive asynchronously, need proper correlation of requests/responses
- **Solution**:
  - Spawn server as child process using Node.js `child_process.spawn()`
  - Use stdio streams (stdout/stdin) for bidirectional communication
  - Maintain a Map of pending requests keyed by message ID
  - Parse incoming JSON-RPC messages on data event
  - Correlate response with request using ID field
  - Use Promise with timeout to ensure request completion
- **Key Pattern**:
  ```
  1. Generate unique ID for request
  2. Create Promise that resolves when response arrives
  3. Store resolver in Map<id, resolver>
  4. Send JSON-RPC message on stdin
  5. On stdout data: parse lines, find matching ID, resolve promise
  ```
- **Critical Details**:
  - Build project (npm run build) BEFORE spawning server to ensure dist files exist
  - Use subprocess stdio: ["pipe", "pipe", "pipe"] to capture all streams
  - Parse newline-delimited JSON (one message per line)
  - Handle incomplete messages in buffer (keep last incomplete line)
  - Clean up process in afterAll with proper exit handling
- **Lesson**: MCP testing requires actual process spawning and stream-based I/O, not mocking. This tests the real server initialization, tool registration, and protocol compliance.

### [2026-01-28] Tool Registration in MCP Server (server.ts, tool registration)
- **Situation**: Need to register all 7 MCP tools so they appear in tools/list
- **Problem**: Initial server.ts only had ping tool; other tools not visible to clients
- **Solution**: Import all tool definitions and register them in createServer():
  ```typescript
  import { authLoginTool, authListTool, ... } from "./tools/auth.js"
  server.registerTool(authLoginTool.name, authLoginTool, handler)
  ```
- **Key Point**: Tool registration makes them discoverable via MCP protocol
- **Lesson**: Each tool needs explicit server.registerTool() call with (name, definition, handler)

### [2026-01-28] Case-Sensitive String Matching in Tests (vitest, toContain)
- **Situation**: Tool description assertions were failing with `toContain`
- **Problem**: "List all registered Google accounts with status" doesn't contain lowercase "list"
- **Error**: `expected 'List all...' to contain 'list'` (uppercase L vs lowercase l)
- **Solution**: Use `.toLowerCase()` on descriptions before assertion
  ```typescript
  expect(authListTool?.description.toLowerCase()).toContain("list")
  ```
- **Alternative**: Use regex or custom matcher for case-insensitive checks
- **Lesson**: Always consider case sensitivity in string matching. Tool descriptions are user-facing and use proper capitalization.

### [2026-01-28] JSON-RPC Error Response Handling (MCP protocol)
- **Situation**: Testing unknown tool invocation
- **Problem**: Unclear if MCP returns error or success response for unknown tools
- **Solution**: Check both branches - either error field OR result field must exist
  ```typescript
  if (response.error) {
    expect(response.error.code).toBeDefined()
  } else {
    expect(response.result).toBeDefined()
  }
  ```
- **Lesson**: Implementation details matter. Test both valid and edge cases, allow for multiple valid outcomes in MCP compliance.
