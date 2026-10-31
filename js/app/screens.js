/* Screens: Today, Deliveries and More (from mockups/mobile-ui-v2.html). Route is in route*.js,
 * History in history.js and Customers in customers.js. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { esc, fmtN, icon, kgToLbs, localDate, initials } = App;

  /* ----- Today ----- */
  // Whole-day shift (MULTI_VEHICLE_PROPOSAL.md decision 1).
  function shiftText() {
    const start = App.day.dayStart();
    return start ? `Shift ${start}–${App.day.dayEnd() || "now"}` : "Shift —";
  }

  // Reload plants of the current province (REGION_PROPOSAL.md 3.6).
  function reloadLine() {
    const prov = App.S.loc?.prov;
    if (!prov) return "";
    const list = App.data.plantsIn(prov);
    if (!list.length) return `No reload plant for ${App.location.provName(prov)}`;
    return list.length === 1 ? `Reload at: ${list[0].name}` : `Reload plants: ${list.length} in ${App.location.provName(prov)}`;
  }

  function tdgCard() {
    const S = App.S, d = S.day, o = S.openings[d.vehicle];
    const bal = App.day.balance();
    let big, sub;
    if (bal) {
      big = `${fmtN(bal.remainingKg)}<small>kg</small>`;
      sub = `${fmtN(kgToLbs(bal.remainingExactKg))} lbs · this truck`;
    } else {
      big = `—<small>kg</small>`;
      sub = esc(o?.loading ? "Loading TDG balance…" : o?.error || "TDG balance not loaded.");
    }
    const plant = reloadLine();
    return `
      <section class="card tdg-hero" aria-label="TDG balance">
        <div class="card-h"><h2>TDG Balance</h2><span class="chip veh-chip">${icon("truck", 14)} ${esc(d.vehicle || "—")}</span></div>
        <div class="tdg-big" id="tdgBalance">${big}</div>
        <div class="num sub-line">${sub}</div>
        ${plant ? `<div class="small" style="margin-top:6px;opacity:.9">${esc(plant)}</div>` : ""}
        <div class="grid2" style="margin-top:12px">
          <button class="btn" data-action="reload">${icon("plus", 18)} Reload</button>
          <button class="btn" data-action="adjust">Adjustment</button>
        </div>
      </section>`;
  }

  function segmentsHtml() {
    const segs = App.day.segments();
    if (segs.length < 2) return "";
    return `
      <div class="segs">
        <div class="label">Vehicles today</div>
        ${segs.map((g) => {
          const cur = !g.checkOutTime;
          const km = g.endKm != null ? ` · ${fmtN(g.endKm - g.startKm)} km` : "";
          const state = cur ? `<span class="chip brand">Driving</span>` : g.reportUploaded ? `<span class="chip ok">Report uploaded</span>` : `<span class="chip">Checked out</span>`;
          return `<div class="seg ${cur ? "current" : ""}">
            <div class="seg-ic">${icon("truck", 20)}</div>
            <div class="grow"><b>${esc(g.vehicle)}</b><div class="small muted num">${esc(g.checkInTime)}–${esc(g.checkOutTime || "now")}${km}</div></div>
            ${state}
          </div>`;
        }).join("")}
      </div>`;
  }

  function shiftCard() {
    const d = App.S.day, st = App.day.status(), g = App.day.segment(), done = App.day.offDutyDone();
    const statusHtml = {
      off: `<span class="status off"><span class="dot"></span>Not checked in</span>`,
      on: `<span class="status on"><span class="dot"></span>On shift</span>`,
      out: `<span class="status out"><span class="dot"></span>${done ? `Off-Duty done ${esc(App.nowHHMM(new Date(d.offDutyAt)))}` : "Checked out"}</span>`,
    }[st];
    // The current stretch on this vehicle; the vehicle's whole day is in "Vehicles today".
    const from = App.day.stretchStartKm(g);
    const startKm = from != null ? fmtN(from) : "—";
    const endKm = g?.endKm != null ? fmtN(g.endKm) : "—";
    const totalKm = from != null && g?.endKm != null ? fmtN(g.endKm - from) : "—";
    let action = "";
    if (st === "off") action = `<button class="btn btn-ok block lg" data-action="checkin">Check-in</button>`;
    if (st === "on") action = `<button class="btn btn-outline block lg" data-action="checkout">Check-out</button>`;
    // Resume Work (RESUME_WORK_PROPOSAL.md, app only): reopens the day after a mistaken Check-out or Off-Duty.
    if (st === "out" && !done) action = `<button class="btn btn-primary block lg" data-action="offduty">Off-Duty</button>
      <p class="hint" style="text-align:center">Uploads the final reports and signs you out.</p>
      <button class="btn btn-outline block" data-action="resumeWork" style="margin-top:10px">Resume Work</button>`;
    if (done) action = `<button class="btn btn-primary block lg" data-action="resumeWork">Resume Work</button>
      <button class="btn btn-outline block" data-action="signOut" style="margin-top:10px">Sign out</button>
      <p class="hint" style="text-align:center">Today's reports are uploaded. Resume Work if you are still working.</p>`;
    const hint = { off: "Enter the truck you are driving.", on: "To switch vehicle, change the number here.", out: "The day is checked out." }[st];
    const start = App.day.dayStart();
    return `
      <section class="card" aria-label="Shift">
        <div class="status-row">${statusHtml}<span class="muted small num">${start ? `Day started ${esc(start)}` : ""}</span></div>
        <div class="field" style="margin-bottom:6px">
          <label class="label" for="vehicleInput">Vehicle No</label>
          <input class="input veh" id="vehicleInput" value="${esc(d.vehicle)}" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" ${st === "out" ? "readonly" : ""}>
          <p class="hint">${hint}</p>
        </div>
        <div class="grid3" style="margin-top:12px">
          <div class="kmbox"><div class="k">Start KM</div><div class="v">${startKm}</div></div>
          <div class="kmbox"><div class="k">End KM</div><div class="v">${endKm}</div></div>
          <div class="kmbox"><div class="k">Total KM</div><div class="v">${totalKm}</div></div>
        </div>
        <div class="cycle-row">
          <label class="label" for="weekCycle" style="margin:0">Week Cycle</label>
          <select class="select" id="weekCycle">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option ${n === Number(d.weekCycle) ? "selected" : ""}>${n}</option>`).join("")}</select>
        </div>
        ${st === "off" ? "" : `<div class="cycle-row">
          <span class="label" style="margin:0">Product</span>
          <b class="grow" style="text-align:right">${g?.product ? esc(App.productName(g.product)) : "Not chosen"}</b>
          ${st === "on" ? `<button class="btn btn-outline btn-sm" data-action="changeProduct">${g?.product ? "Change" : "Choose"}</button>` : ""}
        </div>`}
        ${action}
        ${segmentsHtml()}
      </section>`;
  }

  function renderToday() {
    const S = App.S, d = S.day;
    if (!App.canRecord()) return App.viewing.renderViewToday();
    const todays = App.day.deliveries().slice().reverse();
    const recent = todays.slice(0, 3);
    const stale = d.date !== localDate()
      ? `<div class="note-box">Work day <b>${esc(d.date)}</b> is still open. ${App.day.status() === "on" ? "Check out" : "Go Off-Duty"} to finish it before starting a new day.</div>` : "";
    return `
      <div class="page-h"><h1>Today</h1><span class="sub num">${shiftText()}</span></div>
      ${stale}
      ${App.routeUpload.todayCards()}
      ${tdgCard()}
      ${App.route.todayCard()}
      ${shiftCard()}
      <section class="card" aria-label="Today's deliveries">
        <div class="card-h"><h2>Today's deliveries</h2><span class="muted small">${todays.length} · ${fmtN(todays.reduce((a, r) => a + (Number(r.deliveredVolume) || 0), 0))} lbs</span></div>
        ${recent.length ? recent.map((r) => `
          <div class="mini-row">
            <span class="num" style="width:44px;font-weight:700">${esc(r.arrivalTime)}</span>
            <span class="grow ellipsis">${r.emergency ? `<span class="chip emg sm">${icon("siren", 11)} EMERGENCY</span> ` : ""}${esc(r.accountName)}</span>
            <span class="num" style="font-weight:700">${fmtN(r.deliveredVolume)} lbs</span>
          </div>`).join("") : `<p class="muted small" style="margin:0">No deliveries yet.</p>`}
        ${todays.length > 3 ? `<button class="btn btn-sm btn-outline block" style="margin-top:10px" data-action="tab" data-screen="deliveries">See all ${todays.length}</button>` : ""}
      </section>`;
  }

  /* ----- Deliveries ----- */
  function recordCard(r) {
    return `
      <button class="rowbtn ${r.emergency ? "emg" : ""}" data-action="editRecord" data-id="${esc(r.clientRecordId)}">
        <div class="time-col">${esc(r.arrivalTime)}</div>
        <div class="grow">
          ${r.emergency ? `<span class="chip emg">${icon("siren", 13)} EMERGENCY</span>` : ""}
          <div class="rec-name">${esc(r.accountName)}</div>
          <div class="rec-sub">${esc([r.accountAddress, r.accountCity].filter(Boolean).join(", "))}</div>
          <div class="rec-chips">
            ${r.accountNumber ? `<span class="chip">Acc ${esc(r.accountNumber)}</span>` : ""}
            ${r.accountRoute ? `<span class="chip">Route ${esc(r.accountRoute)}</span>` : ""}
            <span class="chip brand">${esc(r.vehicleNo)}</span>
            ${Number(r.deliveredVolume) === 0 ? `<span class="chip warn">Not delivered</span>` : ""}
            ${r.synced ? `<span class="chip ok">${icon("check", 12)} Uploaded</span>` : `<span class="chip warn">Waiting</span>`}
          </div>
          ${r.notes ? `<div class="rec-note">${esc(r.notes)}</div>` : ""}
        </div>
        <div class="rec-amt">${fmtN(r.deliveredVolume)}<div class="u">lbs</div></div>
      </button>`;
  }
  function filteredRecords() {
    const S = App.S;
    const q = S.dQuery.trim().toLowerCase();
    return App.day.deliveries().filter((r) => (S.dFilter === "all" || r.vehicleNo === S.dFilter) &&
      (!q || [r.emergency ? "emergency" : "", r.accountName, r.accountAddress, r.accountCity, r.accountNumber, r.accountRoute, r.notes].join(" ").toLowerCase().includes(q))).reverse();
  }
  function renderDeliveryList() {
    const list = filteredRecords();
    return list.length ? list.map(recordCard).join("") : `<div class="empty">${App.day.deliveries().length ? "No records match." : "No deliveries yet today."}</div>`;
  }
  function renderDeliveries() {
    const S = App.S;
    const all = App.day.deliveries();
    const vehicles = [...new Set(all.map((r) => r.vehicleNo))];
    if (S.dFilter !== "all" && !vehicles.includes(S.dFilter)) S.dFilter = "all";
    const total = all.reduce((a, r) => a + (Number(r.deliveredVolume) || 0), 0);
    const emg = all.filter((r) => r.emergency).length;
    return `
      <div class="page-h"><h1>Deliveries</h1><span class="sub num">${esc(S.day.date)}</span></div>
      <div class="summary-line"><span>${all.length} ${all.length === 1 ? "delivery" : "deliveries"} · ${fmtN(total)} lbs${emg ? ` · <b class="emg-count">${emg} emergency</b>` : ""}</span>
        ${all.length ? `<button class="btn btn-sm btn-outline" data-action="openDay" data-date="${esc(S.day.date)}" data-from="deliveries">${icon("file", 16)} Today's report</button>` : ""}</div>
      ${vehicles.length > 1 ? `<div class="seg-tabs" role="tablist">
        <button class="${S.dFilter === "all" ? "on" : ""}" data-action="vfilter" data-v="all">All</button>
        ${vehicles.map((v) => `<button class="${S.dFilter === v ? "on" : ""}" data-action="vfilter" data-v="${esc(v)}">${esc(v)}</button>`).join("")}
      </div>` : ""}
      <div class="search-wrap" style="margin-bottom:12px">${icon("search", 18)}
        <input class="input" id="dSearch" placeholder="Search customer, address, note" value="${esc(S.dQuery)}" aria-label="Search deliveries">
      </div>
      <div class="list" id="dList">${renderDeliveryList()}</div>
      ${all.length ? `<p class="hint" style="text-align:center;margin-top:14px">Tap a delivery to edit or delete it.</p>` : ""}`;
  }
  App.onInput.dSearch = (t) => { App.S.dQuery = t.value; App.$("#dList").innerHTML = renderDeliveryList(); };
  App.ACTIONS.vfilter = (d) => { App.S.dFilter = d.v; App.render(); };
  // Admin tools open for admin accounts only (the page checks the role again).
  App.ACTIONS.openAdmin = () => { window.location.href = "./admin.html"; };

  /* ----- More ----- */
  function renderMore() {
    const S = App.S, sess = S.session, t = S.theme;
    const name = sess.displayName || sess.username;
    // No Admin, Customers or Delivery Lists on the website: its sidebar has them (owner, 2026-10-30).
    return `
      <div class="page-h"><h1>More</h1></div>
      <section class="card profile">
        <div class="avatar">${esc(initials(name))}</div>
        <div><div style="font-weight:750;font-size:18px">${esc(name)}</div><div class="muted">${App.ROLE_LABEL[S.role] || S.role}${App.canRecord() ? ` #${esc(sess.driverNumber)}` : ""}</div></div>
      </section>
      <div class="menu">
        ${S.role === "admin" && !App.inApp && !App.web ? `<button class="menu-item" data-action="openAdmin"><span class="ic">${icon("list")}</span><span class="grow">Admin<div class="small muted">Users and roles</div></span>${icon("chev", 18)}</button>` : ""}
        ${!App.web && App.canAddCustomer() && !App.tabsFor().includes("customers") ? `<button class="menu-item" data-action="tab" data-screen="customers"><span class="ic">${icon("customers")}</span><span class="grow">Customers<div class="small muted">${App.canEditCustomer() ? "Customers and reload plants" : "Find and add customers"}</div></span>${icon("chev", 18)}</button>` : ""}
        ${!App.web && App.canSendLists() ? `<button class="menu-item" data-action="tab" data-screen="deliveryLists"><span class="ic">${icon("list")}</span><span class="grow">Delivery Lists<div class="small muted">Send a driver next week's list</div></span>${icon("chev", 18)}</button>` : ""}
        <button class="menu-item" data-action="changePassword"><span class="ic">${icon("key")}</span><span class="grow">Change Password</span>${icon("chev", 18)}</button>
        ${App.canRecord() ? `<button class="menu-item" data-action="backup"><span class="ic">${icon("cloud")}</span><span class="grow">Back Up This Phone</span>${icon("chev", 18)}</button>` : ""}
        ${App.inApp ? renderVersion() : `<div class="menu-item" style="cursor:default"><span class="ic">${icon("update")}</span><span class="grow">Version<div class="small muted">${esc(App.VERSION)}</div></span></div>`}
        <div class="menu-item" style="cursor:default"><span class="ic">${icon("sun")}</span><span class="grow">Appearance</span>
          <span class="segmented" role="group" aria-label="Appearance">
            ${[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) => `<button class="${t === v ? "on" : ""}" data-action="theme" data-value="${v}">${l}</button>`).join("")}
          </span>
        </div>
        <button class="menu-item" data-action="signOut" style="color:var(--bad)"><span class="ic" style="color:var(--bad)">${icon("logout")}</span><span class="grow">Sign Out</span></button>
      </div>
      ${S.role === "admin" && !App.inApp ? "" : `<p class="hint" style="text-align:center;margin-bottom:18px">${S.role === "admin" ? "User management is on the website (computer)." : "Admin tools are only on the website."}</p>`}`;
  }

  // In the app: the installed version; tapping checks for a newer one (App.native.checkUpdate).
  function renderVersion() {
    const up = App.native.update();
    const note = up ? `<div class="small" style="color:var(--brand);font-weight:650">Update to ${esc(up.versionName)} available</div>` : `<div class="small muted">Tap to check for updates</div>`;
    return `<button class="menu-item" data-action="appUpdate"><span class="ic">${icon("update")}</span><span class="grow">Version ${esc(App.installed?.versionName || App.VERSION)}${note}</span>${up ? '<span class="dot" style="background:var(--brand)"></span>' : ""}${icon("chev", 18)}</button>`;
  }

  // Parts of the new UI that come in later phases (DEV_PLAN.md).
  function coming(title, text) {
    return `
      <div class="page-h"><h1>${esc(title)}</h1></div>
      <div class="coming">${icon("calendar", 40)}<h2>Coming soon</h2><p>${esc(text)}</p></div>`;
  }

  Object.assign(App.SCREENS, {
    today: renderToday,
    deliveries: renderDeliveries,
    more: renderMore,
  });
})();
