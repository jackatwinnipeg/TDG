// Reconstruct a read-only schema snapshot locally; never connects to production.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const qi=s=>'"'+s.replaceAll('"','""')+'"';
(async()=>{
 const snapshot=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),db=new PGlite();
 await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;");
 for(const table of [...new Set(snapshot.columns.map(c=>c.table_name))]){
 const cols=snapshot.columns.filter(c=>c.table_name===table).map(c=>qi(c.column_name)+' '+c.data_type+(c.column_default?' DEFAULT '+c.column_default:'')+(c.is_nullable==='NO'?' NOT NULL':''));
 await db.exec('CREATE TABLE public.'+qi(table)+'('+cols.join(',')+');');
 }
 for(const fk of [false,true])for(const c of snapshot.constraints.filter(c=>c.definition.startsWith('FOREIGN')===fk))await db.exec('ALTER TABLE public.'+qi(c.table_name)+' ADD CONSTRAINT '+qi(c.conname)+' '+c.definition+';');
 for(const f of snapshot.functions)await db.exec(f.definition+';');
 for(const t of snapshot.triggers)await db.exec(t.definition+';');
 for(const p of snapshot.policies){await db.exec('ALTER TABLE public.'+qi(p.tablename)+' ENABLE ROW LEVEL SECURITY;CREATE POLICY '+qi(p.policyname)+' ON public.'+qi(p.tablename)+' AS '+p.permissive+' FOR '+p.cmd+' TO '+p.roles.map(qi).join(',')+(p.qual?' USING('+p.qual+')':'')+(p.with_check?' WITH CHECK('+p.with_check+')':'')+';');}
 for(const g of snapshot.grants)await db.exec('GRANT '+g.privilege_type+' ON public.'+qi(g.table_name)+' TO '+qi(g.grantee)+';');
 await db.exec("INSERT INTO auth.users VALUES('10000000-0000-0000-0000-000000000001','test@example.invalid');INSERT INTO tdg_profiles(id,username,driver_number,display_name,role,email) VALUES('10000000-0000-0000-0000-000000000001','testadmin','testadmin','Synthetic Admin','admin','test@example.invalid');INSERT INTO tdg_records(client_record_id,owner_id,work_date,vehicle_no) VALUES('legacy','10000000-0000-0000-0000-000000000001','2026-09-08','');INSERT INTO tdg_daily_logs(owner_id) VALUES('10000000-0000-0000-0000-000000000001');");
 const before=(await db.query('SELECT row_to_json(t) AS row FROM tdg_records t')).rows;
 for(const f of ['01_security.sql','02_auth_and_metadata.sql','04_legacy_hardening.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../database-proposals',f),'utf8'));
 assert.deepEqual((await db.query('SELECT row_to_json(t) AS row FROM tdg_records t')).rows,before);
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM tdg_daily_logs')).rows[0].n,1);
 const p=(await db.query("SELECT has_table_privilege('authenticated','tdg_profiles','UPDATE') AS promote,has_function_privilege('anon','lookup_login_profile(text)','EXECUTE') AS lookup")).rows[0];assert.equal(p.promote,false);assert.equal(p.lookup,false);
 await db.exec("SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);SET ROLE authenticated;INSERT INTO tdg_records(client_record_id,owner_id,work_date,vehicle_no,delivered_volume) VALUES('valid','10000000-0000-0000-0000-000000000001','2026-09-12','82303',1);RESET ROLE;");
 assert.equal((await db.query("SELECT driver_name FROM tdg_records WHERE client_record_id='valid'")).rows[0].driver_name,'Synthetic Admin');
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM tdg_private.record_audit')).rows[0].n,1);
 console.log('PASS real-schema reconstruction: columns, constraints, policies and active triggers');console.log('PASS three SQL patches apply locally without rewriting legacy business rows');console.log('PASS profile/anonymous access closed; validated record insert and audit succeed');await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
