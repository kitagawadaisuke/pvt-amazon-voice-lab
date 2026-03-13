-- CompAI Database Schema for Supabase

-- Profiles (extends Supabase auth.users)
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  plan text default 'free' check (plan in ('free', 'standard')),
  stripe_customer_id text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Monitored URLs
create table public.monitored_urls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  url text not null,
  name text,
  check_interval text default 'weekly' check (check_interval in ('daily', 'weekly')),
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.monitored_urls enable row level security;
create policy "Users can manage own URLs" on public.monitored_urls for all using (auth.uid() = user_id);
create index idx_monitored_urls_user_id on public.monitored_urls(user_id);
create index idx_monitored_urls_active on public.monitored_urls(is_active) where is_active = true;

-- Snapshots
create table public.snapshots (
  id uuid primary key default gen_random_uuid(),
  url_id uuid references public.monitored_urls(id) on delete cascade not null,
  content_hash text,
  content_text text,
  screenshot_url text,
  captured_at timestamptz default now()
);

alter table public.snapshots enable row level security;
create policy "Users can view own snapshots" on public.snapshots for select
  using (url_id in (select id from public.monitored_urls where user_id = auth.uid()));
create index idx_snapshots_url_id on public.snapshots(url_id);

-- Changes (detected diffs)
create table public.changes (
  id uuid primary key default gen_random_uuid(),
  url_id uuid references public.monitored_urls(id) on delete cascade not null,
  snapshot_before_id uuid references public.snapshots(id),
  snapshot_after_id uuid references public.snapshots(id),
  diff_summary text,
  ai_analysis text,
  importance text check (importance in ('high', 'medium', 'low')),
  detected_at timestamptz default now()
);

alter table public.changes enable row level security;
create policy "Users can view own changes" on public.changes for select
  using (url_id in (select id from public.monitored_urls where user_id = auth.uid()));
create index idx_changes_url_id on public.changes(url_id);
create index idx_changes_detected_at on public.changes(detected_at);

-- Reports (sent email reports)
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  report_data jsonb,
  sent_at timestamptz,
  email_opened boolean default false,
  created_at timestamptz default now()
);

alter table public.reports enable row level security;
create policy "Users can view own reports" on public.reports for select using (auth.uid() = user_id);
create index idx_reports_user_id on public.reports(user_id);

-- Analysis Usage (使用量トラッキング)
create table public.analysis_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  asin text not null,
  product_name text,
  created_at timestamptz default now()
);

alter table public.analysis_usage enable row level security;
create policy "Users can view own usage" on public.analysis_usage for select using (auth.uid() = user_id);
create policy "Users can insert own usage" on public.analysis_usage for insert with check (auth.uid() = user_id);
create index idx_usage_user_month on public.analysis_usage(user_id, created_at);
