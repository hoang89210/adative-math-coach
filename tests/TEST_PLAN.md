# Kế hoạch kiểm thử — Adaptive Math Coach

**Repo:** https://github.com/hoang89210/adative-math-coach  
**Production:** https://adative-math-coach.vercel.app  
**Nhánh test (local, chưa push):** `test/e2e-playwright` (tạo từ `main` @ `fb6af10`)  
**Người test:** Nga (QA)  
**Cập nhật:** 2026-11-25 (Asia/Bangkok)

Tài liệu này mô tả phạm vi E2E, điều kiện tiên quyết, dữ liệu test, kết quả kỳ vọng, cách xác minh `amc_sessions`, và mẫu báo cáo lỗi. Framework: Playwright (`tests/e2e/`).

---

## 0. Phạm vi và nguyên tắc

| Nhóm | File | Khi nào chạy |
|------|------|----------------|
| (d) Smoke read-only | `tests/e2e/smoke.spec.ts` | Mặc định. An toàn trên prod. **Không** Submit diagnostic, **không** gọi OpenAI. |
| (a) Diagnostic Submit → `amc_sessions` | `tests/e2e/diagnostic-submit.spec.ts` | Chỉ khi `RUN_E2E=1` |
| (b) Teacher session code | `tests/e2e/teacher-session.spec.ts` (happy path) + case mã sai trong smoke | Happy path: `RUN_E2E=1` |
| (c) Matrix grade K, 4, 8, 10 + API-key panel | `tests/e2e/grade-matrix.spec.ts` | `RUN_E2E=1` (trừ case key sai, vẫn bị skip cùng file vì `describe` gate; có thể tách sau) |
| (e) Kiểm tra PR của Thọ | `tests/e2e/hardening.spec.ts` | Chỉ khi `RUN_HARDENING=1` (sau khi PR được deploy / chạy local nhánh của Thọ) |

**Bảo mật khóa:** `OPENAI_API_KEY` chỉ đọc từ biến môi trường. Không in, không `console.log`, không commit, không đưa vào báo cáo, trace hay screenshot của lần chạy có dán key. Panel lưu key trong `localStorage` key `amc_openai_api_key` và gửi header `x-openai-api-key` — không lưu DB.

**Không có `data-testid` trên UI hiện tại.** Selector dùng role / placeholder / text lấy từ source (`src/app/page.tsx`, `teacher/page.tsx`, `lab/page.tsx`, `test/page.tsx`, `results/page.tsx`, `ApiKeyPanel.tsx`). Chỗ còn thiếu đánh dấu TODO trong helper.

---

## 1. Điều kiện tiên quyết (preconditions)

Trước mọi E2E **ghi dữ liệu** (Submit diagnostic, tạo learner, Teacher load session vừa tạo):

1. `GET {BASE_URL}/api/health` trả HTTP 200.
2. **`env.dbOk === true`** (và trên nhánh hardening: `okDb === true`).  
   Nếu `dbOk` là `false` hoặc `null`: **không chạy write E2E.** Submit sẽ fail khi `saveMastery` ghi Postgres (`src/app/api/diagnostic/grade/route.ts`). Helper `assertDbReady()` chặn điều này.
3. `data.mathIndexExists === true` (nội dung KG index có mặt).
4. `env.sessionStore === "supabase"` trên production (ưu tiên Postgres).
5. Có OpenAI key hợp lệ trên máy test (`OPENAI_API_KEY`, dạng `sk-…`, ≥ 20 ký tự) **hoặc** server `hasOpenAiKey: true`. Matrix (c) **bắt buộc** dán key qua panel vàng (đọc từ env), không phụ thuộc server key.
6. Migration đã chạy trên Supabase: `supabase/migrations/001_amc_sessions_learners.sql` (bảng `amc_sessions`, `amc_learners`, `amc_events`).  
   PR của Thọ thêm `002_amc_rate_limits.sql` (`amc_rate_limits`) — cần khi chạy (e).

**Trạng thái prod tại thời điểm viết kế hoạch (cần xác nhận lại mỗi lần test):** historically `dbOk: false` dù `hasDatabaseUrl: true` — blocker P0. Smoke vẫn chạy và **ghi nhận** `dbOk`, không fail chỉ vì `dbOk: false`.

Health trên `main` / prod hiện tại **chưa** có `okContent`, `okDb` (top-level), `dbError`. Các field này nằm trên nhánh local của Thọ `fix/health-dberror-pin-ratelimit` (commit `f9b6f2e`, chưa có trên `origin/main` khi viết). Spec (e) vì thế tách riêng, không gắn vào smoke mặc định.

---

## 2. Dữ liệu test

| Mục | Giá trị | Ghi chú |
|-----|---------|---------|
| Jurisdiction | `Multi-State` (mặc định) | Có trên `<select>` trang chủ |
| Grade matrix | K, 4, 8, 10 | Band tương ứng: `K–2`, `3–5`, `6–8`, `9–12` (en-dash). Nút: `Kindergarten`, `Grade 4`, `Grade 8`, `Grade 10` |
| OpenAI key | `process.env.OPENAI_API_KEY` | Dán vào panel, bấm **Save key**. Không hard-code. |
| Learner (tùy chọn, chưa nằm trong E2E mặc định) | PIN 4–6 chữ số, code dạng `MATH-XXXXXX` | Tạo qua **New learner** / `POST /api/learners` `{ action: "create", pin, grade, jurisdiction }` |
| Session code giả (smoke) | `ZZZZNOTREAL` | Kỳ vọng không tìm thấy; không ghi DB |
| Câu trả lời diagnostic | Chọn option đầu tiên, hoặc gõ `42` nếu short-answer | Mục tiêu là hoàn tất Submit, không phải điểm cao |
| PIN rate-limit (e) | Code giả `MATH-E2E…`, PIN `0000` | 5 lần fail / cửa sổ 15 phút (theo `pin-rate-limit-core.ts` của Thọ). Không chạy bừa trên prod. |

`BASE_URL` mặc định: `https://adative-math-coach.vercel.app`. Override khi test preview hoặc `http://localhost:3000`.

---

## 3. Chi tiết các nhóm test

### (a) Diagnostic Submit → có row trong `amc_sessions`

**Luồng**

1. Confirm health `dbOk: true`.
2. Mở `/`, dán + Save key, chọn band **3–5** / **Grade 4**, bấm **Start Grade 4 diagnostic**.
3. API: `POST /api/diagnostic/generate` `{ grade, jurisdiction }` (có header key nếu đã lưu).
4. Trang `/test`: trả lời hết câu (6–8 câu), bấm **Submit** (nút đổi từ **Next** ở câu cuối).
5. API: `POST /api/diagnostic/grade` rồi `POST /api/roadmap` `{ sessionId }`.
6. Trang `/results` hiện điểm và `Code {SHORTCODE}` (8 ký tự, `sessionId` bỏ dấu `-`, 8 ký tự đầu, uppercase — `sessionShortCode`).

**Cách xác minh row `amc_sessions`**

Không có endpoint health/admin nào liệt kê bảng. Có 3 tầng, độ tin cậy tăng dần:

| Tầng | Cách | Quyền cần có | Ghi chú |
|------|------|----------------|---------|
| 1. UI | `/results` hiện `Code XXXXXXXX` và không báo lỗi save | Không | Chỉ chứng minh API grade không 500; chưa chứng minh Postgres |
| 2. API (black-box, dùng trong Playwright) | `GET /api/teacher/session?sessionId={shortCode\|uuid}` → 200, `shortCode` / `grade` khớp | Không (public read theo code) | `resolveSessionId` đọc `amc_sessions.short_code` hoặc uuid khi `sessionStore=supabase`. Nếu `dbOk: false`, grade đã 500 trước đó. |
| 3. SQL (gold standard) | Xem dưới | **Supabase SQL Editor** project **supabase-erin-forest**, hoặc `DATABASE_URL` / `POSTGRES_*` (không commit, không đưa vào log) | Tester hiện **không** có sẵn credential trên máy test |

```sql
select id, short_code, grade, jurisdiction, percent, score, total, learner_id, created_at
from amc_sessions
where short_code = '<SHORTCODE>'
   or id = '<sessionId>'::uuid;
```

Kỳ vọng: đúng 1 row, `grade = '4'`, `short_code` khớp, `result` jsonb không rỗng, `created_at` gần thời điểm Submit.

**Câu hỏi mở:** Hoàng/Thọ có cấp quyền SQL (hoặc một GET admin an toàn) để Nga xác minh tầng 3 không? xem mục 8.

### (b) Teacher session code

**Luồng**

1. Có session thật từ (a) (hoặc code trên `/results`).
2. Mở `/teacher` (hoặc bấm **Teacher view** trên results: `/teacher?session={uuid}`).
3. Ô *Session code or full session id* (placeholder `e.g. A1B2C3D4`), bấm **Open session** (hoặc **Open linked session** nếu vào từ query).
4. API: `GET /api/teacher/session?sessionId=…`.

**Kỳ vọng**

- Snapshot: `Grade {n} · {score}/{total} ({percent}%) · code {SHORTCODE}`.
- Heading **Student snapshot**, **Focus skill**.
- Code sai: thông báo dạng `session not found` (copy trên main: `session not found — check code or full session id`), không 500.

Các nút Teacher gọi LLM (**Build lesson**, prep, CFU, diff) **chưa** nằm trong scope E2E lần này (cũng phải `RUN_E2E=1` + key nếu bổ sung sau).

### (c) Matrix grade K, 4, 8, 10 + API-key panel

Với mỗi grade:

1. `/` → dán `OPENAI_API_KEY` vào panel vàng → **Save key** → status *Key saved on this device*.
2. Chọn đúng grade band rồi nút grade (xem bảng dữ liệu).
3. Start diagnostic → `/test` hiện `Grade {K\|4\|8\|10} diagnostic` và `Question 1 of N`.
4. Submit → `/results` hiện `Grade {…} results`.

Case phụ (nên có, hiện nằm trong file bị gate): key `sk-short` → *Key should start with sk- and be long enough.* Không lưu.

Kỳ vọng thêm: câu hỏi phù hợp band (K–2 cụ thể/ngắn; 9–12 không “baby talk”) — đánh giá thủ công / ghi note nếu lệch; Playwright chỉ kiểm tra luồng và grade label.

### (d) Smoke Student `/`, Teacher `/teacher`, Lab `/lab`, GET health

Xem bảng mục 0. Health: HTTP 200, có `ok` / `env` / `data`, `mathIndexExists: true`, `acceptsUserApiKey: true`. Log body đã redact. **Không fail** khi `dbOk: false` — ghi nhận để báo blocker.

### (e) Sau này — PR của Thọ

Chạy khi `RUN_HARDENING=1` và `BASE_URL` trỏ bản đã có code harden (preview, local nhánh `fix/health-dberror-pin-ratelimit`, hoặc prod sau khi merge).

| Check | Kỳ vọng |
|-------|---------|
| Health shape | Top-level `okContent: boolean`, `okDb: boolean \| null` (mirror `env.dbOk`), `ok` nhất quán với comment trong `src/app/api/health/route.ts` trên nhánh Thọ |
| `dbError` | Chỉ có khi `okDb === false`. Message không rỗng, **không** chứa URI Postgres, `password=`, token, `sk-…` |
| `okContent` | `true` khi `data/math-index.json` có mặt (prod kỳ vọng `true`) |
| PIN rate-limit | `POST /api/learners` `{ action: "login", code, pin }` sai lặp lại → HTTP **429**, body `Too many login attempts. Try again later.`, header `Retry-After`. Ngưỡng: 5 fail / 15 phút, key theo IP + code. Trên `main` hiện **chưa** có limiter (sẽ 401 mãi). |

---

## 4. Cách chạy

```bash
# Cài (một lần)
npm install
npx playwright install chromium

# Liệt kê test
npm run test:e2e:list
# hoặc: npx playwright test --list

# Smoke read-only (mặc định trỏ prod)
npm run test:e2e:smoke
# BASE_URL=http://localhost:3000 npm run test:e2e:smoke

# Toàn bộ, kể cả write/OpenAI — chỉ khi dbOk:true và đã được phép
# OPENAI_API_KEY được đọc từ env; đừng echo biến này
RUN_E2E=1 npm run test:e2e

# Check PR harden của Thọ
RUN_HARDENING=1 BASE_URL=http://localhost:3000 npm run test:e2e -- tests/e2e/hardening.spec.ts
```

Script npm: `test:e2e`, `test:e2e:smoke`, `test:e2e:list`.  
Config: `playwright.config.ts` — `baseURL` từ `BASE_URL`, mặc định prod.

---

## 5. Kết quả kỳ vọng (tóm tắt)

| ID | Tình huống | Kỳ vọng |
|----|------------|---------|
| SM-01 | GET `/` | Heading *Three roles. One learning system.*, panel API key, Start diagnostic |
| SM-02 | GET `/teacher` | *Plan from student diagnostic*, ô session code, *Open session* |
| SM-03 | GET `/lab` | *Evaluate AI content quality*, alignment + grade-level |
| SM-04 | GET `/api/health` | 200, JSON, `mathIndexExists: true`; ghi `dbOk` |
| SM-05 | Teacher + code giả | *session not found* |
| DG-01 | Submit diagnostic khi `dbOk: true` | `/results` + `GET /api/teacher/session` 200; (SQL) 1 row `amc_sessions` |
| DG-02 | Submit khi `dbOk: false` | Grade API 500, không có row mới; E2E gated phải skip/fail precondition |
| TC-01 | Mở Teacher bằng code thật | Student snapshot + short code khớp |
| MX-01…04 | Grade K/4/8/10 + key panel | Generate + results đúng grade |
| HD-01 | Health sau PR Thọ | `okContent`, `okDb`, `dbError` khi fail (sanitized) |
| HD-02 | PIN rate-limit sau PR Thọ | 429 + `Retry-After` |

---

## 6. Rủi ro / hạn chế đã biết

- **P0 prod:** `dbOk: false` chặn lưu session (ghi nhận trong `150426.md`).
- UI chưa có `data-testid` — selector dễ gãy nếu copy đổi.
- Diagnostic / grade / roadmap có `maxDuration = 60`; Hobby Vercel timeout ~10s có thể làm generate/grade fail dù UI đúng — ghi thời gian và status nếu xảy ra.
- Không có API liệt kê `amc_sessions` → xác minh DB phụ thuộc quyền Supabase.
- `RUN_E2E=1` trên prod sẽ tạo session/learner thật và tốn token OpenAI. Nên dùng preview hoặc dữ liệu đánh dấu test.
- Rate-limit PIN trên prod dùng chung counter theo IP — không chạy `RUN_HARDENING` bừa trên prod.
- Nhánh `test/e2e-playwright` **chưa được push** (cần approval của user).

---

## 7. Mẫu báo cáo lỗi (bug report)

```markdown
### [BUG] <tiêu đề ngắn, 1 câu>

- **Mức độ:** Blocker / High / Medium / Low
- **Môi trường:** Production https://adative-math-coach.vercel.app  |  Preview <url>  |  Local
- **Nhánh / commit:** (nếu biết)
- **Thời điểm:** YYYY-MM-DD HH:mm (Asia/Bangkok)
- **Health tại lúc repro:** `ok=…`, `dbOk=…`, `sessionStore=…`, `okContent=…`, `okDb=…`, `dbError=<redacted>`
  (đính kèm JSON đã redact; không dán key, URI có password, token)
- **Tester:** Nga

**Mô tả**
<hành vi thực tế vs kỳ vọng>

**Bước tái hiện (repro)**
1.
2.
3.

**Dữ liệu dùng**
- Route:
- Grade / jurisdiction:
- Session code / learner code (nếu có):
- Có dùng API-key panel: có/không (không dán key)

**Kết quả thực tế**
- UI:
- HTTP status / body (redact):

**Kết quả kỳ vọng**

**Ảnh / HAR / trace**
- Không đính trace nếu có chứa API key trong input hoặc header.

**Gợi ý (không bắt buộc)**
- File / API liên quan:
```

---

## 8. Câu hỏi mở cho Hoàng / Thọ

1. **Xác minh `amc_sessions`:** Nga có được quyền Supabase SQL (erin-forest) hoặc một cách đọc an toàn khác không? Hiện E2E chỉ verify qua `GET /api/teacher/session`.
2. Khi nào được phép chạy `RUN_E2E=1` trên **production** (tốn token, ghi session thật)? Có môi trường preview riêng không?
3. PR harden của Thọ (`dbError`, `okContent`/`okDb`, PIN rate-limit) đã/sẽ deploy ở đâu để Nga trỏ `BASE_URL` + `RUN_HARDENING=1`?
4. Có nên thêm `data-testid` (ví dụ `api-key-input`, `grade-{id}`, `start-diagnostic`, `session-code-input`) để ổn định selector?
5. Learner PIN + `/progress` có nằm trong vòng E2E tiếp theo không?



---

## 9. Vòng chạy production (cap Submit)

Khi chạy `RUN_E2E=1` trên **production**:

- Tối đa **2** lần bấm Submit diagnostic trên prod. File `diagnostic-submit.spec.ts` dùng 1 submit (Grade 4). `teacher-session.spec.ts` **tái sử dụng** session đã lưu trong `e2e-artifacts/e2e-prod-session.json`. `grade-matrix.spec.ts` chỉ **generate** (tới Question 1), không Submit.
- Không retry Playwright khi `RUN_E2E=1` (tránh Submit lần hai vì fail tạm thời).
- Trace / video / screenshot **tắt** khi `RUN_E2E=1` để không ghi OPENAI_API_KEY.
- App **không có** trường tên học sinh. Tag `e2e-test-<yyyyMMdd-HHmmss>` (Asia/Bangkok) chỉ là nhãn lần chạy trong artifact + báo cáo. Lọc DB theo `id` / `short_code`, không theo tên.
- `RUN_HARDENING=1` (PIN 429) không chạy mặc định trên prod.

