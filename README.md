# gemini-oauth-mcp

Google OAuth 인증으로 Gemini API를 사용하는 MCP 서버입니다. API 키 없이 Google 계정으로 인증하여 무료 할당량을 활용할 수 있습니다.

## 특징

- **Google OAuth 2.0 인증** - API 키 불필요, 개인 계정으로 인증
- **무료 할당량 사용** - 비용 절감, 무료 계정의 할당량 활용
- **다중 계정 로테이션** - Rate Limit 회피, 여러 계정의 할당량을 순회
- **할당량 트래킹** - 계정별 요청 통계 및 리셋 시간 추적
- **자동 토큰 갱신** - Access Token 자동 갱신, Refresh Token 관리
- **stdio 기반 통신** - MCP 프로토콜 표준 준수

## 기술 스택

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.x
- **Framework**: @modelcontextprotocol/sdk 1.x
- **Validation**: zod 3.25+
- **Build**: tsup
- **Test**: vitest

## 설치

### npx (권장)

```bash
npx gemini-oauth-mcp
```

### 수동 설치

```bash
# 저장소 클론
git clone https://github.com/yourusername/gemini-oauth-mcp.git
cd gemini-oauth-mcp

# 의존성 설치
npm install

# 빌드
npm run build

# 실행
npm run build && node dist/index.js
```

### 환경 변수

기본값은 다음과 같습니다. 필요시 환경 변수로 오버라이드할 수 있습니다.

```bash
# OAuth 콜백을 받을 로컬 서버 포트 (기본값: 51121)
export OAUTH_PORT=51121

# 로그 레벨 (기본값: info)
# 가능한 값: debug, info, warn, error
export LOG_LEVEL=info
```

## MCP 설정

### Claude Code (.claude/mcp.json)

```json
{
  "mcpServers": {
    "gemini-oauth": {
      "command": "npx",
      "args": ["gemini-oauth-mcp"],
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### Cursor (.cursor/mcp.json)

```json
{
  "mcpServers": {
    "gemini-oauth": {
      "command": "npx",
      "args": ["gemini-oauth-mcp"],
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### 수동 설치 (로컬 빌드)

```json
{
  "mcpServers": {
    "gemini-oauth": {
      "command": "node",
      "args": ["/path/to/gemini-oauth-mcp/dist/index.js"],
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

## 사용법

### 계정 추가

`auth_login` 도구를 사용하여 새로운 Google 계정을 추가합니다.

```
사용자: auth_login을 실행해줘
```

**동작 방식:**
1. PKCE와 State를 생성하여 OAuth 2.0 보안 강화
2. 기본 브라우저에서 Google 인증 페이지 자동 열기
3. 사용자가 Google 계정으로 로그인 및 권한 승인
4. 로컬 콜백 서버에서 인증 코드 수신
5. 코드를 Access Token과 Refresh Token으로 교환
6. 토큰 저장 및 계정 등록

**응답 예시:**
```
[OK] Successfully authenticated!

  Account: user@gmail.com
  Status:  Ready to use
  Total:   1 account registered
```

### 등록된 계정 목록 조회

`auth_list` 도구로 모든 등록된 계정과 상태를 확인합니다.

```
사용자: 등록된 계정을 보여줘
```

**응답 예시:**
```
Registered Accounts (2)
═══════════════════════════════════════════════════════════

  #  Email                  Status         Last Used
  ─  ──────────────────────  ─────────────  ──────────────────

  1  user1@gmail.com        ● Active       just now
  2  user2@gmail.com        ○ Ready        2 hours ago

═══════════════════════════════════════════════════════════

Status Legend:
  ● Active   - Currently in use
  ○ Ready    - Available for use
  ◌ Limited  - Rate limited, waiting for reset
```

**상태 의미:**
- **Active (●)**: 현재 사용 중인 계정
- **Ready (○)**: 사용 가능한 상태의 계정
- **Limited (◌)**: Rate Limit 상태, 리셋 대기 중

### 현재 인증 상태 확인

`auth_status` 도구로 현재 인증 상태와 토큰 유효 시간을 확인합니다.

```
사용자: 현재 인증 상태를 확인해줘
```

**응답 예시:**
```
Authentication Status
═══════════════════════════════════════════════════════════

  Status:         ✓ Authenticated
  Active Account: user@gmail.com
  Token Expiry:   50 minutes remaining

  Accounts:       2 registered
  Rate Limited:   0 accounts
  Available:      2 accounts

═══════════════════════════════════════════════════════════
```

### 계정 제거

`auth_remove` 도구로 등록된 계정을 제거합니다.

```
사용자: user2@gmail.com을 제거해줘
```

**파라미터:**
- `account_id` (string): 제거할 계정의 ID 또는 이메일 주소

**응답 예시:**
```
✓ Account removed

  Removed: user2@gmail.com
  Remaining: 1 account
```

**제약 사항:**
- 마지막 계정은 제거할 수 없습니다 (최소 1개 계정 필요)
- 새 계정을 추가한 후 기존 계정을 제거하는 것을 권장합니다

### 대화형 응답 생성

`chat` 도구를 사용하여 Gemini AI와 대화합니다.

```
사용자: 파리에 대해 알려줘
```

**파라미터:**
- `message` (string, 필수): 전송할 메시지
- `model` (string, 선택): 사용할 모델명 (기본값: `gemini-2.5-flash`)

**지원 모델:**
- `gemini-2.5-flash` - 빠르고 비용 효율적 (기본값)
- `gemini-2.5-pro` - 더 강력한 성능
- `gemini-1.5-flash` - 장 컨텍스트 처리
- `gemini-1.5-pro` - 고급 분석

**응답 예시:**
```
[Gemini 2.5 Flash via user@gmail.com]

파리는 프랑스의 수도이자 가장 큰 도시입니다. 센강을 따라
펼쳐진 파리는 세계적으로 문화, 예술, 과학의 중심지로 알려져 있습니다...

제로 꺼진다 아이펠탑, 루브르 박물관, 노트르담 대성당 등
많은 명소들이 있습니다.
```

**Rate Limit 자동 처리:**
Rate Limit(429)이 발생하면 자동으로 다음 계정으로 전환됩니다.

```
⚠ Rate limit on user1@gmail.com
  → Switching to user2@gmail.com

[Gemini 2.5 Flash via user2@gmail.com]

파리는 프랑스의 수도입니다...
```

### 콘텐츠 생성

`generate_content` 도구로 긴 형식의 콘텐츠를 생성합니다.

```
사용자: 블로그 포스트를 작성해줘. 제목: "AI의 미래"
```

**파라미터:**
- `prompt` (string, 필수): 콘텐츠 생성 프롬프트
- `model` (string, 선택): 사용할 모델명 (기본값: `gemini-2.5-flash`)

**응답 예시:**
```
[Gemini 2.5 Flash via user@gmail.com]

# AI의 미래

## 서론
인공지능 기술은 현대 사회의 가장 중요한 혁신 중 하나입니다...

## 본론
1. 기술 발전
   - 머신러닝의 고도화
   - 자연어 처리의 진화
   ...
```

**Rate Limit 처리:**
`chat` 도구와 동일한 자동 계정 전환 메커니즘 적용됩니다.

### 할당량 확인

`quota_status` 도구로 모든 계정의 할당량 사용 현황을 확인합니다.

```
사용자: 할당량 상태를 보여줘
```

**응답 예시:**
```
Quota Status
═══════════════════════════════════════════════════════════

  Account            Requests       Status
  ─────────────────  ────────────   ──────────────────────

  user1@gmail.com    45/1000        ████████░░ 45%
  user2@gmail.com    950/1000       ██████████ 95%
  user3@gmail.com    1200/1000      ██████████ Limited

═══════════════════════════════════════════════════════════

  Total Available:     345 requests

  Rate Limited:        1 account (user3@gmail.com)
  Next Reset:          2 hours

═══════════════════════════════════════════════════════════
```

**표시 항목:**
- **Account**: 이메일 주소 (20자까지 표시, 초과시 "..." 처리)
- **Requests**: 사용한 요청 수 / 제한량
- **Status**: 프로그레스 바 및 사용률/제한 상태
- **Total Available**: 모든 계정의 사용 가능한 요청 합계
- **Rate Limited**: Rate Limit 상태의 계정 수 및 이메일
- **Next Reset**: 다음 할당량 리셋 시간

## 트러블슈팅

### 인증 실패

#### "Authentication timed out"
**원인:** 5분 내에 Google 인증을 완료하지 못했습니다.

**해결 방법:**
```bash
# auth_login 다시 실행
# 브라우저에서 Google 인증 완료 (5분 내)
# 또는 OAUTH_PORT 환경 변수 확인
export OAUTH_PORT=51121
```

#### "User denied access"
**원인:** Google 인증 페이지에서 "거부"를 선택했습니다.

**해결 방법:**
1. 다시 `auth_login` 실행
2. Google 인증 페이지에서 "계속" 또는 "허용" 선택
3. 요구되는 권한 승인

#### "Failed to get user info"
**원인:** 인증은 성공했지만 사용자 정보 조회 실패

**해결 방법:**
1. Google 계정의 인터넷 연결 확인
2. 다시 `auth_login` 시도
3. 다른 Google 계정으로 시도

### Rate Limit (429 에러)

#### "All accounts are rate limited"
**원인:** 등록된 모든 계정이 Rate Limit 상태입니다.

**해결 방법:**

1. **새 계정 추가:**
   ```
   auth_login을 실행하여 새로운 Google 계정 추가
   ```

2. **대기:**
   ```
   quota_status로 리셋 시간 확인 후 대기
   ```

3. **요청 감소:**
   ```
   API 호출 빈도 감소 또는 배치 처리 방식 변경
   ```

#### Rate Limit 해제 확인

```
사용자: 할당량 상태를 확인해줘
```

`Next Reset` 시간이 "now" 또는 과거 시간이면 할당량이 리셋된 상태입니다.

### 연결 오류

#### "Failed to start MCP server"
**원인:** 서버 시작 실패, 포트 충돌 가능

**해결 방법:**

1. **포트 변경:**
   ```bash
   export OAUTH_PORT=51122
   ```

2. **포트 충돌 확인 (macOS/Linux):**
   ```bash
   lsof -i :51121
   ```

3. **서버 프로세스 종료:**
   ```bash
   # 이전 프로세스 종료 후 재시작
   pkill -f "node dist/index.js"
   npm run build && node dist/index.js
   ```

#### "Connection refused"
**원인:** MCP 클라이언트가 서버와 연결할 수 없음

**해결 방법:**

1. **서버 실행 확인:**
   ```bash
   # 새 터미널에서 서버 수동 실행
   npm run build && node dist/index.js
   ```

2. **MCP 설정 경로 확인:**
   - Claude Code: `.claude/mcp.json`
   - Cursor: `.cursor/mcp.json`

3. **명령어 경로 확인:**
   ```bash
   # npx 설치 확인
   which npx

   # 또는 절대 경로 사용
   /usr/local/bin/node /full/path/to/dist/index.js
   ```

### 토큰 갱신 오류

#### "Token refresh failed"
**원인:** Refresh Token으로 새 Access Token을 획득하지 못했습니다.

**해결 방법:**

1. **계정 재인증:**
   ```
   계정 제거: auth_remove user@gmail.com
   계정 추가: auth_login
   ```

2. **Google 계정 보안 확인:**
   - https://myaccount.google.com/security 에서 로그인 확인
   - 의심스러운 로그인 활동 제거

3. **앱 비밀번호 설정 (2단계 인증 활성화 시):**
   - Google 계정 보안 설정에서 앱 비밀번호 생성
   - 재인증 시도

### 로깅 및 디버깅

#### 디버그 로그 활성화

```bash
export LOG_LEVEL=debug
npm run build && node dist/index.js
```

#### 토큰 저장 위치

```bash
# macOS/Linux
~/.config/gemini-oauth-mcp/

# Windows
%APPDATA%\gemini-oauth-mcp\
```

#### 저장된 계정 확인

```bash
ls -la ~/.config/gemini-oauth-mcp/
# storage.json 파일에 저장됨
```

## 개발

### 프로젝트 구조

```
gemini-oauth-mcp/
├── src/
│   ├── index.ts              # 진입점, stdio 서버 시작
│   ├── server.ts             # MCP 서버 설정, 도구 등록
│   ├── tools/
│   │   ├── auth.ts           # auth_login, auth_list, auth_remove, auth_status
│   │   ├── chat.ts           # chat 도구
│   │   ├── generate.ts       # generate_content 도구
│   │   ├── quota.ts          # quota_status 도구
│   │   └── index.ts          # 도구 내보내기
│   ├── auth/
│   │   ├── oauth.ts          # Google OAuth 2.0 구현
│   │   ├── storage.ts        # 계정 저장소
│   │   └── token.ts          # 토큰 관리
│   ├── accounts/
│   │   ├── manager.ts        # 계정 관리
│   │   ├── rotator.ts        # Rate Limit 시 계정 전환
│   │   ├── quota.ts          # 할당량 트래킹
│   │   └── index.ts          # 내보내기
│   ├── api/
│   │   ├── client.ts         # Gemini API 클라이언트
│   │   ├── transform.ts      # 응답 변환
│   │   └── index.ts          # 내보내기
│   └── utils/
│       ├── config.ts         # 설정 (포트, 로그 레벨)
│       ├── logger.ts         # 로깅
│       ├── errors.ts         # 커스텀 에러
│       └── index.ts          # 내보내기
├── tests/
│   ├── unit/                 # 단위 테스트
│   └── integration/          # 통합 테스트
├── dist/                     # 빌드 출력
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

### 빌드 & 테스트

```bash
# 의존성 설치
npm install

# 개발 모드 (watch)
npm run dev

# 프로덕션 빌드
npm run build

# 테스트 (1회)
npm run test

# 테스트 (watch 모드)
npm run test:watch

# 린트 검사
npm run lint

# 자동 형식화
npm run format

# 타입 검사
npm run typecheck
```

### 새로운 도구 추가

1. **도구 정의 및 구현** (`src/tools/new-tool.ts`):
   ```typescript
   import { z } from "zod";

   export const newTool = {
     name: "new_tool",
     description: "새로운 도구 설명",
     inputSchema: z.object({
       param: z.string().describe("파라미터 설명"),
     }),
   };

   export async function handleNewTool(
     args: { param: string }
   ): Promise<ToolResponse> {
     // 구현
     return {
       content: [{ type: "text", text: "결과" }],
     };
   }
   ```

2. **서버에 등록** (`src/server.ts`):
   ```typescript
   import { newTool, handleNewTool } from "./tools/new-tool.js";

   server.registerTool(
     newTool.name,
     newTool,
     handleNewTool
   );
   ```

3. **테스트 추가** (`tests/integration/new-tool.test.ts`):
   ```typescript
   describe("new_tool", () => {
     it("should work correctly", async () => {
       const result = await handleNewTool({ param: "test" });
       expect(result.content[0].text).toContain("결과");
     });
   });
   ```

## API 문서

### MCP 도구 목록

| 도구명 | 입력 | 설명 |
|--------|------|------|
| `auth_login` | 없음 | Google 계정 추가 |
| `auth_list` | 없음 | 등록된 계정 목록 |
| `auth_remove` | `account_id` | 계정 제거 |
| `auth_status` | 없음 | 인증 상태 확인 |
| `chat` | `message`, `model?` | 대화형 응답 |
| `generate_content` | `prompt`, `model?` | 콘텐츠 생성 |
| `quota_status` | 없음 | 할당량 현황 |

### 응답 형식

모든 도구는 다음 형식의 MCP Tool Response를 반환합니다:

```typescript
{
  content: [
    {
      type: "text",
      text: "응답 텍스트"
    }
  ],
  isError?: boolean  // true면 에러 응답
}
```

### 에러 처리

모든 에러는 `isError: true`와 함께 사용자 친화적인 메시지로 반환됩니다:

```
[ERROR] 작업 실패

Reason: 구체적인 오류 원인
```

## 라이선스

MIT

## 참고

- [Model Context Protocol (MCP)](https://modelcontextprotocol.io)
- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
- [Gemini API](https://ai.google.dev)
- [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth)
