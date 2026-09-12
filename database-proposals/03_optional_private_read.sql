-- Business choice: run only if cross-driver record visibility should be removed.
BEGIN;
CREATE POLICY records_private_read ON public.tdg_records AS RESTRICTIVE FOR SELECT TO authenticated USING(owner_id=auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY daily_private_read ON public.tdg_daily_logs AS RESTRICTIVE FOR SELECT TO authenticated USING(owner_id=auth.uid() OR public.is_admin(auth.uid()));
COMMIT;
