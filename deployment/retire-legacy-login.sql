SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
REVOKE ALL ON FUNCTION public.lookup_login_profile(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC,anon,authenticated;
