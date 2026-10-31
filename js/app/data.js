/* Supabase reads and the TDG rules shared with the current site (js/app_supabase.js).
 * Rows written here use exactly the old site's formats so both versions can run on the
 * same database (ANDROID_APP_PROPOSAL.md 3.9). */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { store, addDays, nowIso, parseLocalDate, localDate, normVeh } = App;
  const V = () => window.TDG_VOLUME;
  const sb = () => {
    const client = window.supabaseClient;
    if (!client?.from) throw new Error("Supabase is not ready");
    return client;
  };

  // Network trouble (retry later) vs. a refusal from the database (needs attention).
  function isTransient(result) {
    if (!result) return false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
    const status = Number(result.status ?? 0);
    const msg = String(result.error?.message || result.message || "");
    if (status === 0 || status === 401 || status === 408 || status === 429 || status >= 500) return true;
    return /failed to fetch|networkerror|load failed|network request failed|timed? ?out|aborted/i.test(msg);
  }
  // Supabase returns { error, status }; thrown errors (fetch failures) carry no status.
  function failure(result) {
    const error = new Error(result?.error?.message || result?.message || "Request failed");
    error.code = result?.error?.code || "";
    error.status = result?.status ?? 0;
    error.transient = isTransient(result);
    return error;
  }
  async function call(promise) {
    let result;
    try {
      result = await promise;
    } catch (thrown) {
      throw failure({ status: 0, message: thrown?.message || String(thrown) });
    }
    if (result.error) throw failure(result);
    return result;
  }

  /* ---------------- customers (REGION_PROPOSAL.md 3.3-3.5) ---------------- */
  // The phone keeps the current province's customers, plus those without a province yet (decision 11).
  // The first download of the day is complete; after that only customers changed since the last
  // download (decision 9). Customers from other provinces picked today are kept for the day.
  const CUSTOMERS_KEY = "tdg_app_customers_v2";
  const CUST_COLS = "id, account_number, account_name, account_address, city, route, province, lat, lng, geo_source, curb_bearing, curb_for, updated_at";
  const custCache = () => store.get(CUSTOMERS_KEY, null) || { prov: "", day: "", since: null, list: [], kept: [] };
  const toCustomer = (row) => ({
    id: row.id || "",
    accountNumber: row.account_number || "",
    accountName: row.account_name || "",
    accountAddress: row.account_address || "",
    city: row.city || "",
    route: row.route || "",
    province: row.province || "",
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    geoSource: row.geo_source || "",
    curb: row.curb_bearing ?? null, // the way to drive past with the customer on the right (decision 50)
    curbFor: row.curb_for || "",
    updatedAt: row.updated_at || null,
  });
  const byAccount = (a, b) => String(a.accountNumber).localeCompare(String(b.accountNumber));
  const latest = (rows, since) => rows.reduce((m, r) => (r.updated_at && (!m || r.updated_at > m) ? r.updated_at : m), since);
  const inProvince = (c, prov) => !prov || !c.province || c.province === prov;

  function cachedCustomers() {
    const c = custCache();
    const kept = c.day === localDate() ? (c.kept || []).filter((k) => !c.list.some((x) => x.accountNumber === k.accountNumber)) : [];
    return kept.length ? [...c.list, ...kept] : c.list;
  }
  // The Customers page: only the province's own, not the ones from other provinces kept for today.
  const provinceCustomers = () => custCache().list;
  const customersInfo = () => { const c = custCache(); return { prov: c.prov, day: c.day, count: c.list.length }; };

  // prov: the current province ("" downloads every customer, until a province is known).
  async function syncCustomers(prov = "", { full = false } = {}) {
    const c = custCache();
    const today = localDate();
    const query = () => sb().from("tdg_customers").select(CUST_COLS);
    if (full || c.prov !== prov || c.day !== today || !c.since) {
      let q = query();
      if (prov) q = q.filter("province", "in", `(${prov},"")`);
      const r = await window.TDG_CORE.paged(q.order("account_number", { ascending: true }));
      if (r.error) throw failure({ error: r.error, status: r.error.status ?? 0 });
      const list = r.data.map(toCustomer).sort(byAccount);
      store.set(CUSTOMERS_KEY, { prov, day: today, since: latest(r.data, null), list, kept: c.prov === prov && c.day === today ? c.kept || [] : [] });
      return { full: true, count: list.length };
    }
    // Every province here, so a customer moved to another province leaves this phone's list.
    const r = await window.TDG_CORE.paged(query().gte("updated_at", c.since).order("updated_at", { ascending: true }));
    if (r.error) throw failure({ error: r.error, status: r.error.status ?? 0 });
    if (!r.data.length) return { full: false, count: 0 };
    const map = new Map(c.list.map((x) => [x.accountNumber, x]));
    for (const cust of r.data.map(toCustomer)) {
      if (inProvince(cust, prov)) map.set(cust.accountNumber, cust);
      else map.delete(cust.accountNumber);
    }
    store.set(CUSTOMERS_KEY, { ...c, since: latest(r.data, c.since), list: [...map.values()].sort(byAccount) });
    return { full: false, count: r.data.length };
  }

  // A customer saved or deleted on this phone (Customers page) shows at once, before the next download.
  function putCustomer(cust, prov) {
    const c = custCache();
    const list = c.list.filter((x) => x.id !== cust.id && x.accountNumber !== cust.accountNumber);
    const kept = (c.kept || []).filter((x) => x.id !== cust.id && x.accountNumber !== cust.accountNumber);
    if (inProvince(cust, prov)) list.push(cust);
    else kept.push(cust);
    store.set(CUSTOMERS_KEY, { ...c, list: list.sort(byAccount), kept, day: c.day || localDate() });
  }
  function dropCustomer(id) {
    const c = custCache();
    store.set(CUSTOMERS_KEY, { ...c, list: c.list.filter((x) => x.id !== id), kept: (c.kept || []).filter((x) => x.id !== id) });
  }
  // A customer from another province picked today stays on this phone for the day (3.5).
  function keepCustomer(cust) {
    const c = custCache();
    if (c.list.some((x) => x.accountNumber === cust.accountNumber)) return;
    const today = localDate();
    const kept = (c.day === today ? c.kept || [] : []).filter((x) => x.accountNumber !== cust.accountNumber);
    store.set(CUSTOMERS_KEY, { ...c, day: c.day || today, kept: [...kept, cust] });
  }

  // Same rule as the current site: the keyword appears in account no., name, address, city or Route.
  function searchCustomers(list, q) {
    q = String(q || "").trim().toLowerCase();
    if (!q) return [];
    return list.filter((c) => [c.accountNumber, c.accountName, c.accountAddress, c.city, c.route]
      .some((v) => String(v || "").toLowerCase().includes(q)));
  }

  // "Search all provinces" (decision 8): one query, at most 20 customers.
  async function searchAllProvinces(q) {
    // Characters the filter syntax uses become wildcards: "St. Anne's" finds "St Anne's Rd".
    const term = String(q || "").trim().replace(/[,()*%\\"'.:]+/g, "*").replace(/^\*+|\*+$/g, "");
    if (!term) return [];
    const like = `*${term}*`;
    const { data } = await call(sb().from("tdg_customers").select(CUST_COLS)
      .or(["account_number", "account_name", "account_address", "city", "route"].map((c) => `${c}.ilike.${like}`).join(","))
      .order("account_name", { ascending: true }).limit(20));
    return (data || []).map(toCustomer);
  }

  // Every customer, for the Customers page's "All provinces" (Supervisor, Manager, Admin).
  async function fetchAllCustomers() {
    const r = await window.TDG_CORE.paged(sb().from("tdg_customers").select(CUST_COLS).order("account_number", { ascending: true }));
    if (r.error) throw failure({ error: r.error, status: r.error.status ?? 0 });
    return r.data.map(toCustomer).sort(byAccount);
  }

  /* ---------------- reload plants (REGION_PROPOSAL.md 3.6) ---------------- */
  // A few rows for the whole country: all of them are kept on the phone, so Reload works offline.
  const PLANTS_KEY = "tdg_app_reload_plants_v1";
  const toPlant = (row) => ({
    id: row.id, code: row.code || "", province: row.province || "", name: row.name || "", address: row.address || "",
    city: row.city || "", emails: row.receipt_emails || [], updatedAt: row.updated_at || "", updatedBy: row.updated_by_name || "",
  });
  const cachedPlants = () => store.get(PLANTS_KEY, []);
  const plantsIn = (prov) => cachedPlants().filter((p) => p.province === prov);
  async function syncPlants() {
    const { data } = await call(sb().from("tdg_reload_plants")
      .select("id, code, province, name, address, city, receipt_emails, updated_at, updated_by_name")
      .eq("active", true).order("code", { ascending: true }));
    const list = (data || []).map(toPlant);
    store.set(PLANTS_KEY, list);
    return list;
  }
  async function savePlant(f) {
    const args = { p_name: f.name, p_address: f.address, p_city: f.city, p_receipt_emails: f.emails };
    const { data } = await call(f.id
      ? sb().rpc("tdg_reload_plant_update", { p_id: f.id, ...args })
      : sb().rpc("tdg_reload_plant_add", { p_province: f.province, ...args }));
    await syncPlants().catch(() => {});
    return toPlant(data);
  }
  async function removePlant(id) {
    await call(sb().rpc("tdg_reload_plant_remove", { p_id: id }));
    await syncPlants().catch(() => store.set(PLANTS_KEY, cachedPlants().filter((p) => p.id !== id)));
  }

  /* ---------------- week cycle (tdg_user_settings) ---------------- */
  const CYCLE_KEY = "tdg_week_cycle_anchor_cache_v1";
  function weekStartMonday(date = new Date()) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  }
  function cycleFromAnchor(anchor, now = new Date()) {
    const start = parseLocalDate(anchor?.weekStart);
    const cycle = Number(anchor?.cycle);
    if (!start || !(cycle >= 1 && cycle <= 8)) return 1;
    const day = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const weeks = Math.floor((day(weekStartMonday(now)) - day(start)) / (7 * 24 * 3600 * 1000));
    return ((((cycle - 1 + weeks) % 8) + 8) % 8) + 1;
  }
  async function loadWeekCycle(ownerId, workDate) {
    let anchor = null;
    try {
      const { data } = await call(sb().from("tdg_user_settings")
        .select("week_cycle_anchor, week_cycle_anchor_week_start").eq("owner_id", ownerId).maybeSingle());
      if (data) {
        anchor = { cycle: Number(data.week_cycle_anchor), weekStart: data.week_cycle_anchor_week_start };
        store.set(CYCLE_KEY, { ...anchor, cachedAt: nowIso() });
      }
    } catch {
      anchor = store.get(CYCLE_KEY);
    }
    if (!anchor) anchor = { cycle: 1, weekStart: localDate(weekStartMonday()) };
    return cycleFromAnchor(anchor, parseLocalDate(workDate) || new Date());
  }
  function weekCycleRow(ownerId, cycle) {
    const weekStart = localDate(weekStartMonday());
    store.set(CYCLE_KEY, { cycle, weekStart, cachedAt: nowIso() });
    return { owner_id: ownerId, week_cycle_anchor: cycle, week_cycle_anchor_week_start: weekStart, updated_at: nowIso() };
  }

  /* ---------------- TDG balance (same rules as the current site) ---------------- */
  const integerPart = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

  function computeRemaining(baseKg, records) {
    const base = Math.max(0, Number(baseKg) || 0);
    const list = Array.isArray(records) ? records : [];
    const totalReloadKg = list.reduce((s, r) => s + V().getReloadAmountKg(r), 0);
    const totalAdjustmentLbs = list.reduce((s, r) => s + V().getAdjustmentAmountLbs(r), 0);
    const totalAdjustmentKg = totalAdjustmentLbs * App.KG_PER_LB;
    const totalDeliveredLbs = list.reduce((s, r) => s + (Number(r?.deliveredVolume ?? r?.delivered_volume) || 0), 0);
    const totalDeliveredKg = totalDeliveredLbs * App.KG_PER_LB;
    const calculated = base + totalReloadKg - totalDeliveredKg - totalAdjustmentKg;
    const remainingExactKg = Math.max(0, calculated);
    return {
      base, baseKg: base, totalReloadKg, totalAdjustmentLbs, totalAdjustmentKg,
      totalDelivered: totalDeliveredLbs, totalDeliveredLbs, totalDeliveredKg,
      remaining: integerPart(remainingExactKg), remainingKg: integerPart(remainingExactKg), remainingExactKg,
      remainingLbs: remainingExactKg / App.KG_PER_LB, calculatedRemainingExactKg: calculated,
    };
  }

  function balanceResult({ vehicleNo, targetDate, balanceDate, rows, baseTdgKg, source }) {
    const c = computeRemaining(baseTdgKg, rows);
    return {
      vehicleNo, targetDate, previousDate: balanceDate, balanceDate, found: true, recordCount: rows.length,
      baseTdgKg: c.baseKg, totalReloadKg: c.totalReloadKg, totalAdjustmentLbs: c.totalAdjustmentLbs,
      totalDeliveredLbs: c.totalDeliveredLbs, remainingKg: c.remainingExactKg, source, calculatedAt: nowIso(),
    };
  }

  // Opening balance for a vehicle on a work date, for the whole fleet (MULTI_VEHICLE_PROPOSAL.md
  // decision 3): every driver's records on the vehicle before that date, plus other drivers'
  // records on it that day. This driver's own records that day come from the phone.
  // Same reset and base rules as fetchPreviousDayTdgBalanceFromSupabase on the current site.
  async function fetchOpeningBalance(ownerId, vehicleNo, targetDate) {
    const resetDate = V().RESET_DATE;
    const previousDate = addDays(targetDate, -1);
    const usesReset = V().isResetVehicle(vehicleNo) && targetDate >= resetDate;
    const r = await window.TDG_CORE.paged(sb().rpc("tdg_vehicle_ledger", { p_vehicle_no: vehicleNo, p_to_date: targetDate })
      .order("work_date", { ascending: true })
      .order("completed_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }));
    if (r.error) throw failure({ error: r.error, status: r.error.status ?? 0 });
    const rows = r.data.filter((row) =>
      (!usesReset || row.work_date >= resetDate) &&
      (row.work_date < targetDate || (row.work_date === targetDate && row.owner_id !== ownerId)));
    if (usesReset) {
      const balanceDate = rows.reduce((latest, row) => (String(row.work_date || "") > latest ? String(row.work_date) : latest), resetDate);
      return balanceResult({ vehicleNo, targetDate, balanceDate, rows, baseTdgKg: 0, source: rows.length ? "fleet_since_reset" : "fleet_reset" });
    }
    let base = null;
    for (const row of rows) {
      const candidate = V().getTdgStartKg(row);
      if (candidate !== null && candidate !== undefined) { base = candidate; break; }
    }
    if (base == null || !Number.isFinite(Number(base))) {
      return { vehicleNo, targetDate, previousDate, balanceDate: previousDate, found: false, recordCount: rows.length, remainingKg: null, source: "fleet" };
    }
    return balanceResult({ vehicleNo, targetDate, balanceDate: previousDate, rows, baseTdgKg: base, source: "fleet" });
  }

  // With no connection, use the last opening balance for the same vehicle and date.
  async function loadOpeningBalance(ownerId, vehicleNo, targetDate) {
    const key = `tdg_app_opening_v1:${vehicleNo}`;
    try {
      const result = await fetchOpeningBalance(ownerId, vehicleNo, targetDate);
      store.set(key, result);
      return result;
    } catch (error) {
      const cached = store.get(key);
      if (cached && cached.targetDate === targetDate && cached.vehicleNo === vehicleNo) return { ...cached, source: "cache" };
      throw error;
    }
  }

  /* ---------------- shift (tdg_shift_sessions) ---------------- */
  const SHIFT_COLUMNS = "id, owner_id, work_date, driver_number, driver_name, vehicle_no, start_km, check_in_at, check_in_time, check_out_at, check_out_time, updated_at, product";
  // One row per vehicle driven that day (MULTI_VEHICLE_PROPOSAL.md section 4).
  async function fetchShifts(ownerId, workDate) {
    const { data } = await call(sb().from("tdg_shift_sessions").select(SHIFT_COLUMNS).eq("owner_id", ownerId).eq("work_date", workDate).order("check_in_at", { ascending: true }));
    return data || [];
  }
  async function fetchShift(ownerId, workDate, vehicleNo) {
    const { data } = await call(sb().from("tdg_shift_sessions").select(SHIFT_COLUMNS).eq("owner_id", ownerId).eq("work_date", workDate).eq("vehicle_no", vehicleNo).maybeSingle());
    return data;
  }
  // Latest Daily Log per vehicle that day: tells whether its report is uploaded and its End KM.
  async function fetchDailyLogs(ownerId, workDate) {
    const r = await window.TDG_CORE.paged(sb().from("tdg_daily_logs").select("id, vehicle_no, created_at, payload")
      .eq("owner_id", ownerId).eq("log_date", workDate).order("created_at", { ascending: true }));
    if (r.error) throw failure({ error: r.error, status: r.error.status ?? 0 });
    return r.data;
  }
  // A vehicle keeps only the day's last Off-Duty report (Resume Work decision 7, owner 2026-10-29).
  async function dropEarlierOffDuty(ownerId, workDate, vehicleNo, keepId) {
    const old = (await fetchDailyLogs(ownerId, workDate)).filter((l) => l.id !== keepId && l.payload?.reason === "off_duty" && normVeh(l.vehicle_no) === vehicleNo);
    for (const l of old) await call(sb().from("tdg_daily_logs").delete().eq("id", l.id).eq("owner_id", ownerId));
  }

  /* ---------------- records (tdg_records) ---------------- */
  // Same mapping as the current site's pullTodayRecordsFromSupabase.
  function recordFromRow(r) {
    const record = {
      ownerId: r.owner_id, serverUpdatedAt: r.updated_at, clientRecordId: r.client_record_id,
      driverNumber: r.driver_number, driverName: r.driver_name, date: r.work_date, vehicleNo: r.vehicle_no,
      weekCycle: r.week_cycle, shiftStart: r.shift_start, shiftFinish: r.shift_finish, arrivalTime: r.arrival_time,
      completedAt: r.completed_at, accountNumber: r.account_number, accountName: r.account_name,
      accountAddress: r.account_address, accountCity: r.account_city, accountRoute: r.account_route,
      tdgVolume: r.tdg_volume, deliveredVolume: Number(r.delivered_volume) || 0, notes: r.notes,
      emergency: r.raw?.emergency === true,
      raw: V().flattenRawRecord({ ...(r.raw || {}), date: r.work_date, vehicleNo: r.vehicle_no }) || r.raw || null,
      synced: true, remoteId: r.id,
    };
    if (V().isReloadRecord(record)) {
      Object.assign(record, { eventType: "reload", reloadAmountKg: V().getReloadAmountKg(record), adjustmentAmountLbs: 0, adjustmentReason: "" });
    } else if (V().isAdjustmentRecord(record)) {
      Object.assign(record, { eventType: "tdg_adjustment", reloadAmountKg: 0, adjustmentAmountLbs: V().getAdjustmentAmountLbs(record), adjustmentReason: V().getAdjustmentReason(record) });
    } else {
      Object.assign(record, { eventType: "", reloadAmountKg: 0, adjustmentAmountLbs: 0, adjustmentReason: "" });
    }
    return record;
  }

  async function pullRecords(ownerId, workDate) {
    const r = await window.TDG_CORE.paged(sb().from("tdg_records").select("*")
      .eq("owner_id", ownerId).eq("work_date", workDate).order("completed_at", { ascending: true }));
    if (r.error) throw failure({ error: r.error, status: r.error.status ?? 0 });
    return r.data.map(recordFromRow);
  }

  // History: this driver's records and shift rows between two dates (inclusive).
  async function fetchHistory(ownerId, from, to) {
    const [records, shifts] = await Promise.all([
      window.TDG_CORE.paged(sb().from("tdg_records").select("*").eq("owner_id", ownerId).gte("work_date", from).lte("work_date", to).order("completed_at", { ascending: true })),
      window.TDG_CORE.paged(sb().from("tdg_shift_sessions").select(SHIFT_COLUMNS).eq("owner_id", ownerId).gte("work_date", from).lte("work_date", to)),
    ]);
    if (records.error || shifts.error) { const e = records.error || shifts.error; throw failure({ error: e, status: e.status ?? 0 }); }
    return { records: records.data.map(recordFromRow), shifts: shifts.data };
  }

  // One past day: records, shift rows and Daily Logs (End KM of each vehicle).
  async function fetchDay(ownerId, date) {
    const [records, shifts, logs] = await Promise.all([pullRecords(ownerId, date), fetchShifts(ownerId, date), fetchDailyLogs(ownerId, date)]);
    return { records, shifts, logs };
  }

  // Same row as the current site's buildRecordRowForSupabase.
  function recordRow(rec, ownerId) {
    const tdgVolume = Number(rec.tdgVolume ?? rec.tdg_volume);
    return {
      client_record_id: rec.clientRecordId,
      owner_id: ownerId,
      driver_number: String(rec.driverNumber || ""),
      driver_name: String(rec.driverName || ""),
      work_date: rec.date || localDate(),
      vehicle_no: String(rec.vehicleNo || ""),
      week_cycle: rec.weekCycle ?? null,
      shift_start: rec.shiftStart || "",
      shift_finish: rec.shiftFinish || "",
      arrived: true,
      arrival_time: rec.arrivalTime || "",
      completed_at: rec.completedAt || nowIso(),
      account_number: rec.accountNumber || "",
      account_name: rec.accountName || "",
      account_address: rec.accountAddress || "",
      account_city: rec.accountCity || "",
      account_route: rec.accountRoute || "",
      tdg_volume: Number.isFinite(tdgVolume) && tdgVolume >= 0 ? tdgVolume : null,
      delivered_volume: Number(rec.deliveredVolume ?? 0) || 0,
      notes: rec.notes || "",
      raw: V().flattenRawRecord(rec),
    };
  }

  /* ---------------- writes used by the upload queue ---------------- */
  const sameRecord = (remote, row) =>
    ["work_date", "vehicle_no", "account_number", "notes"].every((k) => String(remote[k] ?? "") === String(row[k] ?? "")) &&
    Number(remote.delivered_volume) === Number(row.delivered_volume) &&
    V().getReloadAmountKg(remote) === V().getReloadAmountKg(row) &&
    V().getAdjustmentAmountLbs(remote) === V().getAdjustmentAmountLbs(row);

  async function updateShift(existing, patch, what) {
    const { data } = await call(sb().from("tdg_shift_sessions").update(patch)
      .eq("id", existing.id).eq("updated_at", existing.updated_at).select(SHIFT_COLUMNS).maybeSingle());
    if (!data) throw Object.assign(new Error(`${what} changed somewhere else at the same time. Try again.`), { transient: true });
    return data;
  }

  const writes = {
    // Insert once; a lost response is detected by client_record_id (as on the current site).
    async "record.insert"({ row }) {
      const first = await sb().from("tdg_records").insert(row).select("*").single();
      if (!first.error) return first.data;
      if (first.error.code !== "23505") throw failure(first);
      const { data } = await call(sb().from("tdg_records").select("*").eq("owner_id", row.owner_id).eq("client_record_id", row.client_record_id).maybeSingle());
      if (!data || !sameRecord(data, row)) throw Object.assign(new Error("A different record with the same ID is already on the server. Nothing was overwritten."), { transient: false });
      return data;
    },
    // Edit after upload: only if nobody changed the record since (same check as Current_Detail.html).
    async "record.update"({ ownerId, clientRecordId, expectedUpdatedAt, patch }) {
      const { data } = await call(sb().from("tdg_records").update(patch).eq("owner_id", ownerId)
        .eq("client_record_id", clientRecordId).eq("updated_at", expectedUpdatedAt).select("*").maybeSingle());
      if (data) return data;
      // Changed or deleted somewhere else: the server's copy stands (as in mergeRecords), this edit is dropped.
      const now = await call(sb().from("tdg_records").select("*").eq("owner_id", ownerId).eq("client_record_id", clientRecordId).maybeSingle());
      throw Object.assign(new Error("This delivery was changed or deleted somewhere else, so your change was not saved."), { transient: false, drop: true, row: now.data });
    },
    async "record.delete"({ ownerId, clientRecordId, expectedUpdatedAt }) {
      const { data } = await call(sb().from("tdg_records").delete().eq("owner_id", ownerId)
        .eq("client_record_id", clientRecordId).eq("updated_at", expectedUpdatedAt).select("id"));
      if (!data?.length) throw Object.assign(new Error("The record was changed or deleted somewhere else. Refresh and try again."), { transient: false });
      return data[0];
    },
    // Check-in on a vehicle: one row per driver, day and vehicle; a newer check-in on the
    // same vehicle replaces it (the driver confirmed). unseen: saved while today's check-ins could
    // not be read, so one found now is not replaced; the driver chooses (App.flows.checkInConflict).
    async "shift.checkin"({ row, unseen = false }) {
      const existing = await fetchShift(row.owner_id, row.work_date, row.vehicle_no);
      if (!existing) {
        const { data } = await call(sb().from("tdg_shift_sessions").insert(row).select(SHIFT_COLUMNS).single());
        return data;
      }
      if (unseen) throw Object.assign(new Error(`Today already has a check-in for ${row.vehicle_no}.`), { transient: false, drop: true, saved: existing });
      return updateShift(existing, { ...row, updated_at: nowIso() }, "Check-in");
    },
    async "shift.checkout"({ ownerId, workDate, vehicleNo, checkOutAt, checkOutTime }) {
      const existing = await fetchShift(ownerId, workDate, vehicleNo);
      if (!existing) throw Object.assign(new Error(`No check-in for ${vehicleNo} on the server for this day.`), { transient: false });
      return updateShift(existing, { check_out_at: checkOutAt, check_out_time: checkOutTime, updated_at: nowIso() }, "Check-out");
    },
    // Back on a vehicle driven earlier today: its shift is opened again (decision 2).
    async "shift.reopen"({ ownerId, workDate, vehicleNo }) {
      const existing = await fetchShift(ownerId, workDate, vehicleNo);
      if (!existing) throw Object.assign(new Error(`No check-in for ${vehicleNo} on the server for this day.`), { transient: false });
      return updateShift(existing, { check_out_at: null, check_out_time: null, updated_at: nowIso() }, "Return to vehicle");
    },
    // The product changed on Today (PRODUCTS_PROPOSAL.md decision 4).
    async "shift.product"({ ownerId, workDate, vehicleNo, product }) {
      const existing = await fetchShift(ownerId, workDate, vehicleNo);
      if (!existing) throw Object.assign(new Error(`No check-in for ${vehicleNo} on the server for this day.`), { transient: false });
      return updateShift(existing, { product, updated_at: nowIso() }, "Product");
    },
    async "settings.weekCycle"({ row }) {
      const { data } = await call(sb().from("tdg_user_settings").upsert(row, { onConflict: "owner_id" }).select("week_cycle_anchor").single());
      return data;
    },
    // Daily Log snapshot; the fixed id makes a retry after a lost response harmless.
    async "daily.insert"({ row }) {
      const first = await sb().from("tdg_daily_logs").insert(row).select("id").single();
      if (!first.error) return first.data;
      if (first.error.code !== "23505") throw failure(first);
      const { data } = await call(sb().from("tdg_daily_logs").select("id").eq("id", row.id).eq("owner_id", row.owner_id).single());
      return data;
    },
  };

  App.data = {
    isTransient, failure, call, CUST_COLS, toCustomer, cachedCustomers, provinceCustomers, customersInfo, syncCustomers, putCustomer, dropCustomer, keepCustomer,
    searchCustomers, searchAllProvinces, fetchAllCustomers, cachedPlants, plantsIn, syncPlants, savePlant, removePlant, loadWeekCycle, weekCycleRow, computeRemaining, integerPart,
    loadOpeningBalance, fetchOpeningBalance, fetchShift, fetchShifts, fetchDailyLogs, dropEarlierOffDuty, pullRecords, fetchHistory, fetchDay, recordFromRow, recordRow, writes, normVeh,
  };
})();
