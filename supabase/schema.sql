create extension if not exists pgcrypto;

create table if not exists public.probetraining_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_name text not null,
  last_name text not null,
  email text not null,
  birthdate date not null,
  phone text not null,
  appointment text not null,
  whatsapp_consent boolean not null default false,
  privacy_consent boolean not null default false,
  status text not null default 'new',
  source text not null default 'landingpage',
  automation_status text not null default 'pending',
  confirmation_sent_at timestamptz,
  admin_notification_sent_at timestamptz,
  email_error text
);

alter table public.probetraining_leads
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists privacy_consent boolean not null default false,
  add column if not exists automation_status text not null default 'pending',
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists admin_notification_sent_at timestamptz,
  add column if not exists email_error text;

alter table public.probetraining_leads enable row level security;

drop policy if exists "Allow anonymous insert from landingpage"
on public.probetraining_leads;

-- Leads are written by the Edge Function with the service role.
-- Anonymous direct inserts stay disabled to reduce spam and bypass attempts.

create index if not exists probetraining_leads_created_at_idx
on public.probetraining_leads (created_at desc);

create index if not exists probetraining_leads_appointment_status_idx
on public.probetraining_leads (appointment, status);

create table if not exists public.trial_dates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  date date not null,
  time time not null,
  label text not null,
  capacity integer not null default 8,
  active boolean not null default true,
  sort_order bigint not null default 0,
  unique (date, time)
);

alter table public.trial_dates
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists capacity integer not null default 8,
  add column if not exists active boolean not null default true,
  add column if not exists sort_order bigint not null default 0;

alter table public.trial_dates enable row level security;

grant select on table public.trial_dates to anon;
grant select, insert, update, delete on table public.trial_dates to service_role;

drop policy if exists "Allow public read of active trial dates"
on public.trial_dates;

create policy "Allow public read of active trial dates"
on public.trial_dates
for select
to anon
using (active = true);

-- Termine werden im Adminbereich gepflegt.
-- Keine festen Termine seeden, damit alte Probetrainingstage nicht wieder aktiv werden.

create index if not exists trial_dates_active_sort_idx
on public.trial_dates (active desc, sort_order asc, date asc, time asc);
