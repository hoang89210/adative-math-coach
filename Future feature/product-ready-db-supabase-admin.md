# Product-ready DB + Admin — Supabase Postgres

**Status:** Future feature (not current build priority)  
**Priority now:** Full Math K–12 on existing JSON indexes + session store  
**Stack decision:** Supabase Postgres + `/admin` app + Next.js on Vercel  
**Related app:** Adaptive Math Coach (`web/`)

## Goal

Move from file/Blob sessions to product-ready architecture:

1. Postgres (Supabase) as runtime source of truth  
2. Admin app at `/admin` (learners, sessions, mastery, coverage, ETL)  
3. Split **KG content (read-mostly)** vs **user/ops (read-write)**  
4. Migrate path from current JSON indexes  

## Architecture

```
LC JSONL / indexes → ETL scripts → content tables
                                      ↓ read
                              Next.js (Student | Teacher | Lab | Admin)
                                      ↓ read/write
                              user tables (learners, sessions, mastery, artifacts, audit)
```

| Layer | Tech |
|-------|------|
| App | Next.js `web/` @ Vercel |
| DB | Supabase Postgres |
| Admin auth | Supabase Auth + `admin_users` |
| Learner auth | public_code + PIN hash |
| LLM | OpenAI |

No Neo4j in this phase; coherence via `progressions` table.

## Schema (core)

### Content

- jurisdictions, grades  
- standards (id, code, jurisdiction_id, grade, description, subject)  
- domains, standard_domains  
- learning_components, component_standards  
- progressions (from_standard_id → to_standard_id, builds_towards)  
- misconceptions, misconception_targets  

### User / runtime

- learners (public_code, pin_hash, jurisdiction, current_grade)  
- sessions (learner_id, grade, percent, roadmap jsonb, coverage jsonb)  
- session_items (component_id, question_json, answer, correct)  
- component_mastery (learner_id, component_id, status, counts, last_at)  
- artifact_cache (session_id, kind, component_id, payload jsonb)  
- admin_users, audit_log, etl_runs  

## Mapping from current app

| Current | Prod |
|---------|------|
| data/sessions or Blob | sessions + artifact_cache + session_items |
| math-index.json | learning_components + component_standards |
| standards-catalog.json | standards + domains |
| progression-index.json | progressions |
| misconception index (future) | misconceptions + targets |
| learner PIN (future) | learners + component_mastery |

Repos layer: `src/lib/db`, `src/lib/repos/*`  
Flag: `DATA_BACKEND=file|supabase`

## ETL

1. Seed fast from `web/data/*.json`  
2. Later full JSONL import + jurisdiction  
3. `etl_runs` logging  
4. Admin button “Re-run ETL” (protected)  

## Admin `/admin` MVP

- Auth: Supabase email; invite-only admins  
- Modules: Dashboard, Learners, Sessions, Content (read-only), Coverage, ETL, Audit  
- APIs: `/api/admin/*` server-only; service role never in browser  
- RLS: content read via server; learners/sessions via server PIN/session APIs  

## Implement order (when this feature is prioritized)

| Phase | Work |
|-------|------|
| D0 | Supabase project + SQL migrations + seed admin |
| D1 | db client + repos + dual backend flag |
| D2 | ETL seed from indexes |
| D3 | Session save/load → Postgres |
| D4 | Learners PIN + mastery merge |
| D5 | /admin auth + dashboard + learners/sessions |
| D6 | Content browser + coverage + ETL status |
| D7 | Wire jurisdiction / misconception / coherence SQL |
| D8 | Vercel env + RLS review + backups |

## Env

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
OPENAI_API_KEY=
DATA_BACKEND=supabase
```

## Out of scope here

Neo4j, multi-school billing, public admin signup, full KG CMS edit, ELA schema.

## Done when

- Migrations apply clean  
- Diagnostic E2E persists to Postgres  
- Learner code merges 2 sessions  
- Admin can list learners/sessions  
- Prod checklist on Vercel + Supabase  

## Note

**Current build priority is Math K–12 product features on the existing stack**, not this DB migration. Start this doc when Math K–12 sprints S0–S5 are stable.
