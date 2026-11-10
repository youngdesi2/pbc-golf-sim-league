-- Pearl Bee Cave Winter Golf League: live score submission backend (Supabase / Postgres)
-- Run this whole file once in Supabase -> SQL Editor.
-- BEFORE RUNNING: set the admin names + passwords in the last block.
--
-- Security model
--   * Anyone with the site can READ scores (that is the point: everyone sees everything).
--   * Nobody can write directly. All writes go through the functions below, which check a PIN.
--   * Only the 3-4 league admins can write. Each admin has their own password (league_secrets rows named 'admin:<name>').
--   * Admins enter scores for the players, name the witness who watched the round, and can lock weeks,
--     delete scores, set pairings and tiebreaks.
--   * Every submission is appended to submission_log with the admin's name and the witness, so nothing is lost.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.league_secrets (
  name text primary key,
  hash text not null
);

create table if not exists public.submissions (
  week int not null check (week between 1 and 13),
  player_id text not null,
  holes jsonb not null,
  witness text,
  updated_at timestamptz not null default now(),
  primary key (week, player_id)
);

create table if not exists public.team_submissions (
  week int not null check (week between 1 and 13),
  team_key text not null,
  holes jsonb not null,
  witness text,
  updated_at timestamptz not null default now(),
  primary key (week, team_key)
);

create table if not exists public.week_meta (
  week int primary key check (week between 1 and 13),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.submission_log (
  id bigserial primary key,
  week int not null,
  who text not null,
  holes jsonb,
  by_admin boolean not null default false,
  admin_name text,
  witness text,
  action text not null default 'submit',
  at timestamptz not null default now()
);

alter table public.submissions      add column if not exists witness text;
alter table public.team_submissions add column if not exists witness text;
alter table public.submission_log   add column if not exists admin_name text;
alter table public.submission_log   add column if not exists witness text;

alter table public.league_secrets   enable row level security;  -- no policies: unreadable
alter table public.submissions      enable row level security;
alter table public.team_submissions enable row level security;
alter table public.week_meta        enable row level security;
alter table public.submission_log   enable row level security;

drop policy if exists "read all" on public.submissions;
drop policy if exists "read all" on public.team_submissions;
drop policy if exists "read all" on public.week_meta;
drop policy if exists "read all" on public.submission_log;
create policy "read all" on public.submissions      for select to anon, authenticated using (true);
create policy "read all" on public.team_submissions for select to anon, authenticated using (true);
create policy "read all" on public.week_meta        for select to anon, authenticated using (true);
create policy "read all" on public.submission_log   for select to anon, authenticated using (true);

-- ---------- helpers (not callable from the browser) ----------
create or replace function public._pin_ok(p_name text, p_pin text)
returns boolean language sql security definer stable
set search_path = public, extensions as $$
  select exists (select 1 from public.league_secrets s
                 where s.name = p_name and s.hash = extensions.crypt(p_pin, s.hash));
$$;

-- returns the admin's name for a password, or null
create or replace function public._admin_name(p_pin text)
returns text language sql security definer stable
set search_path = public, extensions as $$
  select substr(s.name, 7) from public.league_secrets s
  where s.name like 'admin:%' and s.hash = extensions.crypt(p_pin, s.hash)
  limit 1;
$$;

create or replace function public._valid_holes(p_holes jsonb, p_allow_pickup boolean)
returns boolean language plpgsql immutable as $$
declare e jsonb; n numeric;
begin
  if p_holes is null or jsonb_typeof(p_holes) <> 'array' or jsonb_array_length(p_holes) <> 18 then
    return false;
  end if;
  for e in select * from jsonb_array_elements(p_holes) loop
    if jsonb_typeof(e) = 'number' then
      n := (e #>> '{}')::numeric;
      if n < 1 or n > 20 or n <> floor(n) then return false; end if;
    elsif p_allow_pickup and e = '"P"'::jsonb then
      null;
    else
      return false;
    end if;
  end loop;
  return true;
end $$;

create or replace function public._week_locked(p_week int)
returns boolean language sql stable as $$
  select coalesce((select (data->>'locked')::boolean from public.week_meta where week = p_week), false);
$$;

revoke all on function public._pin_ok(text, text) from public, anon, authenticated;
revoke all on function public._admin_name(text) from public, anon, authenticated;

-- ---------- player functions ----------
create or replace function public.whoami(p_pin text)
returns text language sql security definer stable
set search_path = public, extensions as $$
  select coalesce(public._admin_name(p_pin), 'none');
$$;

create or replace function public.submit_round(p_pin text, p_week int, p_player text, p_holes jsonb, p_witness text default null)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare adm text;
begin
  adm := public._admin_name(p_pin);
  if adm is null then raise exception 'Wrong admin password'; end if;
  if p_week < 1 or p_week > 13 then raise exception 'Bad week number'; end if;
  if p_player is null or length(p_player) > 40 then raise exception 'Bad player'; end if;
  if p_witness is null or length(trim(p_witness)) = 0 then raise exception 'Pick the witness who watched this round'; end if;
  if p_witness = p_player then raise exception 'The witness cannot be the player'; end if;
  if not public._valid_holes(p_holes, true) then
    raise exception 'A scorecard needs 18 holes, each a whole number from 1 to 20 (or P for a pickup)';
  end if;
  insert into public.submissions(week, player_id, holes, witness)
  values (p_week, p_player, p_holes, p_witness)
  on conflict (week, player_id) do update set holes = excluded.holes, witness = excluded.witness, updated_at = now();
  insert into public.submission_log(week, who, holes, by_admin, admin_name, witness, action)
  values (p_week, p_player, p_holes, true, adm, p_witness, 'submit');
end $$;

create or replace function public.submit_team_round(p_pin text, p_week int, p_team text, p_holes jsonb, p_witness text default null)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare adm text;
begin
  adm := public._admin_name(p_pin);
  if adm is null then raise exception 'Wrong admin password'; end if;
  if p_week < 1 or p_week > 13 then raise exception 'Bad week number'; end if;
  if p_team is null or length(p_team) > 90 then raise exception 'Bad team'; end if;
  if p_witness is null or length(trim(p_witness)) = 0 then raise exception 'Pick the witness who watched this round'; end if;
  if not public._valid_holes(p_holes, false) then
    raise exception 'A team scorecard needs 18 holes, each a whole number from 1 to 20';
  end if;
  insert into public.team_submissions(week, team_key, holes, witness)
  values (p_week, p_team, p_holes, p_witness)
  on conflict (week, team_key) do update set holes = excluded.holes, witness = excluded.witness, updated_at = now();
  insert into public.submission_log(week, who, holes, by_admin, admin_name, witness, action)
  values (p_week, p_team, p_holes, true, adm, p_witness, 'submit-team');
end $$;

-- ---------- admin functions ----------
create or replace function public.admin_set_meta(p_pin text, p_week int, p_data jsonb)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  if public._admin_name(p_pin) is null then raise exception 'Wrong admin password'; end if;
  if p_week < 1 or p_week > 13 then raise exception 'Bad week number'; end if;
  insert into public.week_meta(week, data) values (p_week, coalesce(p_data, '{}'::jsonb))
  on conflict (week) do update set data = excluded.data, updated_at = now();
end $$;

create or replace function public.admin_delete_round(p_pin text, p_week int, p_player text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  if public._admin_name(p_pin) is null then raise exception 'Wrong admin password'; end if;
  delete from public.submissions where week = p_week and player_id = p_player;
  insert into public.submission_log(week, who, holes, by_admin, admin_name, action)
  values (p_week, p_player, null, true, public._admin_name(p_pin), 'delete');
end $$;

create or replace function public.admin_delete_team_round(p_pin text, p_week int, p_team text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  if public._admin_name(p_pin) is null then raise exception 'Wrong admin password'; end if;
  delete from public.team_submissions where week = p_week and team_key = p_team;
  insert into public.submission_log(week, who, holes, by_admin, admin_name, action)
  values (p_week, p_team, null, true, public._admin_name(p_pin), 'delete-team');
end $$;

grant execute on function public.whoami(text) to anon, authenticated;
drop function if exists public.submit_round(text, int, text, jsonb);
drop function if exists public.submit_team_round(text, int, text, jsonb);
grant execute on function public.submit_round(text, int, text, jsonb, text) to anon, authenticated;
grant execute on function public.submit_team_round(text, int, text, jsonb, text) to anon, authenticated;
grant execute on function public.admin_set_meta(text, int, jsonb) to anon, authenticated;
grant execute on function public.admin_delete_round(text, int, text) to anon, authenticated;
grant execute on function public.admin_delete_team_round(text, int, text) to anon, authenticated;

-- ---------- ADMINS: edit names + passwords, then run. One row per admin. ----------
-- Name is the part after 'admin:'. Add or remove rows for 3-4 admins. Re-run to change a password.
insert into public.league_secrets(name, hash) values
  ('admin:desi',   extensions.crypt('CHANGE-ME-1', extensions.gen_salt('bf'))),
  ('admin:admin2', extensions.crypt('CHANGE-ME-2', extensions.gen_salt('bf'))),
  ('admin:admin3', extensions.crypt('CHANGE-ME-3', extensions.gen_salt('bf'))),
  ('admin:admin4', extensions.crypt('CHANGE-ME-4', extensions.gen_salt('bf')))
on conflict (name) do update set hash = excluded.hash;
delete from public.league_secrets where name in ('player', 'admin');
