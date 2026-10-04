-- SEO engine tables (created on first run by ensureSchema; safe to re-run).
create table if not exists seo_topics (
  id bigserial primary key, title text not null, keyword text not null, cluster text not null,
  source text not null, parent_slug text, angle text, score real not null default 1, base real not null default 1,
  status text not null default 'queued', reason text, slug text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists seo_topics_status on seo_topics(status, score desc);

create table if not exists seo_posts (
  slug text primary key, article_id text, title text not null, keyword text, cluster text, source text,
  parent_slug text, topic_id bigint, verify jsonb, published_at timestamptz not null default now());

create table if not exists seo_metrics_daily (
  day date not null, slug text not null, entry_visitors int not null default 0, pageviews int not null default 0,
  signup_visits int not null default 0, signups int not null default 0, ai_visitors int not null default 0,
  gsc_clicks int not null default 0, gsc_impressions int not null default 0, gsc_position real,
  primary key (day, slug));

create table if not exists seo_clusters (
  cluster text primary key, posts int not null default 0, signups int not null default 0,
  entry_visitors int not null default 0, weight real not null default 1, updated_at timestamptz not null default now());

create table if not exists seo_runs (
  id bigserial primary key, job text not null, ok boolean not null, detail jsonb, created_at timestamptz not null default now());
