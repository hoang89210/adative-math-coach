# Deploy Adaptive Math Coach to Vercel

## Prerequisites

1. Vercel account: https://vercel.com
2. `OPENAI_API_KEY`
3. Vercel Blob store + `BLOB_READ_WRITE_TOKEN` (multi-user sessions)

## One-time setup

```bash
cd web
npm install
npm run build:catalog   # if standards-catalog.json missing
# math-index.json must exist in data/ (~73MB)
```

## Env vars (Vercel Project → Settings → Environment Variables)

| Name | Required | Notes |
|------|----------|--------|
| `OPENAI_API_KEY` | optional | Configured on the server. Used only with the **Không có key** button (`x-use-server-key: 1` + `ALLOW_SERVER_TEST_KEY=1`) or when `ALLOW_SERVER_KEY_FALLBACK=1`. Not a silent default. |
| `LLM_MODEL` | no | default `gpt-4o-mini` |
| `ALLOW_SERVER_TEST_KEY` | no | Test-only. Set to `1` to show the **Không có key** button and allow `x-use-server-key` requests to use `OPENAI_API_KEY`. Off by default. Requires `OPENAI_API_KEY`. Never expose the key to the client. |
| `ALLOW_SERVER_KEY_FALLBACK` | no | Off by default. If `1`, requests with no personal key and no `x-use-server-key` header may use `OPENAI_API_KEY`, still rate-limited. Leave unset unless you want the old silent fallback. |
| `SERVER_TEST_KEY_MAX_CALLS` | no | Per-IP cap for server-key calls (default `20`) |
| `SERVER_TEST_KEY_WINDOW_MS` | no | Window for that cap in ms (default `3600000` = 1 hour) |
| `BLOB_READ_WRITE_TOKEN` | optional | only if not using Supabase for sessions |
| `POSTGRES_URL` / `POSTGRES_PRISMA_URL` / `DATABASE_URL` | **yes on prod** | from Vercel ↔ Supabase Connect |

Users can paste an OpenAI key in the yellow **API key** panel (stored in browser `localStorage` only, sent as `x-openai-api-key`). Health: `env.hasOpenAiKey` means the server has `OPENAI_API_KEY` configured (not that it can be used without a header); `acceptsUserApiKey` means clients may send their own key; `serverTestKeyEnabled` means the test button is available; `serverKeyFallbackEnabled` is true only when `ALLOW_SERVER_KEY_FALLBACK=1` and a server key exist.

### Supabase sessions

1. Connect Supabase to the Vercel project (injects `POSTGRES_*`).
2. Run `supabase/migrations/001_amc_sessions_learners.sql` in Supabase SQL Editor (then `002_amc_rate_limits.sql` and `003_amc_lc_mastery.sql`; all are idempotent, and the app also runs `CREATE TABLE IF NOT EXISTS` for 002/003 on first use).
3. Redeploy. Health should show `sessionStore: "supabase"` and `dbOk: true`.

## Deploy with CLI

```bash
npm i -g vercel
cd web
vercel login
vercel          # preview
vercel --prod   # production
```

On Windows, if CLI fails with `EPERM symlink`, use **Dashboard import** instead (below) or run terminal **as Administrator** / enable Developer Mode.

### Deploy via Vercel Dashboard (recommended on Windows)

1. Push `web/` to GitHub (new repo)
2. https://vercel.com/new → **Import** that repo
3. Framework: Next.js · Root: `.` (if repo is only `web`)
4. Add env vars before deploy
5. Deploy

After first deploy:

1. Vercel dashboard → project → **Storage** → create **Blob**
2. Copy `BLOB_READ_WRITE_TOKEN` into Environment Variables (Production + Preview)
3. Redeploy

## GitHub (optional)

```bash
cd web
git init
git add .
git commit -m "Deploy Adaptive Math Coach"
# create GitHub repo, push
```

Import project in Vercel with **Root Directory** = `web` (if monorepo) or repo = `web` only.

## Tester links

- Student: `https://YOUR.app/`
- Teacher: `https://YOUR.app/teacher` (+ session code from results)
- Quality Lab: `https://YOUR.app/lab`

## Notes

- Hobby plan API timeout is ~10s; heavy LLM routes set `maxDuration = 60` (needs Pro for full effect).
- Do not commit `.env.local`.
- `data/sessions/` is local-only; production uses Blob when token is set.
