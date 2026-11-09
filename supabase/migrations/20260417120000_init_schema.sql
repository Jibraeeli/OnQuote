-- ============================================================================
-- OnQuote - initial schema (§1 of PLAN-BACKEND.md)
--
-- Creates: profiles, quote_jobs, usage_daily
-- Plus:    RLS policies, new-user trigger, updated_at trigger, usage-bump trigger
--
-- NOT included in this migration (on purpose): Storage bucket + policies (§2),
-- Edge Function routing (§3), cron jobs for retention (§2). Those land later.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- profiles
-- ============================================================================

create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  business_name    text         not null default '',
  trade            text         not null default 'plumber'
                     check (trade in ('plumber','electrician','hvac','roofer','handyman')),
  labour_hourly    numeric(8,2) not null default 65.00 check (labour_hourly >= 0),
  callout_fee      numeric(8,2) not null default 45.00 check (callout_fee >= 0),
  vat_registered   boolean      not null default true,
  vat_rate         numeric(5,2) not null default 0.20  check (vat_rate >= 0 and vat_rate <= 1),
  plan             text         not null default 'free' check (plan in ('free','pro')),
  daily_quote_cap  int          null check (daily_quote_cap is null or daily_quote_cap > 0),
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now()
);

comment on column public.profiles.daily_quote_cap is
  'Per-user override. NULL means use plan default (free=3, pro=30) resolved in edge function.';
comment on column public.profiles.vat_rate is
  'Stored as decimal (0.20 = 20%). Column is numeric(5,2) to leave headroom, not (4,3).';

alter table public.profiles enable row level security;

create policy profiles_self_select on public.profiles
  for select using (id = auth.uid());

create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Deliberately no insert policy: rows are created by the handle_new_user trigger
-- running as the table owner, bypassing RLS. Client inserts would fail.
-- Deliberately no delete policy: profile deletion cascades from auth.users deletion.

-- ============================================================================
-- quote_jobs
-- ============================================================================

create table public.quote_jobs (
  id               uuid         primary key default gen_random_uuid(),
  user_id          uuid         not null references public.profiles(id) on delete cascade,
  status           text         not null default 'pending'
                     check (status in ('pending','transcribing','generating','done','failed','unclear')),
  error_code       text         null
                     check (error_code is null or error_code in
                            ('OFFLINE','UNCLEAR','RATE_LIMIT','AI_ERROR','TIMEOUT')),
  error_message    text         null,
  trade            text         null,  -- snapshot; nullable because pending rows haven't snapshotted yet
  photo_paths      text[]       not null default '{}',
  voice_path       text         null,
  transcript       text         null,
  prompt_snapshot  jsonb        null,
  ai_json          jsonb        null,
  edits            jsonb        null,
  customer         jsonb        null,
  sent_at          timestamptz  null,
  model_used       text         null,
  input_tokens     int          null check (input_tokens is null or input_tokens >= 0),
  output_tokens    int          null check (output_tokens is null or output_tokens >= 0),
  audio_seconds    numeric(6,2) null check (audio_seconds is null or audio_seconds >= 0),
  cost_cents_gbp   int          null check (cost_cents_gbp is null or cost_cents_gbp >= 0),
  created_at       timestamptz  not null default now(),
  completed_at     timestamptz  null
);

create index quote_jobs_user_created_idx
  on public.quote_jobs (user_id, created_at desc);

create index quote_jobs_user_status_created_idx
  on public.quote_jobs (user_id, status, created_at);

alter table public.quote_jobs enable row level security;

create policy quote_jobs_self_select on public.quote_jobs
  for select using (user_id = auth.uid());

create policy quote_jobs_self_insert on public.quote_jobs
  for insert with check (user_id = auth.uid());

create policy quote_jobs_self_update on public.quote_jobs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy quote_jobs_self_delete on public.quote_jobs
  for delete using (user_id = auth.uid());

-- ============================================================================
-- usage_daily
-- ============================================================================

create table public.usage_daily (
  user_id         uuid  not null references public.profiles(id) on delete cascade,
  day             date  not null,
  quotes_count    int   not null default 0 check (quotes_count >= 0),
  failed_count    int   not null default 0 check (failed_count >= 0),
  cost_cents_gbp  int   not null default 0 check (cost_cents_gbp >= 0),
  primary key (user_id, day)
);

alter table public.usage_daily enable row level security;

create policy usage_daily_self_select on public.usage_daily
  for select using (user_id = auth.uid());

-- No insert/update/delete policies: client cannot write. Maintained by the
-- bump_usage trigger running as table owner (SECURITY DEFINER bypasses RLS).

-- ============================================================================
-- Trigger: create a profile row whenever a new auth.users row appears
-- ============================================================================

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Trigger: keep profiles.updated_at honest
-- ============================================================================

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Trigger: bump usage_daily when a quote_job completes successfully
--
-- Fires on UPDATE when status transitions to 'done'. Failed/unclear jobs do
-- NOT count against the user's daily quota (§4 of the plan). Uses SECURITY
-- DEFINER so it can write to usage_daily despite the client-blocking RLS.
-- ============================================================================

create function public.bump_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  completion_date date;
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    completion_date := (coalesce(new.completed_at, now()) at time zone 'utc')::date;

    insert into public.usage_daily (user_id, day, quotes_count, cost_cents_gbp)
    values (new.user_id, completion_date, 1, coalesce(new.cost_cents_gbp, 0))
    on conflict (user_id, day) do update
      set quotes_count   = usage_daily.quotes_count   + 1,
          cost_cents_gbp = usage_daily.cost_cents_gbp + excluded.cost_cents_gbp;

  elsif new.status = 'failed' and old.status is distinct from 'failed' then
    completion_date := (coalesce(new.completed_at, now()) at time zone 'utc')::date;

    insert into public.usage_daily (user_id, day, failed_count)
    values (new.user_id, completion_date, 1)
    on conflict (user_id, day) do update
      set failed_count = usage_daily.failed_count + 1;
  end if;

  return new;
end;
$$;

create trigger quote_jobs_bump_usage
  after update on public.quote_jobs
  for each row execute function public.bump_usage();
