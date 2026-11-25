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
| `OPENAI_API_KEY` | optional | Server fallback; users can paste their own key on the home page |
| `LLM_MODEL` | no | default `gpt-4o-mini` |
| `BLOB_READ_WRITE_TOKEN` | yes on prod | from Vercel Storage → Blob |

Users can paste an OpenAI key in the yellow **API key** panel (stored in browser `localStorage` only, sent as `x-openai-api-key`).

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
