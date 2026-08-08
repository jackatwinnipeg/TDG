-- Applied to TDG_Log (mwuwsgxlcappifjwomkp) on 2026-08-08.
-- Removes user-editable metadata from admin authorization and hardens the
-- SECURITY DEFINER helper used by existing TDG RLS policies.

create or replace function public.is_admin(_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select _uid is not null
    and _uid = (select auth.uid())
    and exists (
      select 1
      from public.tdg_profiles as p
      where p.id = _uid
        and p.role = 'admin'
        and p.is_active = true
    );
$function$;

revoke all on function public.is_admin(uuid) from public;
revoke all on function public.is_admin(uuid) from anon;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_admin(uuid) to service_role;

drop policy if exists "admin full access" on public.tdg_user_profiles;
create policy "admin full access"
on public.tdg_user_profiles
as permissive
for all
to authenticated
using ((select public.is_admin((select auth.uid()))))
with check ((select public.is_admin((select auth.uid()))));

drop policy if exists "read own profile" on public.tdg_user_profiles;
create policy "read own profile"
on public.tdg_user_profiles
as permissive
for select
to authenticated
using ((select auth.uid()) = user_id);
