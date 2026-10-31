/* Viewer and Manager (ROLES_PROPOSAL.md decisions 15, 16, section 4.5): no recording and no Route.
 * Today and History start with a Driver picker and show that driver's day read-only. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { esc, fmtN, icon, kgToLbs, localDate, normVeh, device } = App;
  const V = () => window.TDG_VOLUME;
  const S = () => App.S;

  // People who record deliveries (section 4.4), loaded once.
  async function people() {
    const s = S();
    if (!s.people) {
      const { data } = await App.data.call(window.supabaseClient.rpc("tdg_people_directory"));
      s.people = data || [];
      const saved = device.get(`viewDriver:${s.session.userId}`);
      if (!s.people.some((p) => p.id === s.viewDriver)) s.viewDriver = s.people.some((p) => p.id === saved) ? saved : s.people[0]?.id || null;
    }
    return s.people;
  }

  // Whose days History shows: yourself, or the picked driver for Viewer and Manager.
  const mine = () => App.canRecord() && !S().viewOther;
  const ownerOf = () => (mine() ? S().session.userId : S().viewDriver);
  const viewedName = () => (mine() ? S().session.displayName : S().people?.find((p) => p.id === S().viewDriver)?.display_name || "");

  function driverSelect() {
    const list = S().people;
    if (!list) { people().then(App.render, (e) => { S().peopleError = e.message; App.render(); }); return `<div class="empty">${esc(S().peopleError || "Loading drivers…")}</div>`; }
    if (!list.length) return `<div class="empty">No drivers yet.</div>`;
    return `<div class="field" style="margin-bottom:12px"><label class="label" for="viewDriver">Driver</label>
      <select class="select" id="viewDriver">${list.map((p) => `<option value="${esc(p.id)}" ${S().viewDriver === p.id ? "selected" : ""}>${esc(p.display_name || p.driver_number)} · ${esc(p.driver_number)}</option>`).join("")}</select></div>`;
  }
  App.onChange.viewDriver = (t) => {
    const s = S();
    s.viewDriver = t.value;
    device.set(`viewDriver:${s.session.userId}`, t.value);
    s.viewToday = null;
    if (s.hist) { s.hist.data = null; s.hist.selected.clear(); }
    App.render();
  };

  // One driver's today from the server: shift rows, records and the open vehicle's balance.
  async function loadViewToday(ownerId) {
    const date = localDate();
    const [shifts, records] = await Promise.all([App.data.fetchShifts(ownerId, date), App.data.pullRecords(ownerId, date)]);
    const open = shifts.find((r) => !r.check_out_time);
    const vehicle = normVeh((open || shifts.at(-1))?.vehicle_no || records.at(-1)?.vehicleNo || "");
    let balance = null;
    if (vehicle) {
      const o = await App.data.fetchOpeningBalance(ownerId, vehicle, date);
      if (o.found && o.remainingKg != null) balance = App.data.computeRemaining(o.remainingKg, records.filter((r) => normVeh(r.vehicleNo) === vehicle));
    }
    return { ownerId, date, shifts, records, vehicle, balance };
  }

  function renderViewToday() {
    const s = S();
    const picker = driverSelect();
    if (!s.people?.length) return `<div class="page-h"><h1>Today</h1><span class="chip">View only</span></div>${picker}`;
    const v = s.viewToday;
    if (!v || v.ownerId !== s.viewDriver) {
      if (!s.viewLoading) {
        s.viewLoading = true;
        const id = s.viewDriver;
        loadViewToday(id).then((r) => { s.viewToday = r; }, (e) => { s.viewToday = { ownerId: id, error: navigator.onLine ? e.message : "No internet connection." }; })
          .finally(() => { s.viewLoading = false; App.render(); });
      }
      return `<div class="page-h"><h1>Today</h1><span class="chip">View only</span></div>${picker}<div class="empty">Loading…</div>`;
    }
    if (v.error) return `<div class="page-h"><h1>Today</h1><span class="chip">View only</span></div>${picker}<div class="empty">${esc(v.error)}</div>`;
    const seg = v.shifts.find((r) => normVeh(r.vehicle_no) === v.vehicle);
    const status = !v.shifts.length ? "off" : v.shifts.some((r) => !r.check_out_time) ? "on" : "out";
    const statusHtml = {
      off: `<span class="status off"><span class="dot"></span>Not checked in</span>`,
      on: `<span class="status on"><span class="dot"></span>On shift</span>`,
      out: `<span class="status out"><span class="dot"></span>Checked out</span>`,
    }[status];
    const start = v.shifts.map((r) => r.check_in_time).filter(Boolean).sort()[0] || "";
    const end = status === "out" ? v.shifts.map((r) => r.check_out_time).sort().at(-1) : "";
    const recs = v.records.filter((r) => !V().isNonDeliveryEvent(r)).sort((a, b) => String(b.arrivalTime).localeCompare(String(a.arrivalTime)));
    const emg = recs.filter((r) => r.emergency).length;
    const cycle = v.records.find((r) => r.weekCycle)?.weekCycle;
    return `
      <div class="page-h"><h1>Today</h1><span class="chip">View only</span></div>
      ${picker}
      <section class="card tdg-hero" aria-label="TDG balance">
        <div class="card-h"><h2>TDG Balance</h2><span class="chip veh-chip">${icon("truck", 14)} ${esc(v.vehicle || "—")}</span></div>
        <div class="tdg-big">${v.balance ? fmtN(v.balance.remainingKg) : "—"}<small>kg</small></div>
        <div class="num sub-line">${v.balance ? `${fmtN(kgToLbs(v.balance.remainingExactKg))} lbs · this truck` : "No TDG balance for today."}</div>
      </section>
      <section class="card" aria-label="Shift">
        <div class="status-row">${statusHtml}<span class="muted small num">${start ? `Shift ${esc(start)}–${esc(end || "now")}` : ""}</span></div>
        <div class="grid3">
          <div class="kmbox"><div class="k">Start KM</div><div class="v">${seg ? fmtN(seg.start_km) : "—"}</div></div>
          <div class="kmbox"><div class="k">Vehicles</div><div class="v">${v.shifts.length || "—"}</div></div>
          <div class="kmbox"><div class="k">Week Cycle</div><div class="v">${esc(cycle || "—")}</div></div>
        </div>
        ${seg?.product ? `<p class="muted small" style="margin:12px 0 0">Product: ${esc(App.productName(seg.product))}</p>` : ""}
        ${v.shifts.length > 1 ? `<p class="muted small" style="margin:12px 0 0">Vehicles today: ${v.shifts.map((r) => esc(r.vehicle_no)).join(", ")}</p>` : ""}
      </section>
      <section class="card" aria-label="Today's deliveries">
        <div class="card-h"><h2>Today's deliveries</h2><span class="muted small">${recs.length} · ${fmtN(recs.reduce((a, r) => a + (Number(r.deliveredVolume) || 0), 0))} lbs${emg ? ` · <b class="emg-count">${emg} emergency</b>` : ""}</span></div>
        ${recs.length ? recs.map((r) => `<div class="mini-row"><span class="num" style="width:44px;font-weight:700">${esc(r.arrivalTime)}</span>
          <span class="grow" style="min-width:0"><span class="ellipsis" style="display:block">${r.emergency ? `<span class="chip emg sm">${icon("siren", 11)} EMERGENCY</span> ` : ""}${esc(r.accountName)}</span><span class="small muted">${esc([r.accountAddress, r.accountCity].filter(Boolean).join(", "))}</span></span>
          <span class="num" style="font-weight:700">${fmtN(r.deliveredVolume)} lbs</span></div>`).join("") : `<p class="muted small" style="margin:0">No deliveries yet.</p>`}
        ${recs.length ? `<button class="btn btn-sm btn-outline block" style="margin-top:10px" data-action="openDay" data-date="${esc(v.date)}" data-from="today">${icon("file", 16)} Today's report</button>` : ""}
      </section>`;
  }

  App.viewing = { people, ownerOf, viewedName, mine, driverSelect, renderViewToday, loadDay: loadViewToday };
})();
