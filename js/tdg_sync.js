/* ===============================
   DAILY SYNC (SUPABASE MASTER)
   =============================== */

function tdgToday() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function tdgPullKey(driverNumber) {
  return "tdg_last_pull_v1__" + (driverNumber || "unknown");
}

async function pullTodayRecordsFromSupabase() {
  const sb = window.supabaseClient;
  if (!sb) throw new Error("Supabase not ready");

  const sess = window.TDG_AUTH?.getSession?.();
  if (!sess?.userId) throw new Error("No login session");

  const today = tdgToday();

  const { data, error } = await sb
    .from("tdg_records")
    .select("*")
    .eq("owner_id", sess.userId)
    .eq("work_date", today)
    .order("completed_at", { ascending: true });

  if (error) throw error;

  const list = (data || []).map((r) => ({
    clientRecordId: r.client_record_id,
    driverNumber: r.driver_number,
    driverName: r.driver_name,

    date: r.work_date,
    vehicleNo: r.vehicle_no,

    weekCycle: r.week_cycle,
    shiftStart: r.shift_start,
    shiftFinish: r.shift_finish,

    arrivalTime: r.arrival_time,
    completedAt: r.completed_at,

    accountNumber: r.account_number,
    accountName: r.account_name,
    accountAddress: r.account_address,
    accountCity: r.account_city,
    accountRoute: r.account_route,

    tdgVolume: r.tdg_volume,
    deliveredVolume: r.delivered_volume,

    notes: r.notes,

    synced: true,
    remoteId: r.id,
  }));

  localStorage.setItem("tdg_records_v3", JSON.stringify(list));
  localStorage.removeItem("tdg_pending_sync_v1");

  return list;
}

async function ensureDailyPullAfterLogin() {
  const sess = window.TDG_AUTH?.getSession?.();
  if (!sess?.driverNumber) return;

  const today = tdgToday();
  const key = tdgPullKey(sess.driverNumber);

  const last = localStorage.getItem(key);

  if (last === today) {
    console.log("TDG daily pull already done");
    return;
  }

  console.log("TDG pulling today's records from Supabase...");

  const list = await pullTodayRecordsFromSupabase();

  localStorage.setItem(key, today);

  console.log("TDG sync finished:", list.length);
}

window.TDG_SYNC = {
  ensureDailyPullAfterLogin,
  pullTodayRecordsFromSupabase,
};