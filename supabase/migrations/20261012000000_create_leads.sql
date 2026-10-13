-- Leads database, v1: website (Andi) leads + consent records.
--
-- Security model: the browser never talks to Supabase. Only server functions
-- (Vercel /api/*) connect, using the project's secret key, which bypasses RLS.
-- RLS is enabled with NO policies, so the public anon/publishable key can read
-- or write nothing, even if it leaks or someone wires it into a page by mistake.
--
-- Shared with the Finder (docs/FINDER_AGENT.md): `source` says which agent
-- produced the lead. Finder-only fields (judge output, enrichment) go in
-- `details` or in columns Zach adds in his own migration.

create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  client_ref        text unique,                 -- id the browser generated; makes retries idempotent
  source            text not null default 'website' check (source in ('website', 'finder')),
  status            text not null default 'new',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Primary contact
  first_name        text,
  last_name         text,
  phone             text,                        -- 10 digits, no formatting
  email             text,

  -- Address + territory
  street            text,
  city              text,
  state             text,
  zip               text,
  market            text,
  in_area           boolean,

  -- CRM card fields
  property_type     text,
  owner             boolean,
  windows           integer check (windows is null or windows between 0 and 500),
  windows_approx    boolean not null default false,
  doors             integer check (doors is null or doors between 0 and 100),
  window_age        text,
  window_age_years  integer,
  window_material   text,
  year_built        text,
  pains             text[] not null default '{}',
  timeline          text,
  project_details   text,

  -- Scoring
  score             integer check (score is null or score between 0 and 100),
  score_tier        text,
  score_flags       text[] not null default '{}',

  -- Appointment + routing
  appointment_type  text,
  appointment_date  date,
  appointment_slot  text,
  assigned_to       text,
  lead_source       text,
  source_breakdown  text,

  sms_consent       boolean not null default false,
  transcript        jsonb not null default '[]',
  details           jsonb not null default '{}'  -- source-specific extras
);

create index leads_created_at_idx on public.leads (created_at desc);
create index leads_status_idx     on public.leads (status);
create index leads_phone_idx      on public.leads (phone);

-- One row per consent capture: proof of what the homeowner agreed to, and when.
create table public.lead_consents (
  id               bigint generated always as identity primary key,
  lead_id          uuid not null references public.leads (id) on delete cascade,
  created_at       timestamptz not null default now(),
  phone            text,
  sms_consent      boolean not null,
  consent_version  text,                         -- which wording they saw (CONFIG.consentVersion)
  ip               text,
  user_agent       text
);

create index lead_consents_lead_id_idx on public.lead_consents (lead_id);

-- Keep updated_at current.
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute function public.touch_updated_at();

-- Insert a website lead and its consent record in one transaction.
-- A repeated client_ref returns the existing id and changes nothing, so a
-- client can't overwrite someone else's lead by reusing their id.
create function public.insert_website_lead(p_lead jsonb, p_consent jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
  r public.leads;
begin
  r := jsonb_populate_record(null::public.leads, p_lead);

  insert into public.leads (
    client_ref, source, status, first_name, last_name, phone, email,
    street, city, state, zip, market, in_area,
    property_type, owner, windows, windows_approx, doors, window_age, window_age_years,
    window_material, year_built, pains, timeline, project_details,
    score, score_tier, score_flags,
    appointment_type, appointment_date, appointment_slot, assigned_to, lead_source, source_breakdown,
    sms_consent, transcript
  ) values (
    r.client_ref, 'website', coalesce(r.status, 'new'), r.first_name, r.last_name, r.phone, r.email,
    r.street, r.city, r.state, r.zip, r.market, r.in_area,
    r.property_type, r.owner, r.windows, coalesce(r.windows_approx, false), r.doors, r.window_age, r.window_age_years,
    r.window_material, r.year_built, coalesce(r.pains, '{}'), r.timeline, r.project_details,
    r.score, r.score_tier, coalesce(r.score_flags, '{}'),
    r.appointment_type, r.appointment_date, r.appointment_slot, r.assigned_to, r.lead_source, r.source_breakdown,
    coalesce(r.sms_consent, false), coalesce(r.transcript, '[]')
  )
  on conflict (client_ref) do nothing
  returning id into v_id;

  if v_id is null then
    -- Duplicate submission: return the existing lead untouched.
    select id into v_id from public.leads where client_ref = r.client_ref;
    return v_id;
  end if;

  insert into public.lead_consents (lead_id, phone, sms_consent, consent_version, ip, user_agent)
  values (
    v_id,
    r.phone,
    coalesce((p_consent ->> 'sms_consent')::boolean, false),
    p_consent ->> 'consent_version',
    p_consent ->> 'ip',
    p_consent ->> 'user_agent'
  );

  return v_id;
end $$;

-- Lock everything down to the server's secret key (service_role).
alter table public.leads         enable row level security;
alter table public.lead_consents enable row level security;

revoke all on public.leads, public.lead_consents from anon, authenticated;
revoke execute on function public.insert_website_lead(jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.insert_website_lead(jsonb, jsonb) to service_role;
