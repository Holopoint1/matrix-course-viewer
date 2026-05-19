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
Supabase's new key names map to the old ones:
**publishable = old `anon`**, **secret = old `service_role`**.

| Key | Value | Where it lives | Shared? |
|-----|-------|----------------|---------|
| Project URL | `https://ujrowwtkhmzoshvmujxw.supabase.co` | client config (committed) | not secret |
| **Publishable** | `sb_publishable_cqfNgQceqbQFL5gsI_ageg_0rsi8RAA` | client config (committed) — Phase 2 | not secret; Supabase: "safe to share publicly" (RLS is the guard) |
| **Secret** (`sb_secret_…`) | local `supabase/.env` ONLY | seed script — Phase 1 | **SECRET — never commit, never paste in chat** |

> ⚠️ The secret key bypasses RLS. Used **only** by the local one-time seed
> script, read from `supabase/.env`. Never put it in a page, the repo, or
> a message.

`supabase/.env` (create locally, never committed):
```
SUPABASE_URL=https://ujrowwtkhmzoshvmujxw.supabase.co
SUPABASE_SECRET_KEY=__paste_locally_only__
```

## Phase 1 — seed (later)
`seed/migrate.mjs` (to be added) will: render each `.docx` via the
mammoth + styleMap path in `assets/app.js`, import `.htm` pages, upload
`Media/` to the `course-media` Storage bucket (rewriting `file:///…` refs),
and insert rows. Runs locally once, reading `supabase/.env`. Nothing on
the live site changes until Phase 2 is reviewed.
