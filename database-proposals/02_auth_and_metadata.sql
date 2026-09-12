BEGIN;
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
COMMIT;
