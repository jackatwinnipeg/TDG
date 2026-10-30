/* Route: uploading a delivery list and planning (ROUTE_PROPOSAL.md 3.1-3.3, 3.6.1, 3.7).
 * Upload List → Check the list (Z02 / Z01 / Needs attention) → Delivery days and start point →
 * Your route (review, move, remove, Re-plan) → Save route. Lists sent by a Supervisor, Manager
 * or Admin show as cards on Today and Route (decisions 31-34); Next week's route has its own view. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { $, esc, icon, addDays, weekday, localDate } = App;
  const P = () => window.TDG_ROUTE_PLAN;
  const RT = () => App.route;
  const S = () => App.S;
  const sb = () => window.supabaseClient;
  const R = () => RT().R();
  const up = () => R().up;
  const FILE_TYPES = ".xlsx,.csv,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/comma-separated-values,application/pdf";

  /* ---------------- reading the file ---------------- */
  // Excel, CSV or PDF (3.2.1): { rows, kind } or { error }. A scanned PDF (no text) comes back as
  // { scanned: doc }; the app reads its pages as pictures, the website cannot.
  async function readFile(file) {
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      const r = await window.TDG_LIST_READ.readPdf(await file.arrayBuffer());
      if (r.scanned) {
        if (App.native.available()) return { scanned: r.doc };
        return { error: "This PDF is a scan: a picture of the list, without text. Open it in the Android app, which reads pictures, or use the Excel list." };
      }
      return r.error ? r : { ...r, kind: "pdf" };
    }
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
      const objs = window.TDG_CSV.parse(await file.text());
      if (!objs.length) return { error: "The file has no rows." };
      const head = Object.keys(objs[0]);
      return P().readList([head, ...objs.map((o) => head.map((h) => o[h]))]);
    }
    if (/^image\//.test(file.type)) return { error: "Pictures are read in the Android app. On the website, choose the PDF, Excel or CSV list." };
    if (!/\.xlsx$/i.test(file.name)) return { error: "Choose an Excel (.xlsx), CSV or PDF file." };
    return P().readList(await window.TDG_XLSX.readXlsx(await file.arrayBuffer()));
  }

  // Customers for the list's codes: this phone's first, then the server for the rest, in every
  // province (codes are looked up everywhere, REGION_PROPOSAL.md 3.3). Code → customers.
  async function lookupCustomers(rows) {
    const byKey = new Map();
    const add = (c) => { const k = P().normAcc(c.accountNumber); if (!k) return; const list = byKey.get(k) || []; if (!list.some((x) => x.id === c.id)) list.push(c); byKey.set(k, list); };
    App.data.cachedCustomers().forEach(add);
    const missing = [...new Set(rows.map((r) => P().normAcc(r.pos)).filter((k) => k && !byKey.has(k)))];
    for (let i = 0; i < missing.length; i += 40) {
      const part = missing.slice(i, i + 40);
      const codes = [...new Set(part.flatMap((k) => [k, `${k}-INST`]).concat(rows.filter((r) => part.includes(P().normAcc(r.pos))).map((r) => r.pos.trim())))];
      const { data } = await App.data.call(sb().from("tdg_customers").select(App.data.CUST_COLS).in("account_number", codes));
      (data || []).map(App.data.toCustomer).forEach(add);
    }
    // A code written both with and without -INST: the driver picks one (3.2).
    for (const [k, list] of byKey) if (list.length > 1) byKey.set(k, list.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber)));
    return byKey;
  }

  async function addressChoices() {
    const { data } = await App.data.call(sb().from("tdg_route_address_choices").select("account_key, list_address, choice").eq("owner_id", S().session.userId));
    return Object.fromEntries((data || []).map((r) => [r.account_key, r]));
  }

  // The list sorted into Z02, Z01 (both planned, decision 53) and Needs attention (3.2).
  async function analyze(rows, base) {
    const byKey = await lookupCustomers(rows);
    const choices = await addressChoices();
    const inPlan = new Set(RT().activeStops(base).filter((s) => s.acc).map((s) => P().normAcc(s.acc)));
    const out = { rows: rows.length, z02: [], z01: [], attn: [], fmt: 0, inst: 0, remembered: 0, dup: 0, same: 0, carry: 0, byKey };
    const seen = new Set();
    for (const row of rows) {
      const k = P().normAcc(row.pos);
      const key = k || `addr:${P().normAddr(row.addr)}`;
      if (seen.has(key)) { out.same++; continue; } // the same customer twice in the list
      seen.add(key);
      if (row.carry) out.carry++;
      const matches = k ? byKey.get(k) || [] : [];
      const listRoute = P().routeOf(row.rte);
      if (!matches.length) { out.attn.push({ key, type: "missing", row, suggest: listRoute }); continue; }
      if (matches.length > 1) { out.attn.push({ key, type: "twin", row, matches, listRoute }); continue; }
      const c = matches[0];
      if (row.pos.trim().toUpperCase() !== c.accountNumber.toUpperCase()) out.inst++;
      const route = listRoute || P().routeOf(c.route) || "";
      if (!route) { out.attn.push({ key, type: "noroute", row, c }); continue; }
      if (inPlan.has(k)) { out.dup++; continue; }
      let addr = c.accountAddress;
      if (!P().sameAddress(row.addr, c.accountAddress)) {
        const saved = choices[k];
        if (!saved || saved.list_address !== P().normAddr(row.addr)) { out.attn.push({ key, type: "addr", row, c }); continue; }
        out.remembered++;
        if (saved.choice === "list") addr = row.addr;
      } else if (row.addr.trim() !== c.accountAddress.trim()) out.fmt++;
      out[route === "Z01" ? "z01" : "z02"].push({ key, row, c, addr });
    }
    // Positions of the customers to plan: found once and kept on the customer (3.8).
    const need = [...out.z02, ...out.z01];
    if (need.length) {
      const found = await RT().locateCustomers(need.map((x) => x.c));
      for (const x of need) {
        const p = found[x.c.id];
        if (p) Object.assign(x.c, { lat: p.lat, lng: p.lng, geoSource: p.source, curb: p.curb ?? null, curbFor: p.curbFor || "" });
        else if (p === null) Object.assign(x.c, { lat: null, lng: null }); // not found at its address now
      }
      need.filter((x) => x.c.lat == null).forEach((x) => out.attn.push({ key: x.key, type: "geo", row: x.row, c: x.c, addr: x.addr }));
      out.z02 = out.z02.filter((x) => x.c.lat != null);
      out.z01 = out.z01.filter((x) => x.c.lat != null);
    }
    return out;
  }

  function isResolved(it) {
    const r = up().res[it.key];
    if (!r) return false;
    return { addr: !!r.addr, geo: !!(r.pos || r.skip), twin: !!r.pick, missing: !!r.route, noroute: !!r.route }[it.type];
  }

  /* ---------------- screens ---------------- */
  const thisWeek = () => RT().mondayOf(RT().today());
  const weekLabel = (w) => (w === thisWeek() ? `This week (${w})` : w === addDays(thisWeek(), 7) ? `Next week (${w})` : `Week of ${w}`);
  const receivedFor = (week) => (R().lists || []).find((l) => l.week_start === week && l.status !== "replaced") || null;
  const baseFor = (week) => (week === thisWeek() ? R().plan : week === addDays(thisWeek(), 7) ? R().next : null);

  // list: start from a received list (Yes, plan my route / Plan route with this list).
  function startUpload({ list = null } = {}) {
    if (navigator.onLine === false) return App.showResult(false, "Upload needs a connection", "No internet connection.", "Reading the list and planning need the internet. Your route on this phone is unchanged.");
    const week = list ? list.week_start : thisWeek();
    R().up = { week, list, file: list ? list.file_name : null, rows: list ? list.rows : null, kind: list ? "list" : "", pdf: null, pics: null, an: null, res: {}, dates: new Set(), same: true, startText: "", endText: "", editStart: !R().defaults, merge: null, busy: false, error: "" };
    R().draft = null;
    R().editOrder = null;
    App.go("upload");
    if (list) runAnalyze();
  }

  async function runAnalyze() {
    const u = up();
    u.busy = true; u.error = ""; u.an = null; u.res = {};
    App.render();
    try {
      let rows = u.rows;
      // The driver's own file and a received list for the same week are merged (decision 34).
      const received = u.list ? null : receivedFor(u.week);
      if (received) {
        const m = P().mergeLists(received.rows, rows);
        u.merge = { from: received.sent_by_name, file: received.file_name, both: m.both, mine: m.mine, theirs: m.theirs, listId: received.id };
        rows = m.rows;
      } else u.merge = null;
      u.an = await analyze(rows, baseFor(u.week));
      const base = baseFor(u.week);
      u.dates = new Set(base ? base.dates.filter((d) => d >= RT().today()) : []);
    } catch (error) {
      u.error = RT().reason(error);
    }
    u.busy = false;
    App.render();
  }

  App.onChange.routeFile = async (t) => {
    const file = t.files?.[0];
    t.value = "";
    if (!file) return;
    let read;
    if (/\.pdf$/i.test(file.name)) App.snackbar(`Reading ${file.name}…`);
    try { read = await readFile(file); } catch (error) { read = { error: error.message }; }
    if (read.scanned) return App.listPictures.fromPdf(read.scanned, file.name);
    if (read.error) return App.showResult(false, "List not read", read.error, "Check that it is the delivery list (Excel .xlsx, CSV or PDF with the customer codes and addresses).");
    useRows(read.rows, { file: file.name, kind: read.kind || "sheet", pdf: read.kind === "pdf" ? { pages: read.pages, rte: read.rte } : null });
  };

  // Rows read from a file or from pictures (js/app/list_pictures.js) → Check the list.
  function useRows(rows, { file, kind, pdf = null, pics = null }) {
    const u = up();
    Object.assign(u, { file, rows, kind, pdf, pics, list: null });
    if (App.S.screen !== "upload") App.go("upload");
    runAnalyze();
  }

  // Italic rows of a PDF list: carryovers needing fills (decision 38).
  const carryChip = (row) => (row?.carry ? `<span class="chip brand" title="Carryover needing a fill (italic in the PDF)">Carryover</span>` : "");

  function attnCard(it) {
    const u = up(), r = u.res[it.key] || {}, row = it.row, ok = isResolved(it);
    const opt = (field, val, label) => `<button class="btn btn-sm btn-outline" data-action="resolve" data-key="${esc(it.key)}" data-field="${field}" data-val="${esc(val)}">${label}</button>`;
    const head = { missing: "Not in Customers", noroute: "Route is missing", addr: "Address is different", geo: "Location not found", twin: "Two customers" }[it.type];
    let body = "", opts = "", done = "";
    if (it.type === "missing") {
      body = `<div class="small muted">${esc(row.pos)} · ${esc(row.addr)}${it.suggest ? ` · List says ${it.suggest}` : ""}</div>`;
      opts = `${App.canAddCustomer() ? `<button class="btn btn-sm btn-primary" data-action="addFromList" data-key="${esc(it.key)}">${icon("plus", 14)} Add to customers</button>` : ""}${opt("route", "Z02", "Plan as Z02")}${opt("route", "Z01", "Plan as Z01")}`;
      done = r.added ? `Added to Customers as ${r.route}` : `Planned as ${r.route}`;
    } else if (it.type === "noroute") {
      body = `<div class="small muted">${esc(row.pos)} · ${esc(row.addr)} · No Route in the list or in Customers</div>`;
      opts = `${opt("route", "Z02", "Z02 · plan it")}${opt("route", "Z01", "Z01 · plan it")}`;
      done = `Planned as ${r.route}`;
    } else if (it.type === "twin") {
      body = `<div class="small muted">${esc(row.pos)} matches two customers. Choose the one to use.</div>`;
      opts = it.matches.map((c) => opt("pick", c.id, `${esc(c.accountNumber)} · ${esc(c.accountAddress)}`)).join("");
      const c = it.matches.find((x) => x.id === r.pick);
      done = c ? `Using ${c.accountNumber}` : "";
    } else if (it.type === "addr") {
      body = `<div class="cmp"><span>List</span><b>${esc(row.addr)}</b><span>Customers</span><b>${esc(it.c.accountAddress)}</b></div>`;
      opts = `${opt("addr", "list", "Use list address")}${opt("addr", "customer", "Use customer address")}${RT().canEditOthers() ? opt("addr", "update", "Update customer") : ""}`;
      done = { list: "Using the list address", customer: "Using the customer address", update: "Customer address will be updated" }[r.addr] || "";
    } else {
      body = `<div class="small muted">${esc(row.pos)} · “${esc(it.addr || row.addr)}” could not be found on the map.</div>
        <div class="field" style="margin:8px 0 0"><label class="label" for="geo-${esc(it.key)}">Try the address written another way</label>
          <div class="row"><input class="input grow" id="geo-${esc(it.key)}" placeholder="e.g. 107 Burning Glass Road, Winnipeg" autocomplete="off"><button class="btn btn-sm btn-primary" data-action="geoTry" data-key="${esc(it.key)}">Find</button></div></div>`;
      opts = opt("skip", "1", "Plan without a position");
      done = r.pos ? "Position found and saved to Customers" : "Planned without a position (last stop of a day)";
    }
    return `<div class="attn ${ok ? "done" : ""}">
      <div class="attn-h"><span><b>${esc(row.name || it.c?.accountName || row.pos)}</b> ${carryChip(row)}</span><span class="chip ${ok ? "ok" : "warn"}">${ok ? `${icon("check", 12)} Done` : head}</span></div>
      ${body}
      ${ok ? `<div class="row" style="margin-top:8px"><span class="grow small"><b>${esc(done)}</b>${it.type === "addr" && r.addr !== "update" ? `<div class="muted">Remembered for this customer.</div>` : ""}</span><button class="btn btn-sm btn-outline" data-action="unresolve" data-key="${esc(it.key)}">Change</button></div>`
        : `<div class="opt-row">${opts}</div>${it.type === "addr" ? `<p class="hint">Your choice is remembered for this customer.</p>` : ""}`}
    </div>`;
  }

  function renderUpload() {
    const u = up();
    if (!u) { setTimeout(() => App.go("route")); return ""; }
    const back = `<button class="back" data-action="cancelUpload">${icon("back", 20)} Route</button>`;
    const weeks = [thisWeek(), addDays(thisWeek(), 7)];
    const weekPick = u.list ? "" : `<div class="segmented" role="group" aria-label="Week" style="margin-bottom:12px">${weeks.map((w) => `<button class="${u.week === w ? "on" : ""}" data-action="upWeek" data-week="${w}">${w === weeks[0] ? "This week" : "Next week"}</button>`).join("")}</div>`;
    if (!u.rows) {
      const received = receivedFor(u.week), base = baseFor(u.week);
      return `${back}<div class="page-h"><h1>Upload List</h1></div>${weekPick}
        <section class="card">
          <p style="margin:0 0 12px">Choose the delivery list for ${esc(weekLabel(u.week).toLowerCase())}. The app reads the customer codes and plans the Z02 (local) and Z01 (long distance) customers.</p>
          <label class="upload-drop" for="routeFile" role="button">${icon("upload", 30)}<div style="font-weight:750;margin-top:6px">Choose file</div><div class="small muted">Excel (.xlsx), CSV or PDF</div></label>
          <input type="file" id="routeFile" accept="${FILE_TYPES}" hidden>
          ${App.native.available() ? `<button class="upload-drop" data-action="picsPick" style="margin-top:10px">${icon("image", 30)}<div style="font-weight:750;margin-top:6px">Read pictures</div><div class="small muted">Screenshots or photos of the list, one or more. You check what was read.</div></button>` : ""}
        </section>
        ${received ? `<div class="note-box">You received a list from ${esc(received.sent_by_name)} for this week. Your file is compared with it and merged; customers in both lists are kept once.</div>`
          : base && RT().activeStops(base).length ? `<div class="note-box">You already have a route this week. New customers are planned together with the undelivered stops.</div>` : ""}`;
    }
    if (u.busy || !u.an) {
      return `${back}<div class="page-h"><h1>Check the list</h1></div>
        <div class="empty">${u.error ? esc(u.error) : "Reading the list and finding the customers on the map…"}</div>
        ${u.error ? `<button class="btn btn-primary block" data-action="retryAnalyze">Try again</button>` : ""}`;
    }
    const a = u.an;
    const info = [
      a.fmt ? `${a.fmt} address${a.fmt > 1 ? "es are" : " is"} only written differently (for example “1124 St Marys Road” and “1124 St Mary's Rd”). Matched automatically.` : "",
      a.inst ? `${a.inst} code${a.inst > 1 ? "s" : ""} written with or without “-INST” matched to the customer.` : "",
      a.remembered ? `${a.remembered} address difference${a.remembered > 1 ? "s" : ""} used your saved choice.` : "",
      a.dup ? `${a.dup} customer${a.dup > 1 ? "s are" : " is"} already in this week's route.` : "",
      a.same ? `${a.same} customer${a.same > 1 ? "s appear" : " appears"} twice in the list and ${a.same > 1 ? "are" : "is"} planned once.` : "",
      a.carry ? `${a.carry} carryover${a.carry > 1 ? "s" : ""} needing fills (italic in the PDF), marked Carryover. Planned like the others.` : "",
      u.pdf ? `Read from the PDF: ${a.rows} rows on ${u.pdf.pages} page${u.pdf.pages > 1 ? "s" : ""}.${u.pdf.rte ? ` Route in the title: ${u.pdf.rte} (${P().routeOf(u.pdf.rte) || "none"}).` : ""}` : "",
      u.pics ? `${u.pics.count ? `Customer codes read from ${u.pics.count} picture${u.pics.count > 1 ? "s" : ""} on this phone and checked by you` : "Customer codes typed in by you"}; name, address, city and route from Customers.` : "",
      u.merge ? `Merged with the list from ${u.merge.from}: ${u.merge.both} in both, ${u.merge.mine} only in your file, ${u.merge.theirs} only in the received list.` : "",
      u.list ? `List from ${u.list.sent_by_name} for the week of ${u.list.week_start}.` : "",
      u.kind === "sheet" ? "Columns not used: Product, CO2-CC 1, CO2-CC 2." : "",
    ].filter(Boolean);
    const base = baseFor(u.week);
    const extra = base ? base.stops.filter((s) => s.status === "pending").length : 0;
    return `${back}
      <div class="page-h"><h1>Check the list</h1><span class="sub">${esc(weekLabel(u.week))}</span></div>
      <div class="file-row" style="margin-bottom:12px">${icon("file", 18)}<span class="grow"><b>${esc(u.file || "List")}</b>${u.merge ? ` + <b>${esc(u.merge.file)}</b>` : ""} · ${a.rows} rows</span>${u.list ? "" : u.pics ? `<button class="btn btn-sm btn-outline" data-action="picsBack">Pictures</button>` : `<label class="btn btn-sm btn-outline" for="routeFile">Change</label><input type="file" id="routeFile" accept="${FILE_TYPES}" hidden>`}</div>
      <div class="grid3" style="margin-bottom:14px">
        <div class="kmbox"><div class="k">Z02 · plan</div><div class="v">${a.z02.length}</div></div>
        <div class="kmbox"><div class="k">Z01 · plan</div><div class="v">${a.z01.length}</div></div>
        <div class="kmbox"><div class="k">To check</div><div class="v">${a.attn.length}</div></div>
      </div>
      ${a.attn.length ? `<h2 class="sec-h">Needs attention</h2>${a.attn.map(attnCard).join("")}` : ""}
      <details class="fold"><summary>Z02 · ${a.z02.length} to plan</summary><div class="fold-b">${a.z02.map(({ c, addr, row }) => `<div class="mini-row"><span class="grow ellipsis"><b>${esc(c.accountName)}</b> <span class="muted">${esc(addr)}</span></span>${carryChip(row)}</div>`).join("") || `<p class="muted small">None.</p>`}</div></details>
      <details class="fold"><summary>Z01 · ${a.z01.length} to plan</summary><div class="fold-b">${a.z01.map(({ c, addr, row }) => `<div class="mini-row"><span class="grow ellipsis"><b>${esc(c.accountName)}</b> <span class="muted">${esc(addr)}, ${esc(c.city)}</span></span>${carryChip(row)}</div>`).join("") || `<p class="muted small">None.</p>`}</div></details>
      ${extra ? `<div class="note-box">This week's ${extra} undelivered stop${extra > 1 ? "s are" : " is"} planned together with this list.</div>` : ""}
      <div class="info-list">${info.map((t) => `<div class="small muted">• ${esc(t)}</div>`).join("")}</div>`;
  }

  // Stops for the plan: the base plan's undelivered stops, then the list's Z02 and Z01 customers, each once.
  function stopsToPlan(base, replacePending) {
    const u = up(), a = u.an, out = [], seen = new Set();
    const add = (s) => { const k = s.acc ? P().normAcc(s.acc) : `id:${s.id}`; if (seen.has(k)) return; seen.add(k); out.push(s); };
    if (base && !replacePending) base.stops.filter((s) => s.status === "pending").forEach(add);
    const extra = (row) => ({ product: row.product || "", rte: row.rte || "" });
    a.z02.concat(a.z01).forEach(({ c, addr, row }) => add(RT().mkStop(c, { addr, ...extra(row), needGeo: addr !== c.accountAddress })));
    for (const it of a.attn) {
      const r = u.res[it.key] || {};
      if ((it.type === "missing" || it.type === "noroute") && r.route) {
        const c = r.customer || it.c;
        // The answer is kept as the stop's route for Start Delivery when Customers has none.
        add(RT().mkStop(c || { acc: it.row.pos, name: it.row.name, addr: it.row.addr, city: it.row.city }, { ...extra(it.row), rte: it.row.rte || r.route, needGeo: !c || c.lat == null }));
      }
      if (it.type === "twin" && r.pick) {
        const c = it.matches.find((x) => x.id === r.pick);
        add(RT().mkStop(c, { addr: c.accountAddress, ...extra(it.row), needGeo: c.lat == null }));
      }
      if (it.type === "addr") add(RT().mkStop(it.c, { addr: r.addr === "customer" ? it.c.accountAddress : it.row.addr, ...extra(it.row), needGeo: r.addr !== "customer" }));
      if (it.type === "geo") add(RT().mkStop(r.pos ? { ...it.c, lat: r.pos.lat, lng: r.pos.lng } : it.c, { addr: it.addr || it.c.accountAddress, ...extra(it.row), needGeo: false }));
    }
    return out;
  }

  function renderPlanSetup() {
    const u = up();
    if (!u?.an) { setTimeout(() => App.go("route")); return ""; }
    const days = [0, 1, 2, 3, 4].map((i) => addDays(u.week, i));
    const sel = [...u.dates].sort();
    const n = stopsToPlan(baseFor(u.week), replacing()).length;
    const def = R().defaults, useDef = def && !u.editStart;
    const startHtml = useDef
      ? `<div class="kmbox row"><span class="grow"><b>${esc(def.start.name)}</b><div class="small muted">${def.end.name === def.start.name ? "Start and finish here" : `Finish: ${esc(def.end.name)}`}</div></span><span class="chip ok">Default</span></div>
         <button class="btn btn-sm btn-outline" style="margin-top:10px" data-action="editStart">Change</button>`
      : `<div class="field"><label class="label" for="spStart">Start point *</label><input class="input" id="spStart" value="${esc(u.startText)}" placeholder="e.g. 635 McPhillips St, Winnipeg" autocomplete="off"></div>
         <label class="toggle-row"><input type="checkbox" id="spSame" ${u.same ? "checked" : ""}> Finish at the same place</label>
         ${u.same ? "" : `<div class="field"><label class="label" for="spEnd">Finish point *</label><input class="input" id="spEnd" value="${esc(u.endText)}" autocomplete="off"></div>`}`;
    return `<button class="back" data-action="backToCheck">${icon("back", 20)} Check the list</button>
      <div class="page-h"><h1>Delivery days</h1><span class="sub">${n} stop${n === 1 ? "" : "s"}</span></div>
      <section class="card">
        <div class="card-h"><h2>Choose the days</h2><span class="chip ${sel.length ? "brand" : ""}">${sel.length} day${sel.length === 1 ? "" : "s"}</span></div>
        <div class="small muted" style="margin:0 0 6px">${esc(weekLabel(u.week))}</div>
        <div class="cal">${days.map((d) => `<button class="${u.dates.has(d) ? "on" : ""} ${d === RT().today() ? "today" : ""}" data-action="toggleDate" data-date="${d}" ${d < RT().today() ? "disabled" : ""} aria-pressed="${u.dates.has(d)}"><small>${weekday(d)}</small>${d.slice(8)}</button>`).join("")}</div>
        <p class="hint">${sel.length ? `One route per day: ${sel.map((d) => `<span style="white-space:nowrap">${RT().dayLabel(d)}</span>`).join(", ")}` : "Tap the days you will deliver. Days do not have to be next to each other."}</p>
      </section>
      <section class="card"><div class="card-h"><h2>Start and finish</h2></div>${startHtml}</section>`;
  }
  App.onInput.spStart = (t) => { up().startText = t.value; };
  App.onInput.spEnd = (t) => { up().endText = t.value; };
  App.onChange.spSame = (t) => { up().same = t.checked; App.render(); };

  // A newer list for a week already planned from a list replaces the undelivered stops (decision 33).
  const replacing = () => { const u = up(), base = baseFor(u.week); return !!(u.list && base?.listId && base.listId !== u.list.id); };

  async function planRoute() {
    const u = up(), dates = [...u.dates].sort();
    if (!dates.length) return;
    if (navigator.onLine === false) return App.showResult(false, "Planning needs a connection", "No internet connection.", "Your list and answers are kept. Try again when the connection is back.");
    let start, end, typed = false;
    u.planning = true;
    App.render();
    try {
      if (R().defaults && !u.editStart) ({ start, end } = R().defaults);
      else {
        const st = (u.startText || "").trim(), en = (u.endText || "").trim();
        if (!st) return App.showResult(false, "Start point missing", "Enter where the route starts.");
        if (!u.same && !en) return App.showResult(false, "Finish point missing", "Enter where the route finishes, or tick “Finish at the same place”.");
        const find = async (text) => { const p = await RT().geocodeText(text); if (!p) throw new Error(`“${text}” was not found on the map. Write it as a street address with the city.`); return { name: text, address: text, lat: p.lat, lng: p.lng }; };
        start = await find(st);
        end = u.same ? start : await find(en);
        typed = true;
      }
      const base = baseFor(u.week);
      const plan = base ? JSON.parse(JSON.stringify(base)) : RT().newPlan(S().session.userId, u.week, start, end);
      plan.start = start; plan.end = end;
      const fresh = stopsToPlan(plan, replacing());
      // A stop at the list's address (not the customer's) is looked up at that address.
      for (const s of fresh.filter((x) => x.needGeo)) {
        const p = await RT().geocodeText([P().stripUnit(s.addr), s.city, "Canada"].filter(Boolean).join(", ")).catch(() => null);
        if (p) Object.assign(s, { lat: p.lat, lng: p.lng });
      }
      fresh.forEach((s) => { delete s.needGeo; });
      if (replacing()) plan.stops.filter((s) => s.status === "pending").forEach((s) => { s.status = "removed"; });
      const keep = plan.stops.filter((s) => s.status === "done" || (s.status === "removed" && base?.stops.some((b) => b.id === s.id)));
      plan.stops = keep.concat(fresh);
      plan.dates = [...new Set(plan.stops.filter((s) => s.status === "done").map((s) => s.date).concat(dates))].sort();
      await RT().ensureCosts([start, end, ...fresh]);
      await RT().planDates(plan, dates, fresh);
      if (u.list) plan.listId = u.list.id;
      else if (u.merge) plan.listId = u.merge.listId;
      R().draft = plan;
      R().reviewDay = null;
      R().mode = "map";
      App.go("planReview");
    } catch (error) {
      return App.showResult(false, "Route not planned", RT().reason(error), "Your list and answers are kept. Try again.");
    } finally {
      u.planning = false;
      App.render();
    }
    if (typed) {
      App.showConfirm({
        title: "Save as default?", msg: `Use “${start.name}”${end !== start ? ` and “${end.name}”` : ""} as your start and finish next time?`,
        okText: "Save as default", cancelText: "Not now",
        onOk: async () => {
          try {
            await App.data.call(sb().from("tdg_route_defaults").upsert({ owner_id: S().session.userId, start_point: start, end_point: end, updated_at: new Date().toISOString() }));
            R().defaults = { start, end };
            up().editStart = false;
            RT().persist();
            App.snackbar("Saved as your default start point.");
          } catch (error) { App.snackbar(`Default not saved: ${RT().reason(error)}`); }
        },
      });
    }
  }

  function renderPlanReview() {
    const p = R().draft;
    if (!p) { setTimeout(() => App.go("route")); return ""; }
    const from = RT().today();
    const dates = p.dates.filter((d) => d >= from);
    const all = dates.map((d) => ({ d, L: RT().legs(p, d), list: RT().dayStops(p, d) }));
    const count = all.reduce((t, x) => t + x.list.filter((s) => s.status !== "done").length, 0);
    const sel = dates.includes(R().reviewDay) ? R().reviewDay : null;
    return `<button class="back" data-action="backToSetup">${icon("back", 20)} Delivery days</button>
      <div class="page-h"><h1>Your route</h1><span class="sub num">${dates.length} day${dates.length > 1 ? "s" : ""} · ${count} stops</span></div>
      ${RT().routeMap(p, sel ? [sel] : dates, "draft")}
      <div class="legend" role="group" aria-label="Show on map">
        <button class="chip ${sel ? "" : "on"}" data-action="reviewDay" data-date="">All days</button>
        ${all.map(({ d, list }) => `<button class="chip ${sel === d ? "on" : ""}" style="--dc:${RT().dayColor(p, d)}" data-action="reviewDay" data-date="${d}"><span class="day-dot"></span>${d === from ? "Today" : RT().dayLabel(d)} · ${list.length}</button>`).join("")}</div>
      ${all.map(({ d, L, list }) => `<section class="card plan-day" style="--dc:${RT().dayColor(p, d)}">
        <div class="card-h"><h2><span class="day-dot"></span>${d === from ? "Today" : weekday(d)} <span class="num">${d}</span></h2><span class="muted small num">${list.length} stops · ${RT().fmtKm(L.m)} km · ${RT().fmtDur(L.s)}</span></div>
        ${list.length ? list.map((s, i) => `<button class="mini-stop ${s.status}" data-action="stopTap" data-id="${esc(s.id)}" data-owner="draft"><span class="num-badge sm">${s.status === "done" ? icon("check", 12) : i + 1}</span><span class="grow ellipsis"><b>${esc(s.name)}</b> <span class="muted">${esc(s.addr)}</span></span>${RT().srcChips(s)}</button>`).join("") : `<p class="muted small" style="margin:0">No stops.</p>`}
      </section>`).join("")}
      <button class="btn btn-outline block" data-action="replanDraft">${icon("update", 18)} Re-plan</button>
      <p class="hint" style="text-align:center">Tap a stop to move it to another day or remove it. Driving times only.</p>`;
  }

  async function replanDraft() {
    const p = R().draft, u = up();
    const dates = p.dates.filter((d) => d >= RT().today() && (!u || u.dates.has(d) || p.stops.some((s) => s.date === d && s.status === "pending")));
    const pend = p.stops.filter((s) => s.status === "pending");
    await RT().ensureCosts([p.start, p.end, ...pend]);
    await RT().planDates(p, dates, pend);
    App.render();
    App.snackbar("Re-planned.");
  }

  async function saveRoute() {
    const u = up(), plan = R().draft;
    if (!plan) return;
    // Address answers: remembered per driver and customer; "Update customer" changes the customer.
    try {
      for (const it of u.an.attn) {
        const r = u.res[it.key];
        if (it.type !== "addr" || !r) continue;
        if (r.addr === "update") {
          const { data } = await App.data.call(sb().from("tdg_customers").update({ account_address: it.row.addr }).eq("id", it.c.id).select(App.data.CUST_COLS).single());
          App.data.putCustomer(App.data.toCustomer(data), S().loc?.prov || "");
        } else {
          await App.data.call(sb().from("tdg_route_address_choices").upsert({ owner_id: S().session.userId, account_key: P().normAcc(it.c.accountNumber), list_address: P().normAddr(it.row.addr), choice: r.addr, updated_at: new Date().toISOString() }));
        }
      }
    } catch (error) {
      return App.showResult(false, "Route not saved", RT().reason(error), "Your plan is kept. Tap Save route again.");
    }
    const week = u.week, current = week === thisWeek();
    if (current) R().plan = plan; else R().next = plan;
    R().draft = null; R().up = null; R().tab = "mine";
    R().day = current ? (plan.dates.includes(RT().today()) ? RT().today() : plan.dates.find((d) => d >= RT().today())) : null;
    const listId = u.list?.id || u.merge?.listId;
    if (listId) {
      App.outbox.add("route.listAnswer", { id: listId, status: "planned" });
      const l = R().lists.find((x) => x.id === listId);
      if (l) l.status = "planned";
    }
    App.go(current ? "route" : "nextWeek");
    const n = plan.stops.filter((s) => s.status === "pending").length;
    const days = plan.dates.filter((d) => d >= RT().today()).length;
    await RT().commit([plan], {
      title: current ? "Route saved" : "Next week's route saved",
      detail: `${n} stop${n === 1 ? "" : "s"} over ${days} day${days > 1 ? "s" : ""}.${current && plan.dates.includes(RT().today()) ? " Today's Route is on the Today screen." : ""}`,
    });
  }

  /* ---------------- answers in Needs attention ---------------- */
  function resolve(d) {
    const u = up();
    u.res[d.key] = { ...(u.res[d.key] || {}), [d.field]: d.field === "skip" ? true : d.val };
    App.render();
  }
  async function geoTry(d) {
    const it = up().an.attn.find((x) => x.key === d.key);
    const text = ($(`#geo-${CSS.escape(d.key)}`)?.value || "").trim();
    if (!text) return App.snackbar("Type the address first.");
    try {
      const p = await RT().geocodeText(/\d/.test(text) && !/,/.test(text) ? `${text}, ${it.c.city || "Winnipeg"}` : text);
      if (!p) return App.snackbar(`“${text}” was not found either.`);
      // Saved on the customer for every driver, logged like a position fixed by hand (decision 15).
      const { data } = await App.data.call(sb().rpc("tdg_customer_set_position", { p_customer_id: it.c.id, p_lat: p.lat, p_lng: p.lng }));
      App.data.putCustomer({ ...it.c, lat: data.lat, lng: data.lng, geoSource: "manual" }, S().loc?.prov || "");
      up().res[d.key] = { pos: { lat: data.lat, lng: data.lng } };
      App.render();
    } catch (error) { App.snackbar(`Not found: ${RT().reason(error)}`); }
  }
  function addFromList(d) {
    const it = up().an.attn.find((x) => x.key === d.key);
    // "WINNIPEG" in a PDF list → "Winnipeg", as in Customers.
    const city = it.row.city === it.row.city.toUpperCase() ? it.row.city.toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase()) : it.row.city;
    App.customers.openNew({ accountNumber: it.row.pos, accountName: it.row.name, accountAddress: P().stripUnit(it.row.addr), city, province: it.row.prov, route: it.suggest || "Z02" }, (c) => {
      up().res[d.key] = { added: true, route: P().routeOf(c.route) || "Z02", customer: c };
      App.render();
    });
  }

  /* ---------------- lists from a Supervisor, Manager or Admin (decisions 31-34) ---------------- */
  // Route tab: every list for this week and later, and next week's route. Today: only new lists.
  function listCards({ onlyNew = false } = {}) {
    if (!App.canRecord()) return "";
    const lists = (R().lists || []).filter((l) => (onlyNew ? l.status === "new" : l.status !== "replaced"));
    return lists.map((l) => {
      const plan = baseFor(l.week_start);
      if (l.status === "new") {
        return `<section class="card inbox-card" aria-label="New delivery list">
          <div class="card-h"><h2>New delivery list</h2><span class="chip brand">Week of ${esc(l.week_start)}</span></div>
          <p style="margin:0 0 4px"><b>${esc(l.sent_by_name)}</b> sent you a list with ${l.rows.length} customers.</p>
          <p class="muted small" style="margin:0 0 12px">${plan?.listId && plan.listId !== l.id ? "It replaces the earlier list. You already planned this week with that list. Plan again with this one?" : "Let the system plan your route?"}</p>
          <div class="grid2"><button class="btn btn-outline" data-action="listNo" data-id="${esc(l.id)}">No, keep the list</button><button class="btn btn-primary" data-action="listYes" data-id="${esc(l.id)}">Yes, plan my route</button></div>
          <button class="btn btn-sm btn-outline block" style="margin-top:8px" data-action="listView" data-id="${esc(l.id)}">${icon("list", 16)} View the list</button>
        </section>`;
      }
      return `<section class="card" aria-label="Delivery list">
        <div class="card-h"><h2>Delivery list</h2><span class="chip ${l.status === "planned" ? "ok" : ""}">${l.status === "planned" ? "Route planned" : "Kept"}</span></div>
        <p class="muted small" style="margin:0 0 10px">From ${esc(l.sent_by_name)} · week of ${esc(l.week_start)} · ${l.rows.length} customers</p>
        <div class="grid2"><button class="btn btn-outline" data-action="listView" data-id="${esc(l.id)}">View list</button><button class="btn btn-primary" data-action="listYes" data-id="${esc(l.id)}">${l.status === "planned" ? "Plan again" : "Plan route"}</button></div>
      </section>`;
    }).join("") + (onlyNew ? "" : nextWeekCard());
  }
  const todayCards = () => listCards({ onlyNew: true });

  function nextWeekCard() {
    const np = R().next;
    if (!App.canRecord() || !np || !RT().activeStops(np).length) return "";
    const n = RT().activeStops(np).length;
    return `<section class="card" aria-label="Next week">
      <div class="card-h"><h2>Next week's route</h2><span class="chip ok">${np.dates.length} days · ${n} stops</span></div>
      <p class="muted small" style="margin:0 0 10px">${np.dates.map(RT().dayLabel).join(", ")}. It becomes your route on ${RT().dayLabel(np.dates[0])}.</p>
      <button class="btn btn-outline block" data-action="tab" data-screen="nextWeek">View next week</button>
    </section>`;
  }
  function listView(d) {
    const l = R().lists.find((x) => x.id === d.id);
    if (!l) return;
    App.openSheet({
      title: "Delivery list", tall: true,
      body: `<p class="muted small" style="margin:0 0 10px">From ${esc(l.sent_by_name)} · week of ${esc(l.week_start)} · ${esc(l.file_name)}</p>
        ${l.rows.map((r) => { const z = P().routeOf(r.rte); return `<div class="mini-row" style="align-items:center"><span class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(r.name)}</b><span class="small muted">${esc(r.pos)} · ${esc([r.addr, r.city].filter(Boolean).join(", "))}</span></span>${z ? `<span class="chip ${z === "Z02" ? "brand" : ""}">${z}</span>` : `<span class="chip warn">No route</span>`}</div>`; }).join("")}`,
      footer: `<button class="btn btn-primary" data-action="listYes" data-id="${esc(l.id)}">${l.status === "planned" ? "Plan again" : "Plan route with this list"}</button>`,
    });
  }
  function listNo(d) {
    const l = R().lists.find((x) => x.id === d.id);
    if (!l) return;
    l.status = "kept";
    RT().persist();
    App.outbox.add("route.listAnswer", { id: l.id, status: "kept" });
    App.outbox.flush();
    App.render();
    App.snackbar("The list is kept on the Route tab. You can plan with it any time.");
  }

  function renderNextWeek() {
    const np = R().next;
    const back = `<button class="back" data-action="tab" data-screen="route">${icon("back", 20)} Route</button>`;
    if (!np || !RT().activeStops(np).length) return `${back}<div class="empty">No route for next week.</div>`;
    const all = np.dates.map((d) => ({ d, L: RT().legs(np, d), list: RT().dayStops(np, d) }));
    return `${back}
      <div class="page-h"><h1>Next week</h1><span class="sub num">${np.dates.length} days · ${RT().activeStops(np).length} stops</span></div>
      ${RT().routeMap(np, np.dates, "next")}
      ${all.map(({ d, L, list }) => `<section class="card plan-day" style="--dc:${RT().dayColor(np, d)}">
        <div class="card-h"><h2><span class="day-dot"></span>${weekday(d)} <span class="num">${d}</span></h2><span class="muted small num">${list.length} stops · ${RT().fmtKm(L.m)} km · ${RT().fmtDur(L.s)}</span></div>
        ${list.map((s, i) => `<button class="mini-stop" data-action="stopTap" data-id="${esc(s.id)}" data-owner="next"><span class="num-badge sm">${i + 1}</span><span class="grow ellipsis"><b>${esc(s.name)}</b> <span class="muted">${esc(s.addr)}</span></span></button>`).join("") || `<p class="muted small" style="margin:0">No stops.</p>`}
      </section>`).join("")}
      <p class="hint" style="text-align:center">Tap a stop to move it to another day or remove it.</p>`;
  }

  /* ---------------- wiring ---------------- */
  Object.assign(App.SCREENS, { upload: renderUpload, planSetup: renderPlanSetup, planReview: renderPlanReview, nextWeek: renderNextWeek });
  App.actionbars = App.actionbars || {};
  App.actionbars.upload = () => {
    const u = up();
    if (!u?.an || u.busy) return "";
    const left = u.an.attn.filter((it) => !isResolved(it)).length;
    return `<span class="grow small">${left ? `<b>${left}</b> to answer` : "All checked"}</span>
      <button class="btn btn-primary" data-action="toDates" ${left ? "disabled" : ""}>Next: Days ${icon("chev", 16)}</button>`;
  };
  App.actionbars.planSetup = () => `<button class="btn btn-primary block lg" data-action="planRoute" ${up()?.dates.size && !up().planning ? "" : "disabled"}>${up()?.planning ? "Planning…" : "Plan route"}</button>`;
  App.actionbars.planReview = () => `<button class="btn btn-primary block lg" data-action="saveRoute">Save route</button>`;

  Object.assign(App.ACTIONS, {
    startUpload: () => startUpload(),
    upWeek: (d) => { const u = up(); u.week = d.week; u.dates = new Set(); App.render(); },
    retryAnalyze: runAnalyze,
    cancelUpload: () => { R().up = null; R().draft = null; App.go("route"); },
    resolve,
    unresolve: (d) => { delete up().res[d.key]; App.render(); },
    geoTry,
    addFromList,
    toDates: () => App.go("planSetup"),
    backToCheck: () => App.go("upload"),
    backToSetup: () => App.go("planSetup"),
    toggleDate: (d) => { const s = up().dates; if (s.has(d.date)) s.delete(d.date); else s.add(d.date); App.render(); },
    editStart: () => { up().editStart = true; App.render(); },
    planRoute,
    reviewDay: (d) => { R().reviewDay = d.date || null; App.render(); },
    replanDraft,
    saveRoute,
    listYes: (d) => { App.closeSheet(false); const l = R().lists.find((x) => x.id === d.id); if (l) startUpload({ list: l }); },
    listNo,
    listView,
  });

  App.routeUpload = { listCards, todayCards, readFile, analyze, lookupCustomers, useRows, FILE_TYPES };
})();
