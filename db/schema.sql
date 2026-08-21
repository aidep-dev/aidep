-- aidep schema. Idempotent; applied by src/db/migrate.ts.
-- We store findings only, never source code: `matched` is the identifier that
-- hit, not the line it appeared on.

create table if not exists installations (
  id bigint primary key, -- GitHub installation id
  account_login text not null,
  suspended_at timestamptz,
  -- v1 billing is a hand-flipped flag; no Stripe
  paid boolean not null default false,
  created_at timestamptz not null default now()
);
alter table installations add column if not exists paid boolean not null default false;

create table if not exists repos (
  id bigint primary key, -- GitHub repo id
  installation_id bigint not null references installations(id) on delete cascade,
  owner text not null,
  name text not null,
  default_branch text not null default 'main',
  private boolean not null default false,
  config jsonb,
  onboarding_pr_number int,
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);
alter table repos add column if not exists private boolean not null default false;

create table if not exists scans (
  id bigserial primary key,
  repo_id bigint not null references repos(id) on delete cascade,
  head_sha text,
  status text not null default 'running', -- running | done | failed
  stats jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists findings (
  id bigserial primary key,
  repo_id bigint not null references repos(id) on delete cascade,
  scan_id bigint references scans(id) on delete set null,
  registry_id text not null,
  surface text not null,
  path text not null,
  line int not null,
  matched text not null,
  replacement_id text,
  dies date,
  dies_is_earliest boolean not null default false,
  status text not null default 'open', -- open | pr_open | resolved | ignored
  pr_id bigint,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (repo_id, registry_id, path, line, matched)
);

create table if not exists prs (
  id bigserial primary key,
  repo_id bigint not null references repos(id) on delete cascade,
  number int not null,
  deprecation_event text not null, -- registry row id the PR groups
  branch text not null,
  eval_status text not null default 'none', -- none | pending | held | drifted | inconclusive
  eval_summary jsonb,
  created_at timestamptz not null default now(),
  unique (repo_id, number)
);
-- set by the pull_request.closed handler; the funnel's "value delivered" step
alter table prs add column if not exists merged_at timestamptz;

-- fake-door signal: who clicked upgrade/start-free before billing exists
create table if not exists interest (
  id bigserial primary key,
  email text,
  source text not null, -- 'pricing-upgrade' | 'landing-waitlist' | ...
  context text,
  created_at timestamptz not null default now()
);

-- Mail sent, one row per (kind, recipient, subject), so a finding or a date
-- is announced once. Email is the only push channel; the address comes from
-- the repo's aidep.json (notify) or the waitlist form, never from GitHub.
create table if not exists notifications (
  id bigserial primary key,
  kind text not null, -- exposure | waitlist
  recipient text not null,
  subject_key text not null, -- exposure: repo_id:registry_id; waitlist: the dies date
  sent_at timestamptz not null default now(),
  unique (kind, recipient, subject_key)
);

create table if not exists meta (
  key text primary key,
  value text not null
);

-- Public exposure counts for the /dead page. GitHub code search allows 10
-- requests/minute, so a daily job snapshots them and the page renders the
-- snapshot with its timestamp. Never queried at request time.
create table if not exists exposure_counts (
  registry_id text primary key,
  query text not null,
  files int not null,
  counted_at timestamptz not null default now()
);

create table if not exists jobs (
  id bigserial primary key,
  type text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued', -- queued | running | done | failed
  run_after timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
-- set when a job is claimed; lets the cron drain recover jobs wedged in
-- 'running' by a crash between claim and complete/fail.
alter table jobs add column if not exists claimed_at timestamptz;
create index if not exists jobs_pending on jobs (run_after) where status = 'queued';
