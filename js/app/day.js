/* The driver's work day on this phone: vehicles driven, shift, today's records and the TDG balance.
 * A day has one shift segment per vehicle (MULTI_VEHICLE_PROPOSAL.md 3.1): Check-in starts the
 * day on the first vehicle, a vehicle switch closes one segment and opens the next, Check-out
 * ends the day. Records keep the current site's field names (getFormData / done in
 * js/app_supabase.js) so the rows, raw JSON and Daily Log payload match the print pages. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { store, nowHHMM, nowIso, uuid, normVeh } = App;
  const V = () => window.TDG_VOLUME;
  const DAY_KEY = "tdg_app_day_v2";
  const OLD_DAY_KEY = "tdg_app_day_v1";
  const RECORDS_KEY = "tdg_app_records_v1";

  const S = () => App.S;
  const ownerId = () => S().session.userId;

  // offDutyAt: when today's Off-Duty report was uploaded, seen after signing in again (RESUME_WORK_PROPOSAL.md).
  const newDay = (date, vehicle) => ({ date, vehicle: normVeh(vehicle), weekCycle: 1, segments: [], offDutyAt: "" });
  const newSegment = (vehicle, fields = {}) => ({
    vehicle, checkInTime: "", checkInAt: "", startKm: null, checkOutTime: "", checkOutAt: "", endKm: null,
    // Start KM of the current stretch: after coming back to a vehicle it is the End KM entered when
    // the driver left it, not the day's first Start KM (owner's correction, 2026-10-24).
    resumeKm: null,
    reportUploaded: false, updatedAt: "", snapshot: null, ...fields,
  });

  // Phase 1 kept one shift on the day itself; turn it into a segment.
  function upgrade(old) {
    const day = newDay(old.date, old.vehicle);
    day.weekCycle = old.weekCycle || 1;
    if (old.status && old.status !== "off") {
      day.segments.push(newSegment(day.vehicle, {
        checkInTime: old.checkInTime || "", checkInAt: old.checkInAt || "", startKm: old.startKm ?? null,
        checkOutTime: old.checkOutTime || "", checkOutAt: old.checkOutTime ? nowIso() : "", endKm: old.endKm ?? null,
        updatedAt: old.shiftUpdatedAt || "", snapshot: old.finalSnapshot || null,
      }));
    }
    return day;
  }

  function loadLocal(today) {
    const s = S();
    let saved = store.get(DAY_KEY);
    if (!saved && store.get(OLD_DAY_KEY)) saved = upgrade(store.get(OLD_DAY_KEY));
    s.records = store.get(RECORDS_KEY, []);
    // A day that was checked in stays open until Off-Duty, even past midnight; after Off-Duty the next date is a new day.
    if (saved && ((saved.segments.length && !(saved.offDutyAt && saved.date !== today)) || saved.date === today)) s.day = saved;
    else {
      s.day = newDay(today, s.session.vehicleNo);
      s.records = s.records.filter((r) => !r.synced);
    }
    s.openings = {};
  }

  function saveLocal() {
    store.set(DAY_KEY, S().day);
    store.set(RECORDS_KEY, S().records);
  }

  function clearLocal() {
    store.remove(DAY_KEY);
    store.remove(OLD_DAY_KEY);
    store.remove(RECORDS_KEY);
  }

  /* ---------------- shift segments ---------------- */
  const segments = () => S().day.segments;
  const segment = (vehicle = S().day.vehicle) => segments().find((g) => g.vehicle === vehicle) || null;
  const byTime = (key) => segments().filter((g) => g[key]).slice().sort((a, b) => String(a[key]).localeCompare(String(b[key])));

  // Odometer where the current stretch on a vehicle began (End KM must not be lower).
  const stretchStartKm = (g) => (g?.resumeKm != null ? g.resumeKm : g?.startKm);

  // off: not checked in · on: driving · out: day checked out.
  function status() {
    if (!segments().length) return "off";
    return segments().some((g) => !g.checkOutTime) ? "on" : "out";
  }
  // Whole-day shift (decision 1): first check-in; last check-out once every vehicle is checked out.
  const dayStart = () => byTime("checkInAt")[0]?.checkInTime || segments()[0]?.checkInTime || "";
  const offDutyDone = () => status() === "out" && !!S().day.offDutyAt;
  // Resume Work continues on the vehicle checked out last (decision 4).
  const lastOut = () => byTime("checkOutAt").at(-1) || segments().at(-1) || null;
  const dayEnd = () => (status() === "out" ? byTime("checkOutAt").at(-1)?.checkOutTime || segments().at(-1)?.checkOutTime || "" : "");

  /* ---------------- records and balance ---------------- */
  const sameVehicle = (r, v) => (V().getVehicleNo(r) || normVeh(r.vehicleNo)) === v;
  const recordsFor = (vehicle) => S().records.filter((r) => (V().getWorkDate(r) || r.date) === S().day.date && sameVehicle(r, vehicle));
  const contextRecords = () => recordsFor(S().day.vehicle);
  const deliveries = () => S().records.filter((r) => !V().isNonDeliveryEvent(r) && r.date === S().day.date);

  const openingFor = (vehicle) => {
    const o = S().openings[vehicle];
    return o && o.ready && o.date === S().day.date ? o : null;
  };
  // Balance of a vehicle now; null until its verified opening balance is loaded.
  function balance(vehicle = S().day.vehicle) {
    const o = openingFor(vehicle);
    return o ? App.data.computeRemaining(o.kg, recordsFor(vehicle)) : null;
  }

  // Same fields as getFormData() on the current site, for one vehicle of the day.
  function formData(vehicle = S().day.vehicle) {
    const s = S(), d = s.day, sess = s.session, g = segment(vehicle);
    const bal = balance(vehicle);
    const startKg = openingFor(vehicle) ? Math.max(0, Number(openingFor(vehicle).kg) || 0) : 0;
    const startKm = g?.startKm == null ? 0 : Number(g.startKm);
    const endKm = g?.endKm == null ? 0 : Number(g.endKm);
    return {
      driverNumber: sess.driverNumber || sess.username || "",
      driverName: sess.displayName || sess.username || "",
      date: d.date,
      vehicleNo: vehicle,
      startKm,
      endKm,
      totalKm: g?.startKm != null && g?.endKm != null && endKm >= startKm ? endKm - startKm : 0,
      tdgVolume: startKg,
      tdgStartVolume: startKg,
      currentTdgVolume: bal ? bal.remainingExactKg : 0,
      weekCycle: Number(d.weekCycle || 1),
      shiftTimeStart: dayStart(),
      shiftTimeFinish: dayEnd(),
      arrived: false,
      arrivalTime: "",
      accountNumber: "", accountName: "", accountAddress: "", accountCity: "", accountRoute: "",
      deliveredVolume: 0,
      notes: "",
      done: false,
      updatedAt: nowIso(),
    };
  }

  // A delivery record, as done() builds it on the current site.
  function buildDelivery({ customer, arrivalTime, lbs, notes, emergency }) {
    const d = {
      ...formData(),
      accountNumber: customer.accountNumber || "",
      accountName: customer.accountName || "",
      accountAddress: customer.accountAddress || "",
      accountCity: customer.city || "",
      accountRoute: customer.route || "",
      arrived: true,
      arrivalTime: arrivalTime || nowHHMM(),
      deliveredVolume: lbs,
      notes: notes || "",
      done: true,
    };
    d.shiftStart = dayStart();
    d.shiftFinish = dayEnd();
    d.completedAt = nowIso();
    d.clientRecordId = uuid();
    // Emergency Charge (ROUTE_PROPOSAL.md decisions 27-28): kept in raw; the old site ignores it.
    if (emergency) d.emergency = true;
    const after = App.data.computeRemaining(openingFor(S().day.vehicle).kg, [...contextRecords(), d]);
    d.remainingVolume = after.remainingExactKg;
    return d;
  }

  // Reload and TDG Adjustment events, as saveReloadEvent / saveTdgAdjustmentEvent build them.
  function buildEvent(fields) {
    const s = S(), sess = s.session, completedAt = nowIso();
    return {
      clientRecordId: uuid(),
      driverNumber: sess.driverNumber || sess.username || "",
      driverName: sess.displayName || sess.username || "",
      date: s.day.date,
      vehicleNo: s.day.vehicle,
      weekCycle: Number(s.day.weekCycle || 1),
      shiftStart: dayStart(),
      shiftFinish: dayEnd(),
      arrived: true,
      arrivalTime: nowHHMM(),
      completedAt,
      tdgVolume: Math.max(0, Number(openingFor(s.day.vehicle)?.kg) || 0),
      deliveredVolume: 0,
      done: true,
      updatedAt: completedAt,
      ...fields,
    };
  }

  // Queue a new record and show it at once.
  function addRecord(rec) {
    const s = S();
    rec.ownerId = ownerId();
    rec.synced = false;
    s.records.push(rec);
    App.outbox.add("record.insert", { row: App.data.recordRow(rec, ownerId()) }, { clientRecordId: rec.clientRecordId });
    // A vehicle's report is stale once it gets a new record.
    const g = segment(rec.vehicleNo);
    if (g) g.reportUploaded = false;
    saveLocal();
  }

  // Change a record: before upload, rewrite the queued insert; after upload, queue an update.
  function changeRecord(rec, change) {
    Object.assign(rec, change, { updatedAt: nowIso() });
    const queued = App.outbox.find((it) => it.kind === "record.insert" && it.meta.clientRecordId === rec.clientRecordId);
    if (queued) {
      App.outbox.update(queued.id, (it) => ({ ...it, payload: { row: App.data.recordRow(rec, ownerId()) } }));
    } else {
      // A record made on this phone has no raw copy yet: start from the raw its insert sent.
      const raw = { ...(rec.raw || App.data.recordRow(rec, ownerId()).raw), deliveredVolume: rec.deliveredVolume, notes: rec.notes || "" };
      if (rec.emergency) raw.emergency = true; else delete raw.emergency;
      rec.raw = raw;
      rec.synced = false;
      const patch = { delivered_volume: rec.deliveredVolume, notes: rec.notes || "", raw };
      // A second edit before the first one uploads replaces it (same expected server version).
      const pendingUpdate = App.outbox.find((it) => it.kind === "record.update" && it.meta.clientRecordId === rec.clientRecordId);
      if (pendingUpdate) App.outbox.update(pendingUpdate.id, (it) => ({ ...it, payload: { ...it.payload, patch } }));
      else App.outbox.add("record.update", { ownerId: ownerId(), clientRecordId: rec.clientRecordId, expectedUpdatedAt: rec.serverUpdatedAt, patch }, { clientRecordId: rec.clientRecordId });
    }
    const g = segment(rec.vehicleNo);
    if (g) g.reportUploaded = false;
    saveLocal();
  }

  // Called by the upload queue after each item is accepted by the server.
  function uploaded(item, result) {
    const s = S();
    if (!s) return;
    const id = item.meta?.clientRecordId;
    if (item.kind === "record.insert" || item.kind === "record.update") {
      const rec = s.records.find((r) => r.clientRecordId === id);
      const stillQueued = App.outbox.find((it) => it.meta?.clientRecordId === id);
      if (rec && result) Object.assign(rec, { remoteId: result.id, serverUpdatedAt: result.updated_at, synced: !stillQueued });
      // An edit queued while this upload was on its way applies to the version just saved.
      if (result) {
        for (const it of App.outbox.items()) {
          if (it.kind === "record.update" && it.meta?.clientRecordId === id) App.outbox.update(it.id, (x) => ({ ...x, payload: { ...x.payload, expectedUpdatedAt: result.updated_at } }));
        }
      }
    }
    if (item.kind.startsWith("shift.") && result?.work_date === s.day.date) {
      const g = segment(normVeh(result.vehicle_no));
      if (g) g.updatedAt = result.updated_at;
    }
    saveLocal();
  }

  // An item the upload queue dropped (js/app/outbox.js): an offline check-in that met a saved one
  // asks the driver; an edit shows the server's copy instead.
  function dropped(item, error) {
    const s = S();
    if (!s) return;
    if (item.kind === "shift.checkin") return App.flows.checkInConflict(item.payload.row, error.saved);
    const i = s.records.findIndex((r) => r.clientRecordId === item.meta?.clientRecordId);
    if (i < 0) return;
    const name = s.records[i].accountName;
    if (error.row) s.records[i] = App.data.recordFromRow(error.row);
    else s.records.splice(i, 1);
    saveLocal();
    App.render();
    App.showResult(false, "Change not saved", `${name}: ${error.message}`, `${error.row ? "The saved version is shown now" : "It is no longer on the server"}. Make the change again if it is still needed.`);
  }

  const pendingKinds = (kinds) => App.outbox.items().some((it) => kinds.includes(it.kind));

  // The day's segments as the server has them (another phone, a reinstall), keeping what only
  // this phone knows: End KM and whether each vehicle's report is uploaded.
  async function syncSegments() {
    const s = S(), d = s.day;
    const rows = await App.data.fetchShifts(ownerId(), d.date);
    const local = new Map(segments().map((g) => [g.vehicle, g]));
    d.segments = rows.map((row) => {
      const vehicle = normVeh(row.vehicle_no);
      const mine = local.get(vehicle) || newSegment(vehicle);
      return {
        ...mine, vehicle,
        checkInTime: row.check_in_time || "", checkInAt: row.check_in_at || "", startKm: Number(row.start_km),
        checkOutTime: row.check_out_time || "", checkOutAt: row.check_out_at || "", updatedAt: row.updated_at,
        endKm: row.check_out_time ? mine.endKm : null,
        resumeKm: row.check_out_time ? null : mine.resumeKm,
      };
    });
    const open = d.segments.find((g) => !g.checkOutTime);
    if (open) d.vehicle = open.vehicle;
    else if (d.segments.length && !segment(d.vehicle)) d.vehicle = d.segments.at(-1).vehicle;
    // From each vehicle's latest Daily Log: End KM and report state of checked-out vehicles, and
    // where the current stretch began on a vehicle the driver came back to.
    const allOut = d.segments.length > 0 && d.segments.every((g) => g.checkOutTime);
    const needsLogs = allOut || d.segments.some((g) => (g.checkOutTime && (g.endKm == null || !g.reportUploaded)) || (!g.checkOutTime && g.resumeKm == null));
    d.offDutyAt = "";
    if (needsLogs) {
      const logs = await App.data.fetchDailyLogs(ownerId(), d.date);
      // Off-Duty is done when the day's last report is an Off-Duty one ending at the last Check-out (by its
      // content: phone clocks are not compared with the server's). Then only Resume Work is offered.
      const last = logs.at(-1);
      if (allOut && last?.payload?.reason === "off_duty" && last.payload.shift?.finish === dayEnd()) d.offDutyAt = last.created_at;
      for (const g of d.segments) {
        const log = logs.filter((l) => normVeh(l.vehicle_no) === g.vehicle).at(-1);
        const loggedEnd = Number(log?.payload?.form?.endKm);
        if (!log || !(loggedEnd > 0)) continue;
        if (g.checkOutTime) {
          if (g.endKm == null) g.endKm = loggedEnd;
          if (!g.reportUploaded && String(log.created_at) >= String(g.checkOutAt)) g.reportUploaded = true;
        } else if (g.resumeKm == null && log.payload?.reason === "vehicle_switch") {
          g.resumeKm = loggedEnd;
        }
      }
    }
  }

  // Bring the phone up to date with the server: shift segments, week cycle, opening balance and
  // today's records.
  async function refreshFromServer() {
    const d = S().day;
    const jobs = [];
    if (!pendingKinds(["shift.checkin", "shift.checkout", "shift.reopen"])) jobs.push(syncSegments());
    jobs.push(App.data.loadWeekCycle(ownerId(), d.date).then((n) => { d.weekCycle = n; }));
    const results = await Promise.allSettled(jobs);
    await loadOpening();
    const pulled = await App.data.pullRecords(ownerId(), d.date).then(mergeRecords, (e) => e);
    saveLocal();
    App.render();
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
    if (pulled instanceof Error) throw pulled;
  }

  // Server rows win, except records with changes still waiting on this phone.
  function mergeRecords(serverList) {
    const s = S();
    const waiting = new Set(App.outbox.items().map((it) => it.meta?.clientRecordId).filter(Boolean));
    const local = new Map(s.records.map((r) => [r.clientRecordId, r]));
    const merged = serverList.map((r) => (waiting.has(r.clientRecordId) && local.has(r.clientRecordId) ? local.get(r.clientRecordId) : r));
    const onServer = new Set(serverList.map((r) => r.clientRecordId));
    for (const r of s.records) if (!onServer.has(r.clientRecordId) && waiting.has(r.clientRecordId)) merged.push(r);
    merged.sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
    s.records = merged;
  }

  // Opening balance of a vehicle for the day (whole fleet), kept per vehicle.
  async function loadOpening(vehicle = S().day.vehicle) {
    const s = S(), date = s.day.date;
    if (!vehicle) return;
    s.openings[vehicle] = { vehicle, date, ready: false, loading: true };
    App.render();
    try {
      const r = await App.data.loadOpeningBalance(ownerId(), vehicle, date);
      if (s.day.date !== date) return;
      s.openings[vehicle] = r.found && r.remainingKg != null
        ? { vehicle, date, ready: true, kg: Math.max(0, r.remainingKg), source: r.source }
        : { vehicle, date, ready: false, error: `No verified starting balance for ${vehicle}.` };
    } catch (error) {
      if (s.day.date !== date) return;
      s.openings[vehicle] = { vehicle, date, ready: false, error: `TDG balance not loaded: ${error.message}` };
    }
    App.render();
  }

  // Same fields as buildDailyPayload() on the current site, for one vehicle: its records only
  // (MULTI_VEHICLE_PROPOSAL.md 1.2 item 3). This is what the print pages read.
  function dailyPayload(reason, vehicle = S().day.vehicle) {
    const s = S(), form = formData(vehicle), bal = balance(vehicle) || App.data.computeRemaining(0, []);
    // At a vehicle switch the day goes on, so the whole-day Shift Finish is not known yet.
    if (reason === "vehicle_switch") form.shiftTimeFinish = "";
    return {
      kind: "tdg_daily_log",
      version: 1,
      reason: reason || "manual",
      savedAt: nowIso(),
      date: form.date,
      driver: { employeeNumber: s.session.username || form.driverNumber || "", driverName: s.session.displayName || form.driverName || "", role: s.session.role || "" },
      vehicleNo: vehicle,
      weekCycle: form.weekCycle,
      shift: { start: form.shiftTimeStart, finish: form.shiftTimeFinish },
      arriveState: { arrived: false, arrivalTime: "" },
      tdg: {
        base: bal.base, totalReloadKg: bal.totalReloadKg, totalAdjustmentLbs: bal.totalAdjustmentLbs,
        totalAdjustmentKg: bal.totalAdjustmentKg, totalDelivered: bal.totalDelivered, remaining: bal.remainingExactKg,
      },
      form,
      records: recordsFor(vehicle).map((r) => ({ ...r, synced: true })),
      meta: { skip_expand: true },
    };
  }

  // A vehicle's final report row. The id stays the same while the content is the same, so a
  // retry after a lost response is not saved twice (uploadFinalDailyLogAndOffDuty does this too).
  function reportRow(vehicle, reason) {
    const g = segment(vehicle);
    const payload = dailyPayload(reason, vehicle);
    const fp = JSON.stringify({ form: { ...payload.form, updatedAt: undefined }, shift: payload.shift, records: payload.records.map((r) => [r.clientRecordId, r.deliveredVolume, r.notes]) });
    if (!g.snapshot || g.snapshot.fp !== fp) g.snapshot = { id: uuid(), fp };
    saveLocal();
    return dailyRow(g.snapshot.id, payload);
  }

  function dailyRow(id, payload) {
    return {
      id, owner_id: ownerId(), log_date: payload.date || null,
      driver_employee_number: payload.driver.employeeNumber || "", driver_name: payload.driver.driverName || "",
      driver_role: payload.driver.role || "", vehicle_no: payload.vehicleNo || null, week_cycle: payload.weekCycle ?? null,
      payload,
    };
  }

  App.day = {
    newDay, newSegment, loadLocal, saveLocal, clearLocal, segments, segment, stretchStartKm, status, offDutyDone, lastOut, dayStart, dayEnd,
    recordsFor, contextRecords, deliveries, openingFor, balance, formData, buildDelivery, buildEvent,
    addRecord, changeRecord, uploaded, dropped, refreshFromServer, syncSegments, mergeRecords, loadOpening,
    dailyPayload, reportRow, dailyRow,
  };
})();
