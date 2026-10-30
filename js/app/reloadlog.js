/* History → Reload Log (RELOAD_LOG_PROPOSAL.md 3.2, 3.3): one driver's reloads between two dates,
 * grouped by plant (one sheet per plant), printed on the paper form's layout (reload_log.html).
 * Who may look is the same as History: yourself, or the picked driver for Viewer and Manager. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { $, esc, icon, fmtN, localDate, normVeh, nowHHMM } = App;
  const V = () => window.TDG_VOLUME;
  const S = () => App.S;
  const H = () => App.history;

  const rl = () => S().rl;

  // Dates default to today every time it opens (decision 8); every reload starts selected.
  function openReloadLog() {
    const today = localDate();
    S().rl = { from: today, to: today, off: new Set(), data: null, loading: false, error: "", owner: null };
    App.go("reloadLog");
  }

  async function load() {
    const r = rl();
    const owner = App.viewing.ownerOf();
    if (!owner) return;
    r.loading = true;
    r.owner = owner;
    const key = `${owner}|${r.from}|${r.to}`;
    try {
      const { records } = await App.data.fetchHistory(owner, r.from, r.to);
      if (`${App.viewing.ownerOf()}|${rl().from}|${rl().to}` !== key) return;
      r.data = records.filter((x) => V().isReloadRecord(x));
      r.error = "";
    } catch (error) {
      r.error = navigator.onLine ? error.message : "No internet connection.";
    } finally {
      r.loading = false;
      App.render();
    }
  }

  // Reloads saved on this phone that are not on the server yet (decision 12).
  function waiting() {
    if (!App.canRecord()) return 0;
    const r = rl();
    return App.outbox.items().filter((it) => it.kind === "record.insert" && it.payload?.row?.raw?.eventType === "reload"
      && it.payload.row.work_date >= r.from && it.payload.row.work_date <= r.to).length;
  }

  const timeOf = (x) => x.arrivalTime || (x.completedAt ? nowHHMM(new Date(x.completedAt)) : "");
  // One sheet per plant (decision 7). Location is the city saved on the records, or the plant's
  // city now when a record has none (3.1, decision 5).
  function groups() {
    const plants = App.data.cachedPlants();
    const list = [];
    const recs = (rl().data || []).slice().sort((a, b) => `${a.date} ${timeOf(a)}`.localeCompare(`${b.date} ${timeOf(b)}`));
    for (const x of recs) {
      const code = String(x.accountNumber || "").trim();
      const plant = plants.find((p) => p.code === code);
      const city = x.accountCity || plant?.city || "";
      const key = `${code}|${city}`;
      let g = list.find((y) => y.key === key);
      if (!g) list.push(g = { key, code, name: x.accountName || plant?.name || "Reload", city, emails: plant?.emails || [], recs: [] });
      g.recs.push(x);
    }
    return list;
  }
  const rid = (x) => x.remoteId || x.clientRecordId;
  const selected = (g) => g.recs.filter((x) => !rl().off.has(rid(x)));
  const groupBy = (key) => groups().find((g) => g.key === key) || null;

  // Decision 11: Linde-<driver>-Reload Log-<first date>[_<last date>].pdf; the subject has no dates.
  function fileName(sel) {
    const dates = sel.map((x) => x.date).sort();
    const span = dates[0] === dates.at(-1) ? dates[0] : `${dates[0]}_${dates.at(-1)}`;
    return `Linde-${H().fileSafe(H().driverName())}-Reload Log-${span}.pdf`;
  }

  function groupCard(g, wait) {
    const sel = selected(g);
    const off = wait > 0 || !sel.length;
    return `<section class="card">
      <div class="card-h"><div class="grow"><h2>${esc(g.name)}</h2><div class="small muted">Code ${esc(g.code)} · Location: ${esc(g.city || "—")}</div></div><span class="chip brand">${sel.length} of ${g.recs.length}</span></div>
      ${g.recs.map((x) => {
        const on = !rl().off.has(rid(x));
        return `<button class="rl-row ${on ? "" : "off"}" data-action="rlToggle" data-id="${esc(rid(x))}" aria-pressed="${on}">
          <span class="check ${on ? "on" : ""}">${icon("check", 16)}</span>
          <span class="grow"><span class="num" style="font-weight:700">${esc(x.date)} ${esc(timeOf(x))}</span> <span class="muted">· ${esc(normVeh(x.vehicleNo))}</span></span>
          <span class="num" style="font-weight:700">${fmtN(x.reloadAmountKg)} kg</span></button>`;
      }).join("")}
      <div style="height:10px"></div>
      ${sel.length ? `<div class="file-row">${icon("file", 18)}<span>${esc(fileName(sel))}</span></div>` : `<p class="hint">Select at least one reload.</p>`}
      ${App.inApp ? `${g.emails.length ? `<p class="small muted" style="margin:0 0 8px;overflow-wrap:anywhere">Email to ${g.emails.map(esc).join(", ")}</p>` : ""}
        <button class="btn btn-sm btn-outline block" data-action="rlPreview" data-key="${esc(g.key)}" ${off ? "disabled" : ""}>${icon("file", 16)} Preview PDF</button>
        <div class="grid2" style="margin-top:8px">
          <button class="btn btn-primary" data-action="rlPrint" data-key="${esc(g.key)}" ${off ? "disabled" : ""}>${icon("print", 18)} Print</button>
          <button class="btn btn-outline" data-action="rlSave" data-key="${esc(g.key)}" ${off ? "disabled" : ""}>${icon("download", 18)} Save PDF</button>
        </div>
        <button class="btn btn-outline block" style="margin-top:8px" data-action="rlEmail" data-key="${esc(g.key)}" ${off || !g.emails.length ? "disabled" : ""}>${icon("mail", 18)} Email PDF to plant</button>
        ${g.emails.length ? "" : `<p class="hint">No receipt email for ${esc(g.name)}. Ask a supervisor to add it in Customers → Reload plants.</p>`}`
      : `<div class="grid2">
        <button class="btn btn-outline" data-action="rlPreview" data-key="${esc(g.key)}" ${off ? "disabled" : ""}>${icon("file", 16)} Preview PDF</button>
        <button class="btn btn-primary" data-action="rlPrint" data-key="${esc(g.key)}" ${off ? "disabled" : ""}>${icon("print", 18)} Print</button>
      </div>`}
    </section>`;
  }

  function renderReloadLog() {
    const r = rl();
    if (!r) { openReloadLog(); return ""; }
    const back = `<button class="back" data-action="tab" data-screen="history">${icon("back", 20)} History</button>`;
    const head = `${back}<div class="page-h"><h1>Reload Log</h1><span class="sub">Receipt for the plant</span></div>
      ${App.canRecord() ? "" : App.viewing.driverSelect()}
      <div class="date-range" style="grid-template-columns:1fr 1fr">
        <div><span class="label">From</span>${H().dateField("rlFrom", r.from)}</div>
        <div><span class="label">To</span>${H().dateField("rlTo", r.to)}</div>
      </div>`;
    if (!App.viewing.ownerOf()) return head;
    if (r.owner !== App.viewing.ownerOf()) { r.data = null; r.error = ""; r.off.clear(); }
    if (!r.data && !r.loading && !r.error) setTimeout(load);
    const wait = waiting();
    const warn = wait ? `<div class="warn-box"><span class="grow">${wait} Reload${wait > 1 ? "s are" : " is"} not uploaded yet. Upload ${wait > 1 ? "them" : "it"} first.</span><button class="btn btn-sm btn-primary" data-action="rlSync">Sync now</button></div>` : "";
    if (!r.data) return `${head}${warn}<div class="empty">${esc(r.error || "Loading…")}</div>`;
    const list = groups();
    return `${head}${warn}
      <div class="summary-line"><span>${r.data.length} reload${r.data.length === 1 ? "" : "s"} · ${list.length} plant${list.length === 1 ? "" : "s"}</span><span>One sheet per plant</span></div>
      ${list.length ? list.map((g) => groupCard(g, wait)).join("")
        : `<div class="empty">No reloads from ${esc(r.from)} to ${esc(r.to)}.<p class="hint">Change the dates${App.canRecord() ? ", or add a Reload on the Today screen" : ""}.</p></div>`}`;
  }

  function onDate(key, input) {
    const r = rl();
    if (!input.value) return;
    r[key] = input.value;
    if (r.from > r.to) { if (key === "from") r.to = r.from; else r.from = r.to; }
    r.data = null; r.error = ""; r.off.clear();
    App.render();
  }
  App.onChange["date-rlFrom"] = (t) => onDate("from", t);
  App.onChange["date-rlTo"] = (t) => onDate("to", t);

  // The sheet goes to reload_log.html through this phone's storage, as the Fill Log does.
  function page(g, sel, name) {
    return {
      src: "./reload_log.html",
      prepare: () => window.TDG_STORAGE.setItem("tdg_reload_log_v1", JSON.stringify({
        location: g.city, driver: H().driverName(), fileName: name,
        rows: sel.map((x) => ({ date: x.date, time: timeOf(x), tanker: normVeh(x.vehicleNo), kg: Math.trunc(Number(x.reloadAmountKg) || 0) })),
      })),
      ready: (doc) => H().waitFor(() => {
        const st = doc.getElementById("status");
        if (st?.classList.contains("error")) throw new Error(st.textContent);
        return /^Ready/.test(st?.textContent || "");
      }),
    };
  }
  // In the app: Letter landscape; the email goes to the plant's receipt emails, subject without dates (decisions 10, 11).
  const subject = () => `Linde-${H().fileSafe(H().driverName())}-Reload Log`;
  const pdf = (g, name) => ({ files: (doc) => [{ html: App.native.snapshot(doc), fileName: name, page: "letter-landscape" }], subject, to: g.emails, print: true });

  function preview(key, print = false) {
    const g = groupBy(key);
    const sel = g ? selected(g) : [];
    if (!sel.length || waiting()) return;
    const name = fileName(sel);
    const p = page(g, sel, name);
    H().openPreview({
      title: `Reload Log · ${esc(g.name)}`, ...p,
      ready: (doc) => p.ready(doc).then(() => {
        if (print) setTimeout(() => $("#pvFrame")?.contentWindow.print(), 50);
        return name;
      }),
      fileName: name,
      pdf: pdf(g, name),
    });
  }

  // In the app, straight from the card: Save PDF, Email PDF or Android's print dialog.
  async function appPdf(key, how) {
    const g = groupBy(key);
    const sel = g ? selected(g) : [];
    if (!sel.length || waiting()) return;
    const name = fileName(sel);
    let files;
    try { files = await App.native.renderPage({ ...page(g, sel, name), files: pdf(g, name).files }); } catch (error) { return App.showResult(false, "PDF not made", error.message, "Check the connection and try again."); }
    if (how === "print") return App.native.printHtml(files[0].html, name.replace(/\.pdf$/, ""), files[0].page);
    if (how === "email") return App.native.emailPdfs(files, subject(), g.emails);
    return App.native.savePdfs(files);
  }

  async function sync() {
    const r = await App.outbox.flush();
    if (!r.ok) return App.showResult(false, "Not uploaded", navigator.onLine ? r.error?.message || "Upload failed." : "No internet connection.", "The Reload Log can be made once the reloads are on the server.");
    Object.assign(rl(), { data: null, error: "" });
    App.render();
  }

  // Uploads finished or the connection is back: read the server again.
  function refresh() {
    const r = rl();
    if (S()?.screen !== "reloadLog" || !r || r.loading) return;
    Object.assign(r, { data: null, error: "" });
    App.render();
  }
  App.outbox.onChange(refresh);
  window.addEventListener("online", refresh);

  App.SCREENS.reloadLog = renderReloadLog;
  Object.assign(App.ACTIONS, {
    openReloadLog,
    rlToggle: (d) => { const off = rl().off; if (off.has(d.id)) off.delete(d.id); else off.add(d.id); App.render(); },
    rlPreview: (d) => preview(d.key),
    rlPrint: (d) => (App.inApp ? appPdf(d.key, "print") : preview(d.key, true)),
    rlSave: (d) => appPdf(d.key, "save"),
    rlEmail: (d) => appPdf(d.key, "email"),
    rlSync: sync,
  });
  App.reloadLog = { groups, fileName };
})();
