-- ============================================================================
-- 0001_init.sql — Matrix LMS editable-course schema + Row-Level Security
--
-- Apply via Supabase Studio → SQL Editor (paste & run), or let the connected
-- GitHub integration pick it up from supabase/migrations/.
-- Idempotent: safe to re-run.
--
-- Security model: anyone may READ content; only emails in public.editors
-- may WRITE. The anon key is public by design — RLS is the real guard.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---- Tables --------------------------------------------------------------
create table if not exists public.editors (
  email      text primary key,
  added_at   timestamptz not null default now()
);

create table if not exists public.courses (
  id                  text primary key,
  code                text,
  title               text,
  short_description   text,
  estimated_hours     numeric,
  certificate_enabled boolean default false,
  categories          jsonb   default '[]'::jsonb,
  kind                text,
  updated_at          timestamptz not null default now()
);

create table if not exists public.screens (
  id          text primary key,
  course_id   text not null references public.courses(id) on delete cascade,
  position    int  not null default 0,
  type        text,
  title       text,
  hours       numeric,
  equipment   text,
  src         text,
  body_html   text,            -- the editable worksheet/page HTML
  missing     boolean default false,
  updated_at  timestamptz not null default now()
);
create index if not exists screens_course_pos on public.screens(course_id, position);

create table if not exists public.pages (
  path        text primary key,   -- e.g. content/CO0002/welcome.html
  html        text,
  updated_at  timestamptz not null default now()
);

-- ---- updated_at trigger --------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists t_courses_touch on public.courses;
create trigger t_courses_touch before update on public.courses
  for each row execute function public.touch_updated_at();
drop trigger if exists t_screens_touch on public.screens;
create trigger t_screens_touch before update on public.screens
  for each row execute function public.touch_updated_at();
drop trigger if exists t_pages_touch on public.pages;
create trigger t_pages_touch before update on public.pages
  for each row execute function public.touch_updated_at();

-- ---- Editor check --------------------------------------------------------
-- SECURITY DEFINER so policies can read editors without exposing the table.
create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.editors
    where email = (select auth.jwt() ->> 'email')
  );
$$;
revoke all on function public.is_editor() from anon;
grant execute on function public.is_editor() to anon, authenticated;

-- ---- Row-Level Security --------------------------------------------------
alter table public.courses enable row level security;
alter table public.screens enable row level security;
alter table public.pages   enable row level security;
alter table public.editors enable row level security;

-- public READ of content
drop policy if exists "content read" on public.courses;
create policy "content read" on public.courses for select using (true);
drop policy if exists "content read" on public.screens;
create policy "content read" on public.screens for select using (true);
drop policy if exists "content read" on public.pages;
create policy "content read" on public.pages   for select using (true);

-- editor-only WRITE (insert/update/delete)
drop policy if exists "editor write" on public.courses;
create policy "editor write" on public.courses for all
  using (public.is_editor()) with check (public.is_editor());
drop policy if exists "editor write" on public.screens;
create policy "editor write" on public.screens for all
  using (public.is_editor()) with check (public.is_editor());
drop policy if exists "editor write" on public.pages;
create policy "editor write" on public.pages for all
  using (public.is_editor()) with check (public.is_editor());

-- editors list: only editors can read it; nobody can write it via the API
-- (no write policy ⇒ only the service-role key, used by the seed script,
--  can add/remove editors).
drop policy if exists "editors self read" on public.editors;
create policy "editors self read" on public.editors for select
  using (public.is_editor());

-- ---- Storage: media bucket ----------------------------------------------
insert into storage.buckets (id, name, public)
values ('course-media','course-media', true)
on conflict (id) do nothing;

drop policy if exists "media public read" on storage.objects;
create policy "media public read" on storage.objects for select
  using (bucket_id = 'course-media');
drop policy if exists "media editor write" on storage.objects;
create policy "media editor write" on storage.objects for all
  using (bucket_id = 'course-media' and public.is_editor())
  with check (bucket_id = 'course-media' and public.is_editor());

-- ---- Seed the editor allow-list -----------------------------------------
-- Replace / add the real editor emails (run again any time to add more).
insert into public.editors (email) values
  ('ad5046@gmail.com')
on conflict (email) do nothing;
