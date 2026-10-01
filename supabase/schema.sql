create table if not exists public.capital_os_sync (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.capital_os_sync enable row level security;

grant select, insert, update on public.capital_os_sync to authenticated;

drop policy if exists "Users can read their own sync data" on public.capital_os_sync;
create policy "Users can read their own sync data"
  on public.capital_os_sync for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own sync data" on public.capital_os_sync;
create policy "Users can create their own sync data"
  on public.capital_os_sync for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own sync data" on public.capital_os_sync;
create policy "Users can update their own sync data"
  on public.capital_os_sync for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.set_capital_os_sync_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_capital_os_sync_updated_at on public.capital_os_sync;
create trigger set_capital_os_sync_updated_at
  before update on public.capital_os_sync
  for each row execute function public.set_capital_os_sync_updated_at();