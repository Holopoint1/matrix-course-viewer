# Supabase — Matrix LMS

Project: **Matrix LMS** · URL `https://ujrowwtkhmzoshvmujxw.supabase.co`
Plan & phases: see [`../EDITABLE-COURSE-PLAN.md`](../EDITABLE-COURSE-PLAN.md).

## Apply the schema (Phase 0)
1. Wait until the project finishes provisioning (Studio stops showing
   "Coming up… / Waiting for project…").
2. Studio → **SQL Editor** → paste all of `migrations/0001_init.sql` → Run.
   (Or push to `main`; the connected GitHub integration can apply it.)
3. Edit the `insert into public.editors …` block to list the real editor
   email(s) before/after running — only those can write.

## Keys — what goes where
| Key | Where it lives | Shared? |
|-----|----------------|---------|
| **Project URL** | client config (committed) | not secret |
| **anon public key** | client config (committed) | not secret — RLS is the guard |
| **service-role key** | local `supabase/.env` ONLY (gitignored) | **SECRET — never commit, never paste in chat** |

> ⚠️ The service-role key bypasses RLS. It is used **only** by the local
> one-time seed script, read from `supabase/.env`. Do not put it in any
> page, the repo, or a message.

`supabase/.env` (create locally, never committed):
```
SUPABASE_URL=https://ujrowwtkhmzoshvmujxw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=__paste_locally_only__
```

## Phase 1 — seed (later)
`seed/migrate.mjs` (to be added) will: render each `.docx` via the
mammoth + styleMap path in `assets/app.js`, import `.htm` pages, upload
`Media/` to the `course-media` Storage bucket (rewriting `file:///…` refs),
and insert rows. Runs locally once, reading `supabase/.env`. Nothing on
the live site changes until Phase 2 is reviewed.
