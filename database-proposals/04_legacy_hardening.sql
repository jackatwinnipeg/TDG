BEGIN;
DO $$DECLARE signature text;BEGIN
FOREACH signature IN ARRAY ARRAY['public.expand_daily_log_records()','public.sync_tdg_profile_username_driver_number()','public.sync_profile_name_fields()','public.set_updated_at()','public.normalize_customer_fields()'] LOOP
IF to_regprocedure(signature) IS NOT NULL THEN EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,public',signature);END IF;END LOOP;
IF to_regprocedure('public.is_admin_user()') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON FUNCTION public.is_admin_user() FROM PUBLIC,anon,authenticated';END IF;
END$$;
-- Never enable expand_daily_log_records: its legacy log_id dependency is absent.
COMMIT;
