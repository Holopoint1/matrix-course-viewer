-- ============================================================================
-- 0002_open_write.sql — TEMPORARY: open writes (no login phase)
--
-- The product currently has NO login ("everyone has access; logins come
-- later"). With editor-only RLS, anonymous edits are rejected, so course
-- edits could not reach Supabase. This swaps the editor-only WRITE
-- policies on courses/screens/pages for public WRITE so the open editor
-- works now.
--
-- ⚠️ SECURITY: while this is applied, anyone with the site URL can change
-- the live course database. This is the accepted interim trade-off. When
-- logins / Cloudflare Access return, run 0003 to restore editor-only
-- writes (re-create the "editor write" policies from 0001).
--
-- Idempotent: safe to re-run. Reads of `editors` stay locked; the editors
-- table itself is still only writable with the secret key.
-- ============================================================================

-- Replace editor-only write with public write on the three content tables.
drop policy if exists "editor write" on public.courses;
drop policy if exists "open write"   on public.courses;
create policy "open write" on public.courses for all
  using (true) with check (true);

drop policy if exists "editor write" on public.screens;
drop policy if exists "open write"   on public.screens;
create policy "open write" on public.screens for all
  using (true) with check (true);

drop policy if exists "editor write" on public.pages;
drop policy if exists "open write"   on public.pages;
create policy "open write" on public.pages for all
  using (true) with check (true);

-- (public.editors keeps its locked policy from 0001 — not opened here.)
-- (storage.objects media policies unchanged — still editor-only write.)
