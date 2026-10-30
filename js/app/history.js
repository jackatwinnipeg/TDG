/* History, a day's details and the reports (mockups/mobile-ui-v2.html, DEV_PLAN.md phase 3).
 * Reports are the current site's own print pages shown in a frame, so the format is exactly
 * the website's (ANDROID_APP_PROPOSAL.md decision 19). On the website they are printed from
 * there; Save PDF and Email PDF come with the Android app. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { $, esc, fmtN, icon, weekday, addDays, localDate, normVeh } = App;
  const V = () => window.TDG_VOLUME;
  const S = () => App.S;

  function hist() {
    const s = S();
    if (!s.hist) {
      const today = localDate();
      s.hist = {
        from: addDays(today, -13), to: today,
        f: { keyword: "", cycle: "All", route: "All", vehicle: "", acc: "", city: "" },
        data: null, loading: false, error: "", selecting: false, selected: new Set(),
      };
    }
    return s.hist;
  }

  /* ---------------- days from records and shift rows ---------------- */
  // Whole-day shift (MULTI_VEHICLE_PROPOSAL.md decision 1): first check-in; last check-out once
  // every vehicle is checked out.
  function dayShift(rows) {
    const by = (k) => rows.filter((r) => r[k]).slice().sort((a, b) => String(a[k]).localeCompare(String(b[k])));
    const allOut = rows.length && rows.every((r) => r.check_out_time);
    return { start: by("check_in_at")[0]?.check_in_time || "", end: allOut ? by("check_out_at").at(-1)?.check_out_time || "" : "" };
  }

  function buildDays(data) {
    const byDate = new Map();
    for (const r of data.records) {
      if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, records: [], shifts: [] });
      byDate.get(r.date).records.push(r);
    }
    for (const row of data.shifts) byDate.get(row.work_date)?.shifts.push(row);
    return [...byDate.values()].map((d) => {
      const deliveries = d.records.filter((r) => !V().isNonDeliveryEvent(r));
      return {
        ...d, deliveries,
        vehicles: [...new Set(d.records.map((r) => normVeh(r.vehicleNo)))],
        cycle: d.records.find((r) => r.weekCycle)?.weekCycle || "",
        lbs: deliveries.reduce((a, r) => a + (Number(r.deliveredVolume) || 0), 0),
        shift: dayShift(d.shifts),
      };
    }).sort((a, b) => b.date.localeCompare(a.date));
  }

  function filteredDays() {
    const h = hist(), f = h.f;
    if (!h.data) return [];
    const kw = f.keyword.trim().toLowerCase();
    return buildDays(h.data).filter((d) => {
      if (f.cycle !== "All" && String(d.cycle) !== f.cycle) return false;
      if (f.vehicle && !d.vehicles.some((v) => v.includes(normVeh(f.vehicle)))) return false;
      const recs = d.deliveries;
      if (f.acc && !recs.some((r) => String(r.accountNumber).includes(f.acc.trim()))) return false;
      if (f.city && !recs.some((r) => String(r.accountCity).toLowerCase().includes(f.city.trim().toLowerCase()))) return false;
      if (f.route !== "All" && !recs.some((r) => String(r.accountRoute).toUpperCase() === f.route)) return false;
      if (kw && !recs.some((r) => [r.emergency ? "emergency" : "", r.accountName, r.accountAddress, r.accountCity, r.notes].join(" ").toLowerCase().includes(kw))) return false;
      return true;
    });
  }
  const activeFilterCount = () => {
    const f = hist().f;
    return [f.keyword, f.vehicle, f.acc, f.city].filter((x) => x.trim()).length + (f.cycle !== "All") + (f.route !== "All");
  };

  async function loadHistory() {
    const h = hist();
    h.loading = true; h.error = "";
    App.render();
    try {
      const owner = App.viewing.ownerOf();
      if (!owner) { await App.viewing.people(); }
      h.data = await App.data.fetchHistory(App.viewing.ownerOf(), h.from, h.to);
    } catch (error) {
      h.error = navigator.onLine ? error.message : "No internet connection. History needs a connection.";
    }
    h.loading = false;
    App.render();
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /* ---------------- History screen ---------------- */
  function dateField(key, value) {
    return `<div class="datefield-wrap">
      <button class="datefield" data-action="pickDate" data-key="${key}" aria-label="${/from/i.test(key) ? "Date from" : "Date to"} ${value}">${value || "—"}</button>
      <input type="date" class="date-native" id="date-${key}" value="${value}" tabindex="-1" aria-hidden="true">
    </div>`;
  }

  function renderHistory() {
    const h = hist();
    if (!h.data && !h.loading && !h.error) setTimeout(loadHistory);
    const days = filteredDays();
    const n = activeFilterCount();
    const list = h.loading ? `<div class="empty">Loading…</div>`
      : h.error ? `<div class="empty">${esc(h.error)}</div>`
      : days.length ? days.map((d) => {
        const on = h.selected.has(d.date);
        return `<button class="rowbtn" data-action="${h.selecting ? "toggleDay" : "openDay"}" data-date="${d.date}" ${h.selecting ? `aria-pressed="${on}"` : ""}>
          ${h.selecting ? `<span class="check ${on ? "on" : ""}">${icon("check", 16)}</span>` : ""}
          <div class="grow">
            <div class="row"><span class="day-date">${d.date}</span><span class="muted small">${weekday(d.date)}</span></div>
            <div class="rec-chips">
              ${d.vehicles.map((v) => `<span class="chip brand">${esc(v)}</span>`).join("")}
              ${d.cycle ? `<span class="chip">Cycle ${esc(d.cycle)}</span>` : ""}
              ${d.deliveries.some((r) => r.emergency) ? `<span class="chip emg sm">${icon("siren", 11)} EMERGENCY</span>` : ""}
            </div>
            <div class="rec-sub num" style="margin-top:8px">${plural(d.deliveries.length, "delivery", "deliveries")} · ${fmtN(d.lbs)} lbs${d.shift.start ? ` · Shift ${esc(d.shift.start)}–${esc(d.shift.end || "…")}` : ""}</div>
          </div>
          ${h.selecting ? "" : `<span class="muted" style="align-self:center">${icon("chev", 20)}</span>`}
        </button>`;
      }).join("") : `<div class="empty">No days match these filters.</div>`;
    return `
      <div class="page-h"><h1>History</h1>
        <button class="btn btn-sm ${h.selecting ? "btn-primary" : "btn-outline"}" data-action="toggleSelect">${h.selecting ? "Done" : "Select"}</button></div>
      <div class="grid2" style="margin-bottom:12px">
        <button class="btn btn-sm btn-outline" data-action="fillLogSearch">${icon("file", 16)} Fill Log</button>
        <button class="btn btn-sm btn-outline" data-action="openReloadLog">${icon("file", 16)} Reload Log</button>
      </div>
      ${App.canRecord() ? "" : App.viewing.driverSelect()}
      <div class="date-range">
        <div><span class="label">From</span>${dateField("from", h.from)}</div>
        <div><span class="label">To</span>${dateField("to", h.to)}</div>
        <button class="btn btn-outline" data-action="filters" aria-label="More filters">${icon("filter", 18)}${n ? `<span class="badge">${n}</span>` : ""}</button>
      </div>
      <div class="summary-line"><span>${days.length} ${days.length === 1 ? "day" : "days"} · ${plural(days.reduce((a, d) => a + d.deliveries.length, 0), "delivery", "deliveries")}</span></div>
      <div class="list">${list}</div>`;
  }

  function onDateChange(key, input) {
    const h = hist();
    if (!input.value) return;
    h[key] = input.value;
    if (h.from > h.to) { if (key === "from") h.to = h.from; else h.from = h.to; }
    h.selected.clear();
    loadHistory();
  }
  App.onChange["date-from"] = (t) => onDateChange("from", t);
  App.onChange["date-to"] = (t) => onDateChange("to", t);

  function openFilters() {
    const f = hist().f;
    const opt = (vals, cur) => vals.map((v) => `<option ${String(v) === cur ? "selected" : ""}>${v}</option>`).join("");
    App.openSheet({
      title: "Filters",
      body: `
        <div class="field"><label class="label" for="hfKw">Keyword</label><input class="input" id="hfKw" value="${esc(f.keyword)}" placeholder="Customer, address or note"></div>
        <div class="grid2">
          <div class="field"><label class="label" for="hfCycle">Week Cycle</label><select class="select" id="hfCycle">${opt(["All", 1, 2, 3, 4, 5, 6, 7, 8], f.cycle)}</select></div>
          <div class="field"><label class="label" for="hfRoute">Route</label><select class="select" id="hfRoute">${opt(["All", "Z01", "Z02"], f.route)}</select></div>
        </div>
        <div class="field"><label class="label" for="hfVeh">Vehicle No</label><input class="input" id="hfVeh" value="${esc(f.vehicle)}" autocapitalize="characters"></div>
        <div class="grid2">
          <div class="field"><label class="label" for="hfAcc">Account Number</label><input class="input" id="hfAcc" value="${esc(f.acc)}"></div>
          <div class="field"><label class="label" for="hfCity">City</label><input class="input" id="hfCity" value="${esc(f.city)}"></div>
        </div>`,
      footer: `<button class="btn btn-outline" data-action="resetFilters">Reset</button><button class="btn btn-primary" data-action="applyFilters">Apply</button>`,
    });
  }
  function applyFilters() {
    Object.assign(hist().f, { keyword: $("#hfKw").value, cycle: $("#hfCycle").value, route: $("#hfRoute").value, vehicle: $("#hfVeh").value, acc: $("#hfAcc").value, city: $("#hfCity").value });
    App.closeSheet(false); App.render();
  }
  function resetFilters() {
    Object.assign(hist().f, { keyword: "", cycle: "All", route: "All", vehicle: "", acc: "", city: "" });
    App.closeSheet(false); App.render();
  }

  /* ---------------- one day ---------------- */
  // The open day on this phone comes from the phone; other days from the server.
  function dayFromPhone() {
    const segs = App.day.segments();
    return {
      date: S().day.date, today: true, records: S().records.filter((r) => r.date === S().day.date),
      shift: { start: App.day.dayStart(), end: App.day.dayEnd() },
      vehicles: segs.map((g) => ({ v: g.vehicle, start: g.startKm, end: g.endKm })),
      cycle: S().day.weekCycle,
    };
  }
  function dayFromServer(date, data) {
    return {
      date, today: false, records: data.records, shift: dayShift(data.shifts),
      vehicles: [...new Set([...data.shifts.map((r) => normVeh(r.vehicle_no)), ...data.records.map((r) => normVeh(r.vehicleNo))])].map((v) => {
        const row = data.shifts.find((r) => normVeh(r.vehicle_no) === v);
        const log = data.logs.filter((l) => normVeh(l.vehicle_no) === v).at(-1);
        const end = Number(log?.payload?.form?.endKm);
        return { v, start: row ? Number(row.start_km) : null, end: end > 0 ? end : null };
      }),
      cycle: data.records.find((r) => r.weekCycle)?.weekCycle || "",
    };
  }

  function openDay(date, from) {
    const s = S();
    s.dayView = { date, from: from || s.screen, data: null, error: "" };
    App.go("day");
    if (App.viewing.mine() && date === s.day.date && App.day.segments().length) return;
    App.data.fetchDay(App.viewing.ownerOf(), date).then(
      (data) => { if (s.dayView?.date === date) { s.dayView.data = data; App.render(); } },
      (error) => { if (s.dayView?.date === date) { s.dayView.error = navigator.onLine ? error.message : "No internet connection."; App.render(); } },
    );
  }

  // Characters a file name cannot hold are left out (as in the mockup).
  const fileSafe = (v) => String(v || "").replace(/[\\/:*?"<>|]/g, "").trim();
  const driverName = () => App.viewing.viewedName() || S().session.username;
  const tdgFile = (vehicle, date) => `Linde-${fileSafe(vehicle)}-${fileSafe(driverName())}-TDG Report-${date}.pdf`;

  function renderDay() {
    const s = S(), view = s.dayView;
    const backLabel = { history: "History", deliveries: "Deliveries", today: "Today" }[view.from] || "Back";
    const back = `<button class="back" data-action="back">${icon("back", 20)} ${backLabel}</button>`;
    let d;
    if (App.viewing.mine() && view.date === s.day.date && App.day.segments().length) d = dayFromPhone();
    else if (view.data) d = dayFromServer(view.date, view.data);
    else return `${back}<div class="page-h"><h1 class="num">${esc(view.date)}</h1></div><div class="empty">${esc(view.error || "Loading…")}</div>`;
    if (!d.records.length && !d.vehicles.length) {
      return `${back}<div class="page-h"><h1 class="num">${esc(d.date)}</h1></div><div class="empty">${d.today ? "No shift yet today. Check in first." : "Nothing was recorded on this day."}</div>`;
    }
    const vehicles = d.vehicles.length ? d.vehicles : [...new Set(d.records.map((r) => normVeh(r.vehicleNo)))].map((v) => ({ v, start: null, end: null }));
    const km = (n) => (n != null ? fmtN(n) : "—");
    const files = vehicles.map((x) => tdgFile(x.v, d.date));
    const printLabel = App.inApp ? "" : `<button class="btn btn-primary" data-action="previewPdf">${icon("print", 18)} Print</button>`;
    return `
      ${back}
      <div class="page-h"><h1 class="num">${esc(d.date)}</h1><span class="sub">${weekday(d.date)}${d.cycle ? ` · Cycle ${esc(d.cycle)}` : ""}</span></div>
      <section class="card">
        <div class="kv">
          <div class="kmbox"><div class="k">Shift Start</div><div class="v">${esc(d.shift.start || "—")}</div></div>
          <div class="kmbox"><div class="k">Shift Finish</div><div class="v">${esc(d.shift.end || "—")}</div></div>
        </div>
        ${d.today && !d.shift.end ? `<p class="hint">Shift Finish is filled in after the last vehicle is checked out.</p>` : ""}
        <table class="tbl" style="margin-top:12px">
          <thead><tr><th>Vehicle</th><th>Start KM</th><th>End KM</th><th>Total</th></tr></thead>
          <tbody>${vehicles.map((x) => `<tr><td><b>${esc(x.v)}</b></td><td>${km(x.start)}</td><td>${km(x.end)}</td><td>${x.start != null && x.end != null ? fmtN(x.end - x.start) + " km" : "—"}</td></tr>`).join("")}</tbody>
        </table>
      </section>
      <section class="card">
        <div class="card-h"><h2>Deliveries</h2></div>
        ${vehicles.map((x) => {
          const recs = d.records.filter((r) => normVeh(r.vehicleNo) === x.v && !V().isNonDeliveryEvent(r)).sort((a, b) => String(a.arrivalTime).localeCompare(String(b.arrivalTime)));
          const lbs = recs.reduce((a, r) => a + (Number(r.deliveredVolume) || 0), 0);
          return `<div class="group-h"><span class="chip brand">${esc(x.v)}</span><span class="small muted num">${recs.length} · ${fmtN(lbs)} lbs</span></div>
            ${recs.length ? recs.map((r) => `<div class="mini-row"><span class="num" style="width:44px;font-weight:700">${esc(r.arrivalTime)}</span><span class="grow ellipsis">${r.emergency ? `<span class="chip emg sm">${icon("siren", 11)} EMERGENCY</span> ` : ""}${esc(r.accountName)}</span><span class="num" style="font-weight:700">${fmtN(r.deliveredVolume)} lbs</span></div>`).join("") : `<p class="muted small">No deliveries.</p>`}
            <div style="height:8px"></div>`;
        }).join("")}
      </section>
      <section class="card">
        <div class="card-h"><h2>TDG Report</h2><span class="muted small">${files.length} PDF${files.length > 1 ? "s" : ""}</span></div>
        ${files.map((f) => `<div class="file-row">${icon("file", 18)}<span>${esc(f)}</span></div>`).join("")}
        ${App.inApp ? `<button class="btn btn-outline block" style="margin-top:6px" data-action="previewPdf">${icon("file", 16)} Preview PDF</button>
          <div class="grid2" style="margin-top:8px"><button class="btn btn-outline" data-action="dayPdf" data-how="save">${icon("download", 18)} Save PDF</button><button class="btn btn-primary" data-action="dayPdf" data-how="email">${icon("mail", 18)} Email PDF</button></div>`
          : `<div class="grid2" style="margin-top:6px">
          <button class="btn btn-outline" data-action="previewPdf">${icon("file", 16)} Preview PDF</button>
          ${printLabel}
        </div>`}
        ${files.length > 1 ? `<p class="hint">One page per truck.</p>` : ""}
      </section>`;
  }

  /* ---------------- report preview: the website's print pages in a frame ---------------- */
  const PAGE_WIDTH = 1100; // px the print pages are laid out for (A4 landscape sheet is 277 mm)

  // Shows a print page scaled to the sheet's width; ready() resolves when its data is in.
  // pdf (in the app): { files(doc) → [{ html, fileName, page }], subject(files), to, print }.
  function openPreview({ title, src, prepare, ready, fileName, pdf = null }) {
    prepare();
    S().preview = { pdf, doc: null };
    const appButtons = App.inApp && pdf
      ? `<button class="btn btn-outline" data-action="pvSave" disabled>${icon("download", 16)} Save PDF</button><button class="btn btn-primary" data-action="pvEmail" disabled>${icon("mail", 16)} Email PDF</button>${pdf.print ? `<button class="btn btn-outline" data-action="pvPrint" disabled>${icon("print", 16)} Print</button>` : ""}`
      : "";
    App.openSheet({
      title,
      tall: true,
      body: `<div class="pdf-tools"><span class="small muted" id="pvName">${esc(fileName || "")}</span>
          <span class="segmented" role="group" aria-label="Zoom"><button class="${S().pdfZoom !== "100" ? "on" : ""}" data-action="pdfZoom" data-z="fit">Fit</button><button class="${S().pdfZoom === "100" ? "on" : ""}" data-action="pdfZoom" data-z="100">100%</button></span></div>
        <div class="pdf-pages" id="pvPages"><div class="pdf-page" id="pvPage"><iframe id="pvFrame" title="${esc(title)}" src="${esc(src)}"></iframe></div></div>
        <p class="muted small" id="pvStatus" style="margin:8px 0 0">Loading the report…</p>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Close</button>${App.inApp ? appButtons : `<button class="btn btn-primary" data-action="printPreview" id="pvPrint" disabled>${icon("print", 18)} Print</button>`}`,
    });
    const frame = $("#pvFrame");
    frame.addEventListener("load", async () => {
      const doc = frame.contentDocument;
      // The page's own buttons are replaced by the app's.
      const style = doc.createElement("style");
      style.textContent = ".toolbar, .no-print, .actions { display: none !important; } body { background: #fff !important; }";
      doc.head.appendChild(style);
      try {
        const name = await ready(doc);
        if (name) { $("#pvName").textContent = name; doc.title = name.replace(/\.pdf$/, ""); }
        else if (fileName) doc.title = fileName.replace(/\.pdf$/, "");
        $("#pvStatus").textContent = "";
        const btn = $("#pvPrint");
        if (btn) btn.disabled = false;
        if (S().preview) S().preview.doc = doc;
        document.querySelectorAll('#sheet [data-action="pvSave"], #sheet [data-action="pvEmail"], #sheet [data-action="pvPrint"]').forEach((b) => { b.disabled = false; });
      } catch (error) {
        $("#pvStatus").textContent = error.message;
      }
      fitPreview();
    });
  }

  // Fit: the page scaled to the sheet's width; 100%: real size, scroll sideways.
  function fitPreview() {
    const box = $("#pvPages"), frame = $("#pvFrame");
    if (!box || !frame?.contentDocument) return;
    const scale = S().pdfZoom === "100" ? 1 : Math.min(1, (box.clientWidth - 16) / PAGE_WIDTH);
    const height = frame.contentDocument.documentElement.scrollHeight;
    frame.style.width = PAGE_WIDTH + "px";
    frame.style.height = height + "px";
    frame.style.transform = `scale(${scale})`;
    $("#pvPage").style.width = PAGE_WIDTH * scale + "px";
    $("#pvPage").style.height = height * scale + "px";
    if (App.web) App.webPreviewFit(PAGE_WIDTH); // the website sizes its drawer to the report (js/app/web.js)
  }

  const waitFor = (test, ms = 20000) => new Promise((resolve, reject) => {
    const until = Date.now() + ms;
    (function check() {
      const v = test();
      if (v) return resolve(v);
      if (Date.now() > until) return reject(new Error("The report did not load. Check the connection and try again."));
      setTimeout(check, 150);
    })();
  });

  // TDG Daily Logs through batch_tdg_print.html: one page per truck and day.
  const tdgPage = (groups) => ({
    src: "./batch_tdg_print.html",
    prepare: () => window.TDG_STORAGE.setItem("tdg_batch_tdg_selection_v1", JSON.stringify({ groups })),
    ready: (doc) => waitFor(() => {
      const status = doc.getElementById("batchStatus")?.textContent || "";
      if (/ready/i.test(status)) return true;
      if (doc.querySelector(".error-box")) throw new Error(doc.querySelector(".error-box").textContent);
      return false;
    }).then(() => null),
  });
  // In the app: one PDF per truck and day (decisions 17, 18), cut from the rendered page.
  function tdgFiles(doc) {
    const field = (sheet, name) => sheet.querySelector(`[data-field="${name}"]`)?.textContent.trim() || "";
    return [...doc.querySelectorAll("#sheets .sheet")].map((sheet, i) => {
      const vehicle = normVeh(field(sheet, "hdrVehicle"));
      return {
        vehicle, page: "a4-landscape", fileName: tdgFile(vehicle, field(sheet, "hdrDate")),
        html: App.native.snapshot(doc, (root) => root.querySelectorAll("#sheets .sheet").forEach((x, j) => { if (j !== i) x.remove(); })),
      };
    });
  }
  // Subject without dates; several trucks joined with "/" (decisions 15, 17).
  const tdgSubject = (files) => `Linde-${[...new Set(files.map((f) => f.vehicle))].join("/")}-${fileSafe(driverName())}-TDG Report`;
  const TDG_PDF = { files: tdgFiles, subject: tdgSubject };

  function previewTdg(groups, title) {
    openPreview({
      title, ...tdgPage(groups),
      fileName: groups.length === 1 && groups[0].vehicleNo ? tdgFile(groups[0].vehicleNo, groups[0].date) : "",
      pdf: TDG_PDF,
    });
  }
  // Save PDF / Email PDF straight from the day or the selected days, without the preview.
  async function tdgPdfs(groups, how) {
    let files;
    try { files = await App.native.renderPage({ ...tdgPage(groups), files: tdgFiles }); } catch (error) { return App.showResult(false, "PDF not made", error.message, "Check the connection and try again."); }
    if (how === "email") return App.native.emailPdfs(files.map(({ vehicle, ...f }) => f), tdgSubject(files));
    return App.native.savePdfs(files.map(({ vehicle, ...f }) => f));
  }

  function previewDay() {
    const view = S().dayView;
    previewTdg([{ date: view.date, ownerId: App.viewing.ownerOf() }], `TDG Report · ${view.date}`);
  }

  /* ---------------- Fill Log: search a customer, then its sheet ---------------- */
  function openFillLogSearch() {
    App.openSheet({
      title: "Fill Log",
      tall: true,
      body: `<p class="muted small" style="margin:0 0 10px">One sheet per customer: the latest 14 deliveries by all drivers.</p>
        <label class="label" for="flSearch">Find customer</label>
        <div class="search-wrap">${icon("search", 18)}<input class="input" id="flSearch" placeholder="Account no., name, address, city or route" autocomplete="off"></div>
        <div class="cust-results" id="flResults"></div>`,
    });
  }
  // Fill Log looks customers up in every province (REGION_PROPOSAL.md 3.3) through "Search all provinces".
  App.onInput.flSearch = (t) => { const box = $("#flResults"); if (box) box.innerHTML = App.customers.resultsHtml(t.value, "flResults", "pickFillLog"); };

  // File name (decision 20): Linde-<account without -INST>-<name>-Fill Log-<newest delivery date>.pdf
  const fillLogFile = (c, newest) => `Linde-${fileSafe(String(c.accountNumber).replace(/-INST$/i, ""))}-${fileSafe(c.accountName)}-Fill Log${newest ? `-${newest}` : ""}.pdf`;

  function previewFillLog(c) {
    App.closeSheet(false);
    openPreview({
      title: `Fill Log · ${esc(c.accountName)}`,
      src: "./fill_log.html",
      prepare: () => window.TDG_STORAGE.setItem("tdg_fill_log_record_v1", JSON.stringify({ accountNumber: c.accountNumber, accountName: c.accountName, accountAddress: c.accountAddress, accountCity: c.city })),
      ready: (doc) => waitFor(() => doc.querySelector("#logBody tr")).then(() => {
        const first = doc.querySelector("#logBody tr td")?.textContent.trim() || "";
        return fillLogFile(c, (first.match(/\d{4}-\d{2}-\d{2}/) || [""])[0]);
      }),
      fileName: fillLogFile(c, ""),
      pdf: {
        files: (doc) => [{ html: App.native.snapshot(doc), fileName: $("#pvName")?.textContent || fillLogFile(c, ""), page: "letter" }],
        subject: () => `Linde-${fileSafe(String(c.accountNumber).replace(/-INST$/i, ""))}-${fileSafe(c.accountName)}-Fill Log`,
      },
    });
  }

  /* ---------------- selecting days ---------------- */
  function selectionBar() {
    const h = hist();
    const sel = h.selected.size;
    if (App.inApp) {
      return `<span class="grow small"><b>${sel}</b> selected</span>
        <button class="btn btn-sm btn-outline" data-action="selPdf" data-how="save" ${sel ? "" : "disabled"}>${icon("download", 16)} Save PDFs</button>
        <button class="btn btn-sm btn-primary" data-action="selPdf" data-how="email" ${sel ? "" : "disabled"}>${icon("mail", 16)} Email PDFs</button>`;
    }
    return `<span class="grow small"><b>${sel}</b> selected</span>
      <button class="btn btn-sm btn-primary" data-action="printSelected" ${sel ? "" : "disabled"}>${icon("print", 16)} Preview &amp; Print</button>`;
  }

  Object.assign(App.SCREENS, { history: renderHistory, day: renderDay });
  App.actionbars = App.actionbars || {};
  App.actionbars.history = () => (hist().selecting ? selectionBar() : "");

  // Opening the History tab reads the server again (new deliveries may have uploaded since).
  const tab = App.ACTIONS.tab;
  Object.assign(App.ACTIONS, {
    tab: (d) => { if (d.screen === "history") hist().data = null; tab(d); },
    openDay: (d) => openDay(d.date, d.from),
    back: () => App.go(S().dayView?.from || "history"),
    toggleSelect: () => { const h = hist(); h.selecting = !h.selecting; h.selected.clear(); App.render(); },
    toggleDay: (d) => { const h = hist(); if (h.selected.has(d.date)) h.selected.delete(d.date); else h.selected.add(d.date); App.render(); },
    pickDate: (d) => { const i = $("#date-" + d.key); try { i.showPicker(); } catch { i.focus(); } },
    filters: openFilters, applyFilters, resetFilters,
    previewPdf: previewDay,
    printSelected: () => {
      const h = hist();
      const dates = [...h.selected].sort();
      previewTdg(dates.map((date) => ({ date, ownerId: App.viewing.ownerOf() })), `TDG Reports · ${dates.length} ${dates.length === 1 ? "day" : "days"}`);
    },
    printPreview: () => { const f = $("#pvFrame"); if (f) f.contentWindow.print(); },
    // In the app: from the open preview, the day, or the selected days.
    pvSave: () => { const p = S().preview; if (p?.doc) App.native.savePdfs(p.pdf.files(p.doc).map(({ vehicle, ...f }) => f)); },
    pvEmail: () => { const p = S().preview; if (!p?.doc) return; const files = p.pdf.files(p.doc); App.native.emailPdfs(files.map(({ vehicle, ...f }) => f), p.pdf.subject(files), p.pdf.to || []); },
    pvPrint: () => { const p = S().preview; if (!p?.doc) return; const [f] = p.pdf.files(p.doc); App.native.printHtml(f.html, f.fileName.replace(/\.pdf$/, ""), f.page); },
    dayPdf: (d) => tdgPdfs([{ date: S().dayView.date, ownerId: App.viewing.ownerOf() }], d.how),
    selPdf: (d) => tdgPdfs([...hist().selected].sort().map((date) => ({ date, ownerId: App.viewing.ownerOf() })), d.how),
    pdfZoom: (d) => {
      S().pdfZoom = d.z;
      document.querySelectorAll('[data-action="pdfZoom"]').forEach((b) => b.classList.toggle("on", b.dataset.z === d.z));
      fitPreview();
    },
    fillLogSearch: openFillLogSearch,
    pickFillLog: (d) => { const c = App.customers.hit("flResults", Number(d.i)); if (c) previewFillLog(c); },
  });

  App.history = { openDay, reload: loadHistory, hist, dateField, openPreview, waitFor, fileSafe, driverName, filteredDays, activeFilterCount, previewFillLog, previewTdg };
})();
