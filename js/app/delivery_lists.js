/* More → Delivery Lists (ROUTE_PROPOSAL.md 3.6.1, decisions 31-33; mockups/web-delivery-lists.html).
 * Website only, for Supervisor, Manager and Admin: send one driver the delivery list for a week;
 * the driver decides on the phone whether the system plans the route. Lists sent are shown with
 * their status: New, Planned, Kept, Replaced. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { $, esc, icon, addDays, localDate, nowHHMM } = App;
  const P = () => window.TDG_ROUTE_PLAN;
  const S = () => App.S;
  const sb = () => window.supabaseClient;

  const canSend = () => ["supervisor", "manager", "admin"].includes(S().role);
  App.canSendLists = () => canSend() && !App.inApp && !App.location.isPhone();
  const STATUS = { new: "New · not answered yet", planned: "Planned · route made", kept: "Kept · driver chose No", replaced: "Replaced" };
  const dl = () => (S().dl ||= { driver: null, week: addDays(App.route.mondayOf(localDate()), 7), file: null, rows: null, sum: null, sent: null, filter: "all", error: "" });

  async function loadSent() {
    const d = dl();
    try {
      await App.viewing.people();
      const { data } = await App.data.call(sb().from("tdg_route_lists").select("id, driver_id, week_start, file_name, sent_by_name, sent_at, status").order("sent_at", { ascending: false }).limit(200));
      d.sent = data || [];
    } catch (error) { d.error = App.route.reason(error); d.sent = []; }
    App.render();
  }
  const nameOf = (id) => (S().people || []).find((p) => p.id === id)?.display_name || "—";
  const at = (iso) => `${localDate(new Date(iso))} ${nowHHMM(new Date(iso))}`;

  // How the list splits, for the summary: Z02 / Z01 by CO2 Rte (or the customer's Route) and codes not in Customers.
  async function summarize(rows) {
    const keys = [...new Set(rows.map((r) => P().normAcc(r.pos)).filter(Boolean))];
    const found = new Map();
    for (let i = 0; i < keys.length; i += 40) {
      const part = keys.slice(i, i + 40);
      const { data } = await App.data.call(sb().from("tdg_customers").select("account_number, route").in("account_number", part.flatMap((k) => [k, `${k}-INST`])));
      for (const c of data || []) found.set(P().normAcc(c.account_number), c);
    }
    let z02 = 0, z01 = 0, missing = 0;
    const carry = rows.filter((r) => r.carry).length;
    for (const r of rows) {
      const c = found.get(P().normAcc(r.pos));
      if (!c) missing++;
      const z = P().routeOf(r.rte) || P().routeOf(c?.route);
      if (z === "Z02") z02++; else if (z === "Z01") z01++;
    }
    return { rows: rows.length, z02, z01, missing, carry };
  }

  function renderLists() {
    const back = `<button class="back" data-action="tab" data-screen="more">${icon("back", 20)} More</button>`;
    if (!App.canSendLists()) return `${back}<div class="empty">Delivery Lists is on the website (computer) for supervisors, managers and admins. Drivers get their lists on the Route tab.</div>`;
    const d = dl();
    if (!d.sent) { loadSent(); return `${back}<div class="page-h"><h1>Delivery Lists</h1></div><div class="empty">Loading…</div>`; }
    const people = (S().people || []).filter((p) => ["driver", "supervisor", "admin"].includes(p.role));
    if (!d.driver && people.length) d.driver = people[0].id;
    const mon = App.route.mondayOf(localDate());
    const weeks = [addDays(mon, 7), mon, addDays(mon, 14)];
    const prev = d.sent.find((x) => x.driver_id === d.driver && x.week_start === d.week && x.status !== "replaced");
    const shown = d.sent.filter((x) => d.filter === "all" || x.week_start === d.filter);
    const weeksSent = [...new Set(d.sent.map((x) => x.week_start))].sort().reverse();
    const first = nameOf(d.driver).split(" ")[0];
    return `${back}
      <div class="page-h"><h1>Delivery Lists</h1></div>
      <p class="muted" style="margin:-6px 2px 14px">Send a week's delivery list to one driver. The driver decides on the phone whether the system plans the route.</p>
      <section class="card" aria-label="Send a list">
        <div class="card-h"><h2>Send a list</h2></div>
        <div class="field"><label class="label" for="dlDriver">Driver *</label>
          <select class="select" id="dlDriver">${people.map((p) => `<option value="${esc(p.id)}" ${p.id === d.driver ? "selected" : ""}>${esc(p.display_name || p.driver_number)} · ${esc(p.driver_number)}</option>`).join("")}</select></div>
        <div class="field"><label class="label" for="dlWeek">Week *</label>
          <select class="select" id="dlWeek">${weeks.map((w) => `<option value="${w}" ${w === d.week ? "selected" : ""}>Week of ${w}${w === addDays(mon, 7) ? " (next week)" : w === mon ? " (this week)" : ""}</option>`).join("")}</select></div>
        <div class="field"><span class="label">Delivery list file *</span>
          ${d.file ? `<div class="file-row">${icon("file", 18)}<b class="grow">${esc(d.file)}</b><label class="btn btn-sm btn-outline" for="dlFile">Change</label></div>
            ${d.sum ? `<div class="grid3" style="grid-template-columns:repeat(4,1fr);margin:10px 0"><div class="kmbox"><div class="k">Rows</div><div class="v">${d.sum.rows}</div></div><div class="kmbox"><div class="k">Z02</div><div class="v">${d.sum.z02}</div></div><div class="kmbox"><div class="k">Z01</div><div class="v">${d.sum.z01}</div></div><div class="kmbox"><div class="k">Not in Customers</div><div class="v">${d.sum.missing}</div></div></div>
              ${d.sum.carry ? `<p class="small muted" style="margin:0 0 6px">${d.sum.carry} carryover${d.sum.carry > 1 ? "s" : ""} needing fills (italic in the PDF). The driver sees them marked Carryover.</p>` : ""}
              <p class="small muted" style="margin:0">The driver answers any questions (Z01/Z02, address, position) when planning. The start point is set by the driver.</p>` : `<p class="muted small">Reading the list…</p>`}`
          : `<label class="upload-drop" for="dlFile" role="button">${icon("upload", 26)}<div style="font-weight:750;margin-top:6px">Choose file</div><div class="small muted">Excel (.xlsx), CSV or PDF</div></label>`}
          <input type="file" id="dlFile" accept="${App.routeUpload.FILE_TYPES}" hidden>
        </div>
        ${prev ? `<div class="warn-box"><span><b>${esc(nameOf(d.driver))}</b> already has a list for this week: ${esc(prev.file_name)}, sent ${esc(at(prev.sent_at))} by ${esc(prev.sent_by_name)} (${STATUS[prev.status]}). Sending replaces it, and ${esc(first)} is asked again whether to plan.</span></div>` : ""}
        <button class="btn btn-primary block" data-action="dlSend" ${d.rows && d.sum && d.driver ? "" : "disabled"}>Send to ${esc(nameOf(d.driver))}</button>
      </section>
      <section class="card" aria-label="Lists sent">
        <div class="card-h"><h2>Lists sent</h2>
          <select class="select" id="dlFilter" style="width:auto;min-height:36px"><option value="all">All weeks</option>${weeksSent.map((w) => `<option value="${w}" ${d.filter === w ? "selected" : ""}>Week of ${w}</option>`).join("")}</select></div>
        ${d.error ? `<p class="err">${esc(d.error)}</p>` : ""}
        ${shown.map((x) => `<div class="mini-row ${x.status === "replaced" ? "muted" : ""}" data-list="${esc(x.id)}" style="align-items:center">
            <span class="grow" style="min-width:0"><b>${esc(nameOf(x.driver_id))}</b> <span class="num small">· week of ${esc(x.week_start)}</span>
              <div class="small muted" style="overflow-wrap:anywhere">${esc(x.file_name)} · sent ${esc(at(x.sent_at))} by ${esc(x.sent_by_name)}</div></span>
            <span class="chip ${x.status === "planned" ? "ok" : x.status === "kept" ? "warn" : x.status === "new" ? "brand" : ""}">${STATUS[x.status]}</span></div>`).join("") || `<p class="muted small" style="margin:0">No lists.</p>`}
      </section>
      <div class="note-box">Undelivered stops are deleted at Friday Off-Duty. If a driver still needs to deliver them, add them to next week's list before sending.</div>`;
  }

  App.onChange.dlDriver = (t) => { dl().driver = t.value; App.render(); };
  App.onChange.dlWeek = (t) => { dl().week = t.value; App.render(); };
  App.onChange.dlFilter = (t) => { dl().filter = t.value; App.render(); };
  App.onChange.dlFile = async (t) => {
    const file = t.files?.[0];
    t.value = "";
    if (!file) return;
    const d = dl();
    let read;
    try { read = await App.routeUpload.readFile(file); } catch (error) { read = { error: error.message }; }
    if (read.error) return App.showResult(false, "List not read", read.error, "Check that it is the delivery list (Excel .xlsx, CSV or PDF with the customer codes and addresses).");
    Object.assign(d, { file: file.name, rows: read.rows, sum: null });
    App.render();
    try { d.sum = await summarize(read.rows); } catch (error) { d.file = null; d.rows = null; return App.showResult(false, "List not read", App.route.reason(error), ""); }
    App.render();
  };

  function send() {
    const d = dl(), prev = d.sent.find((x) => x.driver_id === d.driver && x.week_start === d.week && x.status !== "replaced");
    const name = nameOf(d.driver), first = name.split(" ")[0];
    App.showConfirm({
      title: `Send to ${name}?`, okText: "Send",
      msg: `${d.file} for the week of ${d.week}. ${prev ? `It replaces ${prev.file_name}.` : "Only this driver receives it."} ${first} sees “New delivery list. Let the system plan your route?” on the phone.`,
      onOk: async () => {
        try {
          await App.data.call(sb().rpc("tdg_route_list_send", { p_driver: d.driver, p_week: d.week, p_file: d.file, p_rows: d.rows }));
        } catch (error) {
          return App.showResult(false, "List not sent", App.route.reason(error), "Nothing was sent.");
        }
        Object.assign(d, { file: null, rows: null, sum: null, sent: null });
        App.showResult(true, "List sent", "Saved to Supabase.", `${name} sees it on the Route tab and the Today page.`);
        App.render();
      },
    });
  }

  App.SCREENS.deliveryLists = renderLists;
  App.ACTIONS.dlSend = send;
})();
