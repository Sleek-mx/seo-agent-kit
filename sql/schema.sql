-- PostHog analytics kit: tables the snapshot script and dashboard libs use.
-- (The snapshot script also creates these on first run.)
create table if not exists web_analytics_snapshots (
  snapshot_date date not null,           -- Nairobi day
  channel_id text not null,              -- "default" in single-site mode
  project_id text not null,              -- PostHog project id
  visitors int not null default 0,       -- unique persons with a $pageview
  pageviews int not null default 0,
  sessions int not null default 0,
  signups int not null default 0,        -- user_signed_up
  onboarded int not null default 0,      -- onboarding_completed
  api_keys int not null default 0,       -- api_key_copied (rename to your activation event)
  captured_at timestamptz not null default now(),
  primary key (snapshot_date, channel_id)
);

create table if not exists web_referrer_snapshots (
  snapshot_date date not null,
  channel_id text not null,
  source text not null,                  -- session entry referring domain, or utm:<source>, or $direct
  visitors int not null default 0,
  signups int not null default 0,
  captured_at timestamptz not null default now(),
  primary key (snapshot_date, channel_id, source)
);

-- Optional, multi-site mode only: one row per site you track.
-- create table if not exists channels (
--   id text primary key,
--   name text not null,
--   posthog_project_id text,
--   posthog_host text default 'https://us.posthog.com'
-- );
