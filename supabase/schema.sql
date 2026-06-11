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
  status text not null default 'new',
  source text not null default 'landingpage',
  automation_status text not null default 'pending',
  confirmation_sent_at timestamptz,
  admin_notification_sent_at timestamptz,
  email_error text
);

alter table public.probetraining_leads
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists automation_status text not null default 'pending',
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists admin_notification_sent_at timestamptz,
  add column if not exists email_error text;

alter table public.probetraining_leads enable row level security;

drop policy if exists "Allow anonymous insert from landingpage"
on public.probetraining_leads;

create policy "Allow anonymous insert from landingpage"
on public.probetraining_leads
for insert
to anon
with check (true);

create index if not exists probetraining_leads_created_at_idx
on public.probetraining_leads (created_at desc);
