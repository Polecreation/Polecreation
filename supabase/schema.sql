create table if not exists public.probetraining_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null,
  last_name text not null,
  email text not null,
  birthdate date not null,
  phone text not null,
  appointment text not null,
  whatsapp_consent boolean not null default false,
  status text not null default 'new',
  source text not null default 'landingpage'
);

alter table public.probetraining_leads enable row level security;

create policy "Allow anonymous insert from landingpage"
on public.probetraining_leads
for insert
to anon
with check (true);
