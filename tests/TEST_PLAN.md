# Kế hoạch kiểm thử — Adaptive Math Coach

**Repo:** https://github.com/hoang89210/adative-math-coach  
**Production:** https://adative-math-coach.vercel.app  
**Nhánh test:** `test/e2e-playwright` (đã merge `origin/main` @ `1f38c70`)  
**Người test:** Nga (QA)  
**Cập nhật:** 2026-11-25 (Asia/Bangkok)

Tài liệu này mô tả phạm vi E2E, nguyên tắc an toàn mặc định, dữ liệu test, kết quả kỳ vọng, cách xác minh `amc_sessions`, dọn dữ liệu theo run manifest, và mẫu báo cáo lỗi. Framework: Playwright (`tests/e2e/`).

---

## 0. Nguyên tắc an toàn mặc định (Safety defaults)

1. **Mặc định chỉ chạy local:** Khi không truyền `BASE_URL`, `playwright.config.ts` tự chạy `npm run build && npx next start -H 127.0.0.1 -p 3100` trên `http://127.0.0.1:3100` với `local-fs` (xóa `DATABASE_URL` / `POSTGRES_*` / `BLOB_READ_WRITE_TOKEN` trừ khi bật `E2E_USE_ENV_DB=1`) và **không** dùng khóa OpenAI thật (`OPENAI_API_KEY` trống, `LLM_BASE_URL=http://127.0.0.1:1/v1` để canary key vào luồng fallback nội bộ).
2. **Chặn bắn nhầm prod/preview:** Nếu truyền `BASE_URL` không phải localhost/`127.0.0.1`/`::1`, config **throw lỗi ngay** trừ khi đặt thêm `E2E_ALLOW_REMOTE=1`.
3. **Ghi dữ liệu / OpenAI thật bị gate:** Các spec ghi session hoặc gọi OpenAI thật (`diagnostic-submit.spec.ts`, `teacher-session.spec.ts`, matrix K/4/8/10 trong `grade-matrix.spec.ts`) chỉ chạy khi `RUN_E2E=1`.
4. **Dọn dữ liệu theo run manifest (`tests/e2e/global-teardown.ts`):** Mọi session/learner/rate-key tạo ra trong lần chạy được ghi vào `e2e-artifacts/run-manifest.json` (gitignored). Khi kết thúc, `global-teardown.ts` **chỉ** xóa đúng các ID đã ghi của lần chạy đó (trên `data/sessions/`, `data/learners/`, và nếu có DB URL cấu hình thì xóa theo `= ANY($1)` trên `amc_events`, `amc_sessions`, `amc_learners`, `amc_rate_limits`). Không bao giờ xóa theo pattern rộng; no-op nếu không có ID nào được ghi hoặc không cấu hình DB.
5. **Bảo mật khóa:** `OPENAI_API_KEY` chỉ đọc từ env khi `RUN_E2E=1`. Khi `RUN_E2E=1`: tắt retry, tắt HTML report, tắt trace/screenshot/video, clear input sau khi bấm Save, và `global-teardown.ts` quét xóa artifact nếu lỡ dính key.

---

## 1. Danh sách spec

| Nhóm | File | Mặc định (`npm run test:e2e`) | Gate |
|------|------|-------------------------------|------|
| Smoke read-only | `tests/e2e/smoke.spec.ts` | Chạy (7 tests): `/`, `/teacher`, `/lab`, `/progress`, `/api/health`, `/api/config`, unknown session code | Không |
| Key gating, `"Không có key"`, PIN lock, hung DB | `tests/e2e/auth-and-key-paths.spec.ts` | Chạy (6 tests): 401 `OPENAI_KEY_REQUIRED` + UI banner đỏ; 403 `x-use-server-key` khi flag tắt; canary key fallback; server test key + 429 `Retry-After`; PIN lock 5/IP+code & 10/code → 429 `Retry-After: 900`; hung DB → health `okDb:false` + `dbError` + login 503 `Retry-After` | Bỏ qua các test cần isolate/local nếu `BASE_URL` remote |
| Grade matrix + API-key panel | `tests/e2e/grade-matrix.spec.ts` | Case key ngắn `sk-short` chạy mặc định (1 test) | Matrix K, 4, 8, 10 cần `RUN_E2E=1` (4 tests) |
| Diagnostic Submit → session store | `tests/e2e/diagnostic-submit.spec.ts` | Skip | `RUN_E2E=1` (1 test) |
| Teacher session code (happy path) | `tests/e2e/teacher-session.spec.ts` | Skip | `RUN_E2E=1` (1 test) |
| Remote hardening probe | `tests/e2e/hardening.spec.ts` | Skip | `RUN_HARDENING=1` (2 tests) |

Tổng cộng: **22 tests trong 6 files** (mặc định local: **14 passed, 8 skipped**).

---

## 2. Điều kiện tiên quyết cho `RUN_E2E=1` (DB / OpenAI thật)

1. `GET {BASE_URL}/api/health` trả HTTP 200, `ok: true`, `okContent: true`.
2. Nếu `env.sessionStore === "supabase"`: **`okDb === true`** (`env.dbOk === true`). Helper `assertDbReady()` chặn chạy nếu `okDb !== true`.
3. Có `OPENAI_API_KEY` hợp lệ trong env (`sk-…`, ≥ 20 ký tự), hoặc `serverTestKeyEnabled === true` nếu test luồng server key.
4. Trên Supabase đã chạy đủ `001_amc_sessions_learners.sql` và `002_amc_rate_limits.sql`.

---

## 3. Chi tiết các nhóm test chính

### (a) Health & Config (`PR #1` + `PR #3`)
- `GET /api/health` trả:
  - `ok`, `okContent`, `okDb` (`true | false | null`), `dbError` (chỉ có khi `okDb === false`, đã sanitize không chứa URI/password/token),
  - `serverTestKeyEnabled` (`ALLOW_SERVER_TEST_KEY=1` && có server key), `serverKeyFallbackEnabled` (`ALLOW_SERVER_KEY_FALLBACK=1` && có server key),
  - `env` (`hasOpenAiKey`, `acceptsUserApiKey: true`, `sessionStore`, `dbOk === okDb`, ...), `data.mathIndexExists === true`.
- `GET /api/config` trả `{ serverTestKeyEnabled, serverKeyFallbackEnabled }` khớp với `/api/health`.

### (b) Key gating & `"Không có key"` (`PR #3`)
- Không gửi `x-openai-api-key` và không gửi `x-use-server-key` (khi `ALLOW_SERVER_KEY_FALLBACK` tắt): `POST /api/diagnostic/generate` trả **401** `{ code: "OPENAI_KEY_REQUIRED", serverTestKeyEnabled }`, kể cả khi server có `OPENAI_API_KEY`.
- Trên UI `/`: chưa lưu key + bấm Start + xác nhận `confirm` → hiện banner đỏ `p.text-red-700` chứa `"OpenAI API key required"`.
- Khi `serverTestKeyEnabled === false`: nút `"Không có key"` ẩn; gửi header `x-use-server-key: 1` trả **403**.
- Khi `ALLOW_SERVER_TEST_KEY=1` + có server key: nút `"Không có key"` hiện, bấm đổi trạng thái sang `"đang dùng key test của server"` / `"Dùng key của tôi"`, request gửi `x-use-server-key: 1`; vượt `SERVER_TEST_KEY_MAX_CALLS` trả **429** + header `Retry-After`.
- Canary/fake key (`sk-canary-...`) qua panel vàng vẫn cho phép test luồng `/api/diagnostic/generate` fallback về câu hỏi tĩnh mà không tốn token OpenAI.

### (c) PIN rate-limit & Hung DB (`PR #1` + `PR #3`)
- `POST /api/learners` `{ action: "login", code, pin }`:
  - **5 lần sai** cùng `(IP, code)` → lần thứ 5 trả **429** + `Retry-After: 900` (`Too many login attempts. Try again later.`). Nhập đúng PIN từ IP đó trong lúc khóa vẫn trả **429**; IP khác nhập đúng PIN vẫn đăng nhập được và xóa counter.
  - **10 lần sai** cùng `code` qua nhiều IP khác nhau → lần thứ 10 trả **429** + `Retry-After: 900`. Mọi IP mới vẫn bị **429**.
- **Hung DB:** Khi Postgres không phản hồi quá `DB_CONNECT_TIMEOUT_MS` / `DB_QUERY_TIMEOUT_MS`:
  - `GET /api/health` → `ok: false`, `okContent: true`, `okDb: false`, `dbError` không chứa URI/password.
  - `POST /api/learners` login → **503** + `Retry-After` (và request tiếp theo trong `DB_FAIL_BACKOFF_MS` fail-fast ngay với **503** + `Retry-After`).

### (d) Diagnostic Submit → `amc_sessions` & Teacher session code (`RUN_E2E=1`)
- Grade 4 diagnostic trên `/` → trả lời 7 câu trên `/test` → Submit → `/results` hiện `Code XXXXXXXX` → `GET /api/teacher/session?sessionId=<code>` trả 200 → mở `/teacher` bằng code khớp snapshot.
- Kiểm tra DB gold-standard (khi chạy có Supabase):
  ```sql
  select id, short_code, grade, jurisdiction, percent, score, total, created_at
  from amc_sessions
  where short_code = '<SHORTCODE>' or id = '<sessionId>'::uuid;
  ```

---

## 4. Lệnh chạy

```bash
# Unit test, build, typecheck, lint
npm test
npm run build
npm run typecheck
npm run lint

# Liệt kê test
npm run test:e2e:list

# Suite E2E mặc định (an toàn, local server + local-fs, không gọi OpenAI thật)
npm run test:e2e

# Chỉ smoke
npm run test:e2e:smoke

# Chạy trên remote (BẮT BUỘC phải có E2E_ALLOW_REMOTE=1)
E2E_ALLOW_REMOTE=1 BASE_URL=https://adative-math-coach.vercel.app npm run test:e2e:smoke

# Chạy luồng ghi dữ liệu / OpenAI thật (cẩn thận khi trỏ remote)
RUN_E2E=1 E2E_ALLOW_REMOTE=1 BASE_URL=https://adative-math-coach.vercel.app npm run test:e2e
```

---

## 5. Mẫu báo cáo lỗi (bug report)

```markdown
### [BUG] <tiêu đề ngắn, 1 câu>

- **Mức độ:** Blocker / High / Medium / Low
- **Môi trường:** Local (`http://127.0.0.1:3100`) | Preview `<url>` | Production
- **Nhánh / commit:** `<sha>`
- **Thời điểm:** YYYY-MM-DD HH:mm (Asia/Bangkok)
- **Health tại lúc repro:** `ok=…`, `okContent=…`, `okDb=…`, `dbError=<redacted>`, `serverTestKeyEnabled=…`
- **Tester:** Nga

**Bước tái hiện (repro)**
1.
2.
3.

**Kết quả thực tế** (redact mọi key/URI/token)

**Kết quả kỳ vọng**
```
