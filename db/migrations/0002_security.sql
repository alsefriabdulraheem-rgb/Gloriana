-- Defence in depth for Supabase deployments.
-- TREMLY's business logic runs server-side with a privileged connection (table owner / service role),
-- so the public PostgREST roles (anon, authenticated) must not be able to read or write anything directly.
-- Row Level Security is enabled on every table with NO permissive policies for those roles => deny by default.

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'alter default privileges in schema public revoke all on tables from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
    execute 'alter default privileges in schema public revoke all on tables from authenticated';
  end if;
end $$;

-- Read-only public catalogue view (safe to expose to anon if a future mobile client reads directly).
create or replace view public_salons as
  select s.id, s.slug, s.name_ar, s.name_en, s.audience, s.category, s.logo_url, s.cover_url, s.rating_avg, s.rating_count
  from salons s where s.status = 'approved';

-- Audit log is append-only.
create or replace function audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_logs is append-only'; end $$;
create trigger audit_immutable before update or delete on audit_logs for each row execute function audit_immutable();
