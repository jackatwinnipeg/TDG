/* Website Today (mockups/web-v1): the TDG balance with its ledger line and the day's step chart, the shift,
 * every record of the day in one table, and today's route with its map. Every button is the app's own
 * action (data-action), so check-in, deliveries, reloads and Off-Duty go through the same flows and outbox.
 * Viewer and Manager keep the app's read-only Today for now (App.viewing). */
(() => {
  "use strict";
  const App = window.TDG_APP;
  if (!App.web) return;
  const { esc, fmtN, icon, kgToLbs, localDate, nowHHMM } = App;
  const V = () => window.TDG_VOLUME;
  const W = App.web$;
  const KG = App.KG_PER_LB;
  const mins = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; // taste-skill-ignore: a clock
  const byTime = (a, b) => (mins(a.arrivalTime) ?? 0) - (mins(b.arrivalTime) ?? 0);
  const kindOf = (r) => (V().getReloadAmountKg(r) > 0 ? "reload" : V().getAdjustmentAmountLbs(r) ? "adjust" : "delivery");

  // A vehicle's balance after each of its records today (whole kg shown, as the app rounds down);
  // null until the vehicle's verified opening balance is loaded.
  function ledger(vehicle) {
    const o = App.day.openingFor(vehicle);
    if (!o) return null;
    const recs = App.day.recordsFor(vehicle).slice().sort(byTime);
    let run = Number(o.kg) || 0;
    const after = new Map();
    for (const r of recs) {
      run += V().getReloadAmountKg(r) - (Number(r.deliveredVolume) || 0) * KG - V().getAdjustmentAmountLbs(r) * KG;
      after.set(r.clientRecordId, Math.max(0, run));
    }
    return { o, recs, after, bal: App.data.computeRemaining(o.kg, recs) };
  }

  function balancePanel() {
    const S = App.S, d = S.day, L = ledger(d.vehicle), o = S.openings[d.vehicle];
    if (!L) {
      return W.panel("wBalH", "TDG balance", `Truck ${esc(d.vehicle || "—")}`,
        `<div class="w-answer num">—<small>kg</small></div><p class="w-note">${esc(o?.loading ? "Loading the TDG balance…" : o?.error || "The TDG balance is not loaded yet.")}</p>`, { span: 8 });
    }
    const b = L.bal, open = Math.round(b.baseKg), rel = Math.round(b.totalReloadKg), adj = Math.round(b.totalAdjustmentKg);
    // the delivered kg as the line adds up (each part is rounded on its own)
    const del = open + rel - adj - b.remainingKg;
    const line = `<b>${fmtN(open)}</b> kg opening${rel ? ` + <b>${fmtN(rel)}</b> kg reload` : ""} − <b>${fmtN(del)}</b> kg delivered (${fmtN(b.totalDeliveredLbs)} lbs)${adj ? ` − <b>${fmtN(adj)}</b> kg adjustment` : ""} = <b>${fmtN(b.remainingKg)}</b> kg`;
    return W.panel("wBalH", "TDG balance", `Truck ${esc(d.vehicle)} · as of ${nowHHMM()}`,
      `<div class="w-answer num" id="tdgBalance">${fmtN(b.remainingKg)}<small>kg</small><span class="w-alt">${fmtN(kgToLbs(b.remainingExactKg))} lbs</span></div>
       <p class="w-ledger num">${line}</p>
       <div class="w-chart" id="wBalChart"></div>`, { span: 8 });
  }

  // A day's TDG balance as a step line (whole kg, rounded down as the app does), in five-minute steps
  // from the first whole hour; with open: until now, and the time after now left empty.
  App.webBalanceChart = (el, { base, records, open, start }) => {
    if (!el || !window.Charts) return;
    const recs = records.slice().sort(byTime);
    if (!recs.length && !(Number(base) > 0)) { el.innerHTML = '<p class="w-note">The line starts with the first record of the day.</p>'; return; }
    let run = Number(base) || 0;
    const after = recs.map((r) => (run += V().getReloadAmountKg(r) - (Number(r.deliveredVolume) || 0) * KG - V().getAdjustmentAmountLbs(r) * KG, Math.max(0, run)));
    const now = mins(nowHHMM()), times = recs.map((r) => mins(r.arrivalTime)).filter((m) => m != null);
    const startAt = start ?? times[0] ?? now;
    const endAt = open ? now : Math.max(startAt, ...times);
    const from = Math.floor(Math.min(startAt, ...times) / 60) * 60, to = Math.max(from + 60, Math.ceil((endAt + 1) / 60) * 60);
    const slots = [];
    for (let m = from; m <= to; m += 5) slots.push(m);
    const values = slots.map((m) => {
      if (open && m > now + 4) return null;
      const i = recs.findLastIndex((r) => (mins(r.arrivalTime) ?? 0) <= m);
      return i >= 0 ? after[i] : Number(base) || 0;
    });
    const step = slots.length > 120 ? 24 : 12, phone = window.innerWidth < 641;
    Charts.line(el, {
      labels: slots.map(clock), series: [{ name: "TDG balance", values }], step: true, height: phone ? 180 : 236,
      format: (v) => `${fmtN(Math.floor(v))} kg`, tickFormat: (v) => fmtN(v),
      annotations: recs.filter((r) => kindOf(r) === "reload").map((r) => ({
        at: Math.max(0, slots.findIndex((m) => m >= mins(r.arrivalTime))),
        label: `Reload +${fmtN(V().getReloadAmountKg(r))} kg${r.accountName ? ` at ${r.accountName}` : ""}`, short: `+${fmtN(V().getReloadAmountKg(r))} kg`,
      })),
      ...(open ? { today: Math.max(0, slots.findIndex((m) => m >= now)), todayLabel: `Now ${nowHHMM()}` } : {}),
      xAt: slots.map((m, i) => i).filter((i) => i % (phone ? step * 2 : step) === 0),
    });
  };
  function drawBalance() {
    const S = App.S, L = ledger(S.day.vehicle);
    if (!L) return;
    App.webBalanceChart(document.getElementById("wBalChart"), {
      base: L.o.kg, records: L.recs, open: S.day.date === localDate() && App.day.status() !== "out", start: mins(App.day.dayStart()),
    });
  }
  App.webKindOf = kindOf;

  function shiftPanel() {
    const d = App.S.day, st = App.day.status(), g = App.day.segment();
    const pill = { off: W.pill("Not checked in"), on: W.pill("On shift", "pos"), out: W.pill("Checked out") }[st];
    const from = App.day.stretchStartKm(g);
    const kv = (k, v) => `<div><dt>${k}</dt><dd class="num">${v}</dd></div>`;
    const dash = '<span class="w-dash" aria-label="not entered">—</span>';
    const action = {
      off: `<button class="btn btn-primary block" data-action="checkin">Check-in</button>`,
      on: `<button class="btn btn-outline block" data-action="checkout">Check-out</button>`,
      out: `<button class="btn btn-primary block" data-action="offduty">Off-Duty</button><p class="w-note">Uploads the final reports and signs you out.</p>`,
    }[st];
    const segs = App.day.segments();
    return W.panel("wShiftH", "Shift", "", `
      <div class="w-field"><label for="vehicleInput">Vehicle No</label>
        <input class="input veh" id="vehicleInput" value="${esc(d.vehicle)}" autocomplete="off" autocapitalize="characters" spellcheck="false" ${st === "out" ? "readonly" : ""} aria-describedby="vehHint">
        <span class="w-note" id="vehHint">${{ off: "The truck you are driving.", on: "To switch trucks, change the number here.", out: "The day is checked out." }[st]}</span></div>
      <dl class="w-kv">${kv("Check-in", App.day.dayStart() || dash)}${kv("Start KM", from != null ? fmtN(from) : dash)}${kv("End KM", g?.endKm != null ? fmtN(g.endKm) : dash)}${kv("Total KM", from != null && g?.endKm != null ? fmtN(g.endKm - from) : dash)}</dl>
      <div class="w-inline"><label for="weekCycle">Week cycle</label><select class="select" id="weekCycle">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option ${n === Number(d.weekCycle) ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      ${st === "off" ? "" : `<div class="w-inline"><span>Product</span><span style="display:flex;align-items:center;gap:8px;text-align:right"><b>${g?.product ? esc(App.productName(g.product)) : "Not chosen"}</b>${st === "on" ? ` <button class="btn btn-outline btn-sm" data-action="changeProduct">${g?.product ? "Change" : "Choose"}</button>` : ""}</span></div>`}
      ${segs.length > 1 ? `<h3 class="w-h3">Trucks today</h3>${segs.map((s) => `<div class="w-line"><span class="w-what">${esc(s.vehicle)}<small class="num">${esc(s.checkInTime)}–${esc(s.checkOutTime || "now")}${s.endKm != null ? ` · ${fmtN(s.endKm - s.startKm)} km` : ""}</small></span>${!s.checkOutTime ? W.pill("Driving", "pos") : s.reportUploaded ? W.pill("Report uploaded") : W.pill("Checked out")}</div>`).join("")}` : ""}
      <div class="w-foot">${action}</div>`, { span: 4, cls: "col", tools: pill });
  }

  function recordsPanel() {
    const S = App.S, date = S.day.date;
    const recs = S.records.filter((r) => (V().getWorkDate(r) || r.date) === date).slice().sort(byTime);
    const afterOf = new Map();
    for (const v of new Set(recs.map((r) => App.normVeh(V().getVehicleNo(r) || r.vehicleNo)))) {
      const L = ledger(v);
      if (L) for (const [k, kg] of L.after) afterOf.set(k, kg);
    }
    const dels = recs.filter((r) => kindOf(r) === "delivery");
    const lbs = dels.reduce((a, r) => a + (Number(r.deliveredVolume) || 0), 0);
    const reloads = recs.length - dels.length;
    const multi = new Set(recs.map((r) => r.vehicleNo)).size > 1;
    const row = (r) => {
      const k = kindOf(r), after = afterOf.get(r.clientRecordId);
      const what = k === "reload" ? `Reload${r.accountName ? ` at ${esc(r.accountName)}` : ""}` : k === "adjust" ? "TDG adjustment" : esc(r.accountName);
      const sub = [r.accountAddress, r.accountNumber, multi ? `truck ${r.vehicleNo}` : "", Number(r.deliveredVolume) === 0 && k === "delivery" ? "not delivered" : "", r.notes].filter(Boolean).map(esc).join(" · ");
      const amount = k === "reload" ? `+${fmtN(V().getReloadAmountKg(r))} kg` : k === "adjust" ? `${fmtN(V().getAdjustmentAmountLbs(r))} lbs` : `${fmtN(r.deliveredVolume)} lbs`;
      const open = k === "delivery" ? `data-action="editRecord" data-id="${esc(r.clientRecordId)}" tabindex="0"` : "";
      return `<tr class="${k === "delivery" ? "w-pick" : "w-event"}" ${open}>
        <td class="n num">${esc(r.arrivalTime)}</td>
        <td>${r.emergency ? `${W.pill("Emergency", "warn")} ` : ""}${what}<span class="w-sub2">${sub}${r.synced ? "" : " · waiting to upload"}</span></td>
        <td class="n num">${amount}<span class="w-ph w-sub2">${after != null ? `${fmtN(Math.floor(after))} kg left` : ""}</span></td>
        <td class="n num w-dt">${after != null ? `${fmtN(Math.floor(after))} kg` : '<span class="w-dash">—</span>'}</td></tr>`;
    };
    const body = recs.length ? `<div class="w-table"><table>
        <thead><tr><th class="n">Time</th><th>Customer</th><th class="n">Delivered</th><th class="n w-dt">Balance after</th></tr></thead>
        <tbody>${recs.map(row).join("")}</tbody></table></div>`
      : `<div class="w-empty">No deliveries yet today.${App.canRecord() && App.day.status() !== "out" ? " Add the first with Add delivery." : ""}</div>`;
    return W.panel("wDelH", "Deliveries", `${dels.length} ${dels.length === 1 ? "stop" : "stops"} · ${fmtN(lbs)} lbs${reloads ? ` · ${reloads} reload${reloads === 1 ? "" : "s"} or adjustment${reloads === 1 ? "" : "s"}` : ""}`,
      body, { span: 8, tools: recs.length ? `<button class="w-link" data-action="openDay" data-date="${esc(date)}" data-from="today">Today's report</button>` : "" });
  }

  function routePanel() {
    const RT = App.route, plan = RT.R().plan, day = RT.today();
    const list = plan ? RT.dayStops(plan, day) : [];
    if (!list.length) {
      return W.panel("wRtH", "Route", "", `<div class="w-empty">No route for today. Upload this week's delivery list on the Route page.</div>
        <div class="w-foot"><button class="btn btn-outline block" data-action="webGo" data-screen="route">Open Route</button></div>`, { span: 4, cls: "col" });
    }
    const L = RT.legs(plan, day), done = list.filter((s) => s.status === "done").length;
    const pend = L.rows.filter((r) => r.stop.status === "pending");
    const out = App.day.status() === "out";
    const next = pend.slice(0, 3);
    return W.panel("wRtH", "Route", `${done} of ${list.length} stops`, `
      <div class="w-progress" aria-hidden="true">${L.rows.map((r, i) => `<i class="${r.stop.status === "done" ? "done" : r === pend[0] ? "next" : ""}"></i>`).join("")}</div>
      <div class="w-mapbox">${RT.routeMap(plan, [day], App.S.session.userId)}</div>
      ${next.length ? `<h3 class="w-h3">Next</h3>${next.map((r) => `<div class="w-line"><span class="w-n">${L.rows.indexOf(r) + 1}</span><span class="w-what">${esc(r.stop.name)}<small>${esc(r.stop.addr || "")}</small></span><span class="w-leg num">${RT.fmtKm(r.m)} km<small>${Math.max(1, Math.round(r.s / 60))} min</small></span></div>`).join("")}`
        : `<p class="w-note">All of today's stops are delivered.</p>`}
      <div class="w-foot w-two">${pend[0] ? `<button class="btn btn-outline" data-action="navigate" data-id="${esc(pend[0].stop.id)}">${icon("nav", 16)} Navigate</button><button class="btn btn-outline" data-action="startStop" data-id="${esc(pend[0].stop.id)}" ${out ? "disabled" : ""}>Start delivery</button>` : ""}
        <button class="btn btn-outline" data-action="openRouteToday">Today's list</button><button class="btn btn-outline w-danger" data-action="deleteRoute" ${pend[0] ? "" : "disabled"}>${icon("trash", 16)} Delete Route</button></div>`,
      { span: 4, cls: "col", tools: `<button class="w-link" data-action="webGo" data-screen="route">Open</button>` });
  }

  function today() {
    const S = App.S, d = S.day;
    if (!App.canRecord()) return App.SCREENS.today();
    const st = App.day.status(), L = ledger(d.vehicle);
    const pend = (() => { const p = App.route.R().plan; return p ? App.route.dayStops(p, App.route.today()).filter((s) => s.status === "pending").length : 0; })();
    const sub = [
      `${App.weekday(d.date)} ${d.date}`,
      L ? `${fmtN(L.bal.remainingKg)} kg left on truck ${d.vehicle}` : d.vehicle ? `Truck ${d.vehicle}` : "",
      st === "off" ? "not checked in" : st === "out" ? "checked out" : `on shift since ${App.day.dayStart()}`,
      pend ? `${pend} stop${pend === 1 ? "" : "s"} to go` : "",
    ].filter(Boolean).map(esc).join(" · ");
    const stale = d.date !== localDate()
      ? `<div class="w-notice">Work day <b>${esc(d.date)}</b> is still open. ${st === "on" ? "Check out" : "Go Off-Duty"} to finish it before starting a new day.</div>` : "";
    const canAdd = st !== "out";
    return `
      ${W.title("Today", sub, `<button class="btn btn-outline" data-action="reload">${icon("plus", 16)} Reload</button><button class="btn btn-outline" data-action="adjust">Adjustment</button>${canAdd ? `<button class="btn btn-primary" data-action="addDelivery">${icon("plus", 16)} Add delivery</button>` : ""}`)}
      ${stale}
      ${App.routeUpload.todayCards()}
      <div class="w-grid">${balancePanel()}${shiftPanel()}${recordsPanel()}${routePanel()}</div>`;
  }

  App.WEB_SCREENS.today = today;
  App.webDraw("today", drawBalance);
})();
