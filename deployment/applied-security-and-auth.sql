SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';
-- Validated locally against the captured production schema, constraints, policies and active triggers.

CREATE SCHEMA IF NOT EXISTS tdg_private;
REVOKE ALL ON SCHEMA tdg_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA tdg_private TO authenticated;
CREATE OR REPLACE FUNCTION tdg_private.can_access(write_access boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$SELECT EXISTS(SELECT 1 FROM public.tdg_profiles p WHERE p.id=auth.uid() AND p.is_active AND NOT p.must_change_password AND (NOT write_access OR p.role IN ('driver','admin')))$$;
REVOKE ALL ON FUNCTION tdg_private.can_access(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION tdg_private.can_access(boolean) TO authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.tdg_profiles FROM anon,authenticated;
DO $$DECLARE p record;BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='tdg_profiles' LOOP EXECUTE format('DROP POLICY %I ON public.tdg_profiles',p.policyname);END LOOP;END$$;
CREATE POLICY profiles_read ON public.tdg_profiles FOR SELECT TO authenticated USING(id=auth.uid() OR public.is_admin(auth.uid()));
CREATE OR REPLACE FUNCTION public.tdg_driver_directory() RETURNS TABLE(id uuid,driver_number text,display_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$SELECT p.id,p.driver_number,p.display_name FROM public.tdg_profiles p WHERE tdg_private.can_access(false) AND p.is_active AND p.role='driver' ORDER BY p.driver_number,p.id$$;
REVOKE ALL ON FUNCTION public.tdg_driver_directory() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tdg_driver_directory() TO authenticated;
DO $$DECLARE t text;BEGIN
FOREACH t IN ARRAY ARRAY['tdg_records','tdg_daily_logs','tdg_shift_sessions','tdg_user_settings','tdg_customers','account_fill_log_profile','tdg_user_profiles','employee_profiles','user_roles','tdg_users','tdg_customers_staging'] LOOP
EXECUTE format('CREATE POLICY tdg_active_gate ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT tdg_private.can_access(false))) WITH CHECK((SELECT tdg_private.can_access(false)))',t);
EXECUTE format('REVOKE ALL ON public.%I FROM anon',t);EXECUTE format('REVOKE TRUNCATE,REFERENCES,TRIGGER ON public.%I FROM authenticated',t);
END LOOP;
FOREACH t IN ARRAY ARRAY['tdg_records','tdg_daily_logs','tdg_shift_sessions','tdg_user_settings','account_fill_log_profile'] LOOP
EXECUTE format('CREATE POLICY tdg_writer_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK((SELECT tdg_private.can_access(true)))',t);
EXECUTE format('CREATE POLICY tdg_writer_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING((SELECT tdg_private.can_access(true))) WITH CHECK((SELECT tdg_private.can_access(true)))',t);
EXECUTE format('CREATE POLICY tdg_writer_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING((SELECT tdg_private.can_access(true)))',t);
END LOOP;END$$;
CREATE POLICY fill_admin_insert ON public.account_fill_log_profile AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.is_admin(auth.uid()));
CREATE POLICY fill_admin_update ON public.account_fill_log_profile AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.is_admin(auth.uid())) WITH CHECK(public.is_admin(auth.uid()));
CREATE POLICY fill_admin_delete ON public.account_fill_log_profile AS RESTRICTIVE FOR DELETE TO authenticated USING(public.is_admin(auth.uid()));
-- Legacy login RPC is retired only after the new frontend is live.
CREATE TABLE tdg_private.admin_guard(singleton boolean PRIMARY KEY CHECK(singleton),active_count integer NOT NULL CHECK(active_count>0));
INSERT INTO tdg_private.admin_guard SELECT true,count(*) FROM public.tdg_profiles WHERE role='admin' AND is_active;
CREATE OR REPLACE FUNCTION tdg_private.guard_admin_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$DECLARE delta integer:=0;BEGIN
IF TG_OP IN ('UPDATE','DELETE') AND OLD.role='admin' AND OLD.is_active THEN delta:=delta-1;END IF;
IF TG_OP IN ('INSERT','UPDATE') AND NEW.role='admin' AND NEW.is_active THEN delta:=delta+1;END IF;
IF delta<>0 THEN UPDATE tdg_private.admin_guard SET active_count=active_count+delta WHERE singleton;END IF;
IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END$$;
CREATE TRIGGER tdg_last_admin AFTER INSERT OR UPDATE OR DELETE ON public.tdg_profiles FOR EACH ROW EXECUTE FUNCTION tdg_private.guard_admin_count();
DO $$DECLARE f record;BEGIN FOR f IN SELECT conname,conrelid::regclass AS rel FROM pg_constraint WHERE contype='f' AND confrelid='public.tdg_profiles'::regclass AND conrelid IN ('public.tdg_records'::regclass,'public.tdg_daily_logs'::regclass) LOOP
EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',f.rel,f.conname);EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY(owner_id) REFERENCES public.tdg_profiles(id) ON DELETE RESTRICT',f.rel,f.conname);END LOOP;END$$;
ALTER TABLE public.tdg_records ADD CONSTRAINT tdg_nonnegative CHECK(delivered_volume>=0 AND delivered_volume::text NOT IN ('NaN','Infinity','-Infinity')) NOT VALID;
ALTER TABLE public.tdg_records ADD CONSTRAINT tdg_vehicle_required CHECK(length(btrim(vehicle_no))>0) NOT VALID;
CREATE OR REPLACE FUNCTION tdg_private.guard_record() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$DECLARE p public.tdg_profiles;event text;amount numeric;BEGIN
IF TG_OP='UPDATE' AND (NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.client_record_id IS DISTINCT FROM OLD.client_record_id OR NEW.work_date IS DISTINCT FROM OLD.work_date OR NEW.vehicle_no IS DISTINCT FROM OLD.vehicle_no OR NEW.driver_number IS DISTINCT FROM OLD.driver_number OR NEW.driver_name IS DISTINCT FROM OLD.driver_name) THEN RAISE EXCEPTION 'Record identity is immutable';END IF;
IF TG_OP='INSERT' THEN SELECT * INTO STRICT p FROM public.tdg_profiles WHERE id=NEW.owner_id;NEW.driver_number:=p.driver_number;NEW.driver_name:=p.display_name;END IF;
NEW.updated_at:=clock_timestamp();NEW.raw:=coalesce(NEW.raw,'{}')||jsonb_build_object('ownerId',NEW.owner_id,'driverNumber',NEW.driver_number,'driverName',NEW.driver_name,'deliveredVolume',NEW.delivered_volume,'notes',NEW.notes);
event:=coalesce(NEW.raw->>'eventType','');IF event IN ('reload','tdg_adjustment','adjustment') THEN
IF NEW.delivered_volume<>0 THEN RAISE EXCEPTION 'Non-delivery event cannot have delivered volume';END IF;
amount:=CASE WHEN event='reload' THEN (NEW.raw->>'reloadAmountKg')::numeric ELSE (NEW.raw->>'adjustmentAmountLbs')::numeric END;
IF amount IS NULL OR amount<=0 OR amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Invalid event quantity';END IF;END IF;RETURN NEW;END$$;
CREATE TRIGGER tdg_record_guard BEFORE INSERT OR UPDATE ON public.tdg_records FOR EACH ROW EXECUTE FUNCTION tdg_private.guard_record();
CREATE TABLE tdg_private.record_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,table_name text,operation text,actor uuid,changed_at timestamptz DEFAULT clock_timestamp(),old_row jsonb,new_row jsonb);
CREATE OR REPLACE FUNCTION tdg_private.audit_record() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN
INSERT INTO tdg_private.record_audit(table_name,operation,actor,old_row,new_row) VALUES(TG_TABLE_NAME,TG_OP,auth.uid(),CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END);
IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END$$;
CREATE TRIGGER tdg_records_audit AFTER INSERT OR UPDATE OR DELETE ON public.tdg_records FOR EACH ROW EXECUTE FUNCTION tdg_private.audit_record();
CREATE TRIGGER tdg_daily_audit AFTER INSERT OR UPDATE OR DELETE ON public.tdg_daily_logs FOR EACH ROW EXECUTE FUNCTION tdg_private.audit_record();
CREATE POLICY shift_admin_read ON public.tdg_shift_sessions FOR SELECT TO authenticated USING(public.is_admin(auth.uid()));
REVOKE ALL ON ALL TABLES IN SCHEMA tdg_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION tdg_private.guard_admin_count(),tdg_private.guard_record(),tdg_private.audit_record() FROM PUBLIC,anon,authenticated;



CREATE TABLE tdg_private.login_attempts(key text PRIMARY KEY,window_start timestamptz NOT NULL,attempts integer NOT NULL);
CREATE OR REPLACE FUNCTION public.tdg_login_attempt(attempt_key text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$DECLARE n integer;BEGIN
IF attempt_key !~ '^[0-9a-f]{64}$' THEN RETURN false;END IF;
DELETE FROM tdg_private.login_attempts WHERE window_start<now()-interval '1 day';
INSERT INTO tdg_private.login_attempts AS a VALUES(attempt_key,now(),1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN a.window_start<now()-interval '15 minutes' THEN 1 ELSE a.attempts+1 END,window_start=CASE WHEN a.window_start<now()-interval '15 minutes' THEN now() ELSE a.window_start END RETURNING attempts INTO n;RETURN n<=20;END$$;
REVOKE ALL ON FUNCTION public.tdg_login_attempt(text) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.tdg_login_attempt(text) TO service_role;
CREATE OR REPLACE FUNCTION tdg_private.sync_auth_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN IF NEW.email IS DISTINCT FROM OLD.email THEN UPDATE public.tdg_profiles SET email=NEW.email,updated_at=clock_timestamp() WHERE id=NEW.id;END IF;RETURN NEW;END$$;
REVOKE ALL ON FUNCTION tdg_private.sync_auth_email() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER tdg_auth_email AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION tdg_private.sync_auth_email();
ALTER TABLE public.account_fill_log_profile ADD CONSTRAINT fill_account_unique UNIQUE(account_number);
-- Non-expiring reservations avoid overlapping stale credential workers.
CREATE TABLE tdg_private.account_operations(target_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,operation_id uuid UNIQUE NOT NULL,started_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE OR REPLACE FUNCTION public.tdg_acquire_account_operation(target_id uuid,operation_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$DECLARE n integer;BEGIN INSERT INTO tdg_private.account_operations VALUES(target_id,operation_token,clock_timestamp()) ON CONFLICT(target_user_id) DO NOTHING;GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;END$$;
CREATE OR REPLACE FUNCTION public.tdg_release_account_operation(target_id uuid,operation_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$DECLARE n integer;BEGIN DELETE FROM tdg_private.account_operations WHERE target_user_id=target_id AND operation_id=operation_token;GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;END$$;
REVOKE ALL ON FUNCTION public.tdg_acquire_account_operation(uuid,uuid),public.tdg_release_account_operation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tdg_acquire_account_operation(uuid,uuid),public.tdg_release_account_operation(uuid,uuid) TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA tdg_private FROM PUBLIC,anon,authenticated;



DO $$DECLARE signature text;BEGIN
FOREACH signature IN ARRAY ARRAY['public.expand_daily_log_records()','public.sync_tdg_profile_username_driver_number()','public.sync_profile_name_fields()','public.set_updated_at()','public.normalize_customer_fields()'] LOOP
IF to_regprocedure(signature) IS NOT NULL THEN EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,public',signature);END IF;END LOOP;
IF to_regprocedure('public.is_admin_user()') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON FUNCTION public.is_admin_user() FROM PUBLIC,anon,authenticated';END IF;
END$$;
-- Never enable expand_daily_log_records: its legacy log_id dependency is absent.

