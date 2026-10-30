/* Customers (ROLES_PROPOSAL.md 4.3, REGION_PROPOSAL.md 3.3-3.6): the customer search used by
 * Add Delivery and Fill Log ("Search all provinces" when this province has nothing), the
 * Customers page, the reload plants and the CSV import (website only). */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { $, esc, icon, localDate, nowHHMM } = App;
  const S = () => App.S;
  const sb = () => window.supabaseClient;
  const prov = () => S().loc?.prov || "";
  const provName = (p) => App.location.provName(p);
  const reason = (error) => (navigator.onLine ? error.message : "No internet connection.");
  const where = (c) => [c.accountAddress, c.city].filter(Boolean).join(", ");
  const stamp = (iso) => (iso ? `${localDate(new Date(iso))} ${nowHHMM(new Date(iso))}` : "");

  /* ---------------- search in a customer field ---------------- */
  const hits = {};
  const option = (c, i, pick) => `<button class="cust-opt" data-action="${pick}" data-i="${i}"><b>${esc(c.accountName)}</b><span class="small muted">${esc(c.accountNumber)} · ${esc(where(c))}${c.province && c.province !== prov() ? ` ${esc(c.province)}` : ""}${c.route ? ` · ${esc(c.route)}` : ""}</span></button>`;

  // box: id of the results element; pick: the action that takes the chosen customer (data-i);
  // none: added when nothing is found anywhere; all: the results of "Search all provinces".
  function resultsHtml(q, box, pick, none = "", all = null) {
    if (!String(q || "").trim()) { hits[box] = []; return ""; }
    const list = all || App.data.searchCustomers(App.data.cachedCustomers(), q);
    hits[box] = list;
    if (all) {
      if (!list.length) return `<p class="muted small" style="margin:4px 2px">No customer found in any province.${none ? ` ${esc(none)}` : ""}</p>`;
      return `<p class="muted small" style="margin:4px 2px">All provinces · up to 20 results</p>${list.map((c, i) => option(c, i, pick)).join("")}`;
    }
    if (!list.length) {
      return `<p class="muted small" style="margin:4px 2px">No customer found${prov() ? ` in ${esc(provName(prov()))}` : ""}.</p>
        <button class="btn btn-sm btn-outline" data-action="searchAll" data-box="${esc(box)}" data-pick="${esc(pick)}" data-none="${esc(none)}" data-q="${esc(q)}">${icon("search", 16)} Search all provinces</button>`;
    }
    const shown = list.slice(0, 5);
    return shown.map((c, i) => option(c, i, pick)).join("")
      + (list.length > shown.length ? `<p class="muted small" style="margin:2px">${list.length - shown.length} more. Type more to narrow the list.</p>` : "");
  }

  // One query to the server, at most 20 customers (decision 8).
  async function searchAll(d) {
    const box = () => $("#" + d.box);
    if (!box()) return;
    box().innerHTML = `<p class="muted small" style="margin:4px 2px">Searching all provinces…</p>`;
    try {
      const list = await App.data.searchAllProvinces(d.q);
      if (box()) box().innerHTML = resultsHtml(d.q, d.box, d.pick, d.none, list);
    } catch (error) {
      if (box()) box().innerHTML = `<p class="err" style="margin:4px 2px">${navigator.onLine ? esc(error.message) : "No connection. Searching all provinces needs a connection."}</p>`;
    }
  }

  // The chosen customer. One from another province stays on this phone for the day (3.5).
  function hit(box, i) {
    const c = hits[box]?.[i] || null;
    if (c) App.data.keepCustomer(c);
    return c;
  }

  /* ---------------- Customers page ---------------- */
  const ROUTES = [["Z02", "Z02 · local"], ["Z01", "Z01 · long distance"]];
  const SHOW_MAX = 100;
  const cs = () => (S().cust ||= { q: "", all: false, allList: null, error: "", noProv: false });
  const source = () => (cs().all ? cs().allList || [] : App.data.provinceCustomers());
  const findCust = (id) => source().find((x) => x.id === id) || App.data.cachedCustomers().find((x) => x.id === id) || null;

  function listHtml() {
    const c = cs();
    if (c.all && !c.allList) return `<div class="empty">${esc(c.error || "Loading all provinces…")}</div>`;
    let list = c.q.trim() ? App.data.searchCustomers(source(), c.q) : source();
    if (c.noProv) list = list.filter((x) => !x.province);
    list = list.slice().sort((a, b) => a.accountName.localeCompare(b.accountName) || a.accountAddress.localeCompare(b.accountAddress));
    if (!list.length) return `<div class="empty">${source().length ? "No customers match." : "No customers on this phone yet."}</div>`;
    const shown = list.slice(0, SHOW_MAX);
    return shown.map((x) => `<button class="rowbtn" data-action="custOpen" data-id="${esc(x.id)}">
        <div class="grow"><div class="rec-name">${esc(x.accountName)}</div><div class="rec-sub">${esc(where(x) || "No address")}</div>
          <div class="rec-chips"><span class="chip">Acc ${esc(x.accountNumber)}</span>${!x.province ? `<span class="chip warn">No province</span>` : c.all || x.province !== prov() ? `<span class="chip">${esc(x.province)}</span>` : ""}${x.route ? `<span class="chip ${x.route === "Z02" ? "brand" : ""}">${esc(x.route)}</span>` : `<span class="chip warn">No route</span>`}</div></div>
        <span class="muted" style="align-self:center">${icon("chev", 20)}</span></button>`).join("")
      + (list.length > shown.length ? `<p class="hint" style="text-align:center">${list.length - shown.length} more. Search to narrow the list.</p>` : "");
  }

  // CSV import is for computers on the website (decision 13).
  const canImport = () => App.canEditCustomer() && !App.inApp && !App.location.isPhone();

  function renderCustomers() {
    const c = cs(), edit = App.canEditCustomer(), p = prov();
    const back = App.tabsFor().includes("customers") ? "" : `<button class="back" data-action="tab" data-screen="more">${icon("back", 20)} More</button>`;
    const noProv = edit ? source().filter((x) => !x.province).length : 0;
    return `${back}<div class="page-h"><h1>Customers</h1>${App.canAddCustomer() ? `<button class="btn btn-sm btn-primary" data-action="custAdd">${icon("plus", 16)} Add</button>` : ""}</div>
      <div class="search-wrap" style="margin-bottom:12px">${icon("search", 18)}<input class="input" id="custQ" placeholder="Account no., name, address, city or route" value="${esc(c.q)}" autocomplete="off" aria-label="Search customers"></div>
      ${edit ? `<div class="segmented" role="group" aria-label="Province" style="margin-bottom:12px">
          <button class="${c.all ? "" : "on"}" data-action="custScope" data-all="0">${esc(p ? provName(p) : "This phone")}</button>
          <button class="${c.all ? "on" : ""}" data-action="custScope" data-all="1">All provinces</button></div>`
        : `<p class="hint" style="margin:-4px 2px 12px">${p ? `Customers in ${esc(provName(p))}.` : "Customers on this phone."} Change the province at the top of the screen.</p>`}
      ${edit ? plantsHtml() : ""}
      ${edit ? positionsHtml() : ""}
      ${noProv ? `<div class="note-box">${noProv} customer${noProv === 1 ? " has" : "s have"} no province yet, so every province downloads ${noProv === 1 ? "it" : "them"}. Edit ${noProv === 1 ? "it" : "them"} to set the province.
          <div style="margin-top:8px"><button class="btn btn-sm btn-outline" data-action="custNoProv">${c.noProv ? "Show all customers" : "Show them"}</button></div></div>` : ""}
      ${canImport() ? `<button class="btn btn-sm btn-outline" data-action="custImport" style="margin-bottom:12px">${icon("upload", 16)} Import CSV</button><input type="file" id="custCsv" accept=".csv,text/csv" hidden>` : ""}
      <div class="list" id="custList">${listHtml()}</div>
      <p class="hint" style="text-align:center;margin-top:14px">${canImport() ? "CSV columns: Account Number, Name, Address, City, Route and Province (or State/Prov)."
        : edit ? "Import CSV is on the website (computer only)."
        : App.canAddCustomer() ? "You can add customers. Supervisors, managers and admins can edit or delete them." : ""}</p>`;
  }
  App.onInput.custQ = (t) => { cs().q = t.value; const box = $("#custList"); if (box) box.innerHTML = listHtml(); };

  async function setScope(all) {
    const c = cs();
    c.noProv = false;
    if (!all) { c.all = false; c.allList = null; return App.render(); }
    if (!navigator.onLine) return App.showResult(false, "No connection", "All provinces needs a connection.", `Still showing ${p0()}.`);
    c.all = true; c.error = ""; c.allList = null;
    App.render();
    try { c.allList = await App.data.fetchAllCustomers(); } catch (error) { c.error = reason(error); }
    App.render();
  }
  const p0 = () => (prov() ? provName(prov()) : "the customers on this phone");

  function openCustomer(id) {
    const x = findCust(id);
    if (!x) return;
    App.openSheet({
      title: esc(x.accountName),
      body: `<div class="kmbox" style="margin-bottom:12px"><b>${esc(where(x) || "No address")}</b><div class="small muted">Acc ${esc(x.accountNumber)} · Route ${esc(x.route || "—")} · ${esc(x.province ? provName(x.province) : "No province")}</div></div>
        ${App.canEditCustomer() ? `<div class="grid2"><button class="btn btn-outline" data-action="custEdit" data-id="${esc(x.id)}">${icon("edit", 18)} Edit</button><button class="btn btn-danger-outline" data-action="custDelete" data-id="${esc(x.id)}">${icon("trash", 18)} Delete</button></div>`
          : App.canAddCustomer() ? `<p class="hint" style="margin:0">Only supervisors, managers and admins can edit or delete customers.</p>` : ""}`,
    });
  }

  // x: the customer to edit; prefill: a new customer's details (Add to customers from a delivery
  // list, ROLES_PROPOSAL.md decision 14; from a picture of a list, ROUTE_PROPOSAL.md decision 39,
  // with its note and the picture above each field) and onSaved, called with the saved customer.
  let onSaved = null;
  function openForm(x = null, prefill = null, saved = null) {
    onSaved = saved;
    const v = x || prefill || null;
    const p = v?.province || (x ? "" : prov());
    const route = x ? x.route : prefill ? prefill.route : "Z02";
    const pic = (k) => prefill?.pics?.[k] || "";
    const routes = route && !ROUTES.some(([k]) => k === route) ? [...ROUTES, [route, route]] : ROUTES;
    App.openSheet({
      title: x ? "Edit customer" : "Add customer",
      tall: true,
      body: `${prefill ? `<div class="note-box">${esc(prefill.note || "From the delivery list. Check the details, then save.")}</div>` : ""}
        <div class="field"><label class="label" for="cuAcc">Account Number *</label><input class="input" id="cuAcc" value="${esc(v?.accountNumber || "")}" autocomplete="off" ${x ? "readonly" : ""}></div>
        <div class="field"><label class="label" for="cuName">Name *</label>${pic("accountName")}<input class="input" id="cuName" value="${esc(v?.accountName || "")}" autocomplete="off"></div>
        <div class="field"><label class="label" for="cuAddr">Address *</label>${pic("accountAddress")}<input class="input" id="cuAddr" value="${esc(v?.accountAddress || "")}" autocomplete="off"></div>
        <div class="field"><label class="label" for="cuCity">City *</label>${pic("city")}<input class="input" id="cuCity" value="${esc(v ? v.city : S().loc?.city || "")}" autocomplete="off"></div>
        <div class="field"><label class="label" for="cuProv">Province *</label><select class="select" id="cuProv">${p ? "" : `<option value="" selected>Choose…</option>`}${App.location.PROVINCES.map(([k, n]) => `<option value="${k}" ${k === p ? "selected" : ""}>${k} · ${esc(n)}</option>`).join("")}</select></div>
        <div class="field"><label class="label" for="cuRoute">Route *</label><select class="select" id="cuRoute">${route ? "" : `<option value="" selected>Choose…</option>`}${routes.map(([k, n]) => `<option value="${esc(k)}" ${k === route ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="custSave">Save</button>`,
      data: { id: x?.id || null },
    });
  }

  // Numbers 000-099 are kept for reload plants (REGION_PROPOSAL.md decision 19); the database checks it too.
  const plantCode = (acc) => { const c = String(acc).trim().toUpperCase().replace(/-INST$/, ""); return /^[0-9]{1,3}$/.test(c) && Number(c) <= 99; };

  function stored(cust) {
    App.data.putCustomer(cust, prov());
    const c = cs();
    if (c.allList) c.allList = [...c.allList.filter((x) => x.id !== cust.id), cust];
  }

  async function saveCustomer() {
    const id = S().sheet.data.id;
    const f = { acc: $("#cuAcc").value.trim(), name: $("#cuName").value.trim(), addr: $("#cuAddr").value.trim(), city: $("#cuCity").value.trim(), prov: $("#cuProv").value, route: $("#cuRoute").value };
    if (!f.acc || !f.name || !f.addr || !f.city || !f.prov || !f.route) return App.sheetErr("Fill in all fields marked *.");
    if (!id && plantCode(f.acc)) return App.sheetErr("Numbers 000–099 are reload plant codes. Use the customer's account number.");
    const row = { account_name: f.name, account_address: f.addr, city: f.city, province: f.prov, route: f.route };
    App.sheetBusy(true);
    let data;
    try {
      if (id) {
        ({ data } = await App.data.call(sb().from("tdg_customers").update(row).eq("id", id).select(App.data.CUST_COLS).single()));
      } else {
        // The account number is checked in every province (3.4).
        const { data: dup } = await App.data.call(sb().from("tdg_customers").select("account_number, account_name, province").eq("account_number", f.acc).maybeSingle());
        if (dup) {
          App.sheetBusy(false);
          return App.sheetErr(`Customer ${dup.account_number} already exists${dup.province ? ` in ${provName(dup.province)}` : ""} (${dup.account_name}).`);
        }
        ({ data } = await App.data.call(sb().from("tdg_customers").insert({ account_number: f.acc, ...row }).select(App.data.CUST_COLS).single()));
      }
    } catch (error) {
      App.sheetBusy(false);
      return App.sheetErr(`Not saved: ${reason(error)}`);
    }
    const cust = App.data.toCustomer(data);
    stored(cust);
    App.closeSheet(false);
    const done = onSaved;
    onSaved = null;
    App.showResult(true, id ? "Customer updated" : "Customer added", "Saved to Supabase.", `${f.name} · ${f.addr}, ${f.city} · ${f.prov} · ${f.route}`, done ? () => done(cust) : null);
    App.render();
  }

  function deleteCustomer(id) {
    const x = findCust(id);
    if (!x) return;
    App.showConfirm({
      title: "Delete this customer?", okText: "Delete", danger: true,
      msg: `${x.accountName}${where(x) ? `, ${where(x)}` : ""}. Saved delivery records keep the name and address.`,
      onOk: async () => {
        let deleted = 0;
        try { ({ data: deleted } = await App.data.call(sb().from("tdg_customers").delete().eq("id", id).select("id"))); deleted = deleted?.length || 0; } catch (error) {
          App.closeSheet(false);
          return App.showResult(false, "Customer not deleted", reason(error), "Nothing was changed.");
        }
        App.closeSheet(false);
        App.data.dropCustomer(id);
        if (cs().allList) cs().allList = cs().allList.filter((c) => c.id !== id);
        if (!deleted) App.showResult(false, "Customer not deleted", "It was already deleted, or your account cannot delete customers.", "");
        else App.showResult(true, "Customer deleted", "Saved to Supabase.", `${x.accountName}${where(x) ? ` · ${where(x)}` : ""}`);
        App.render();
      },
    });
  }

  /* ---------------- recent position changes (ROLES_PROPOSAL.md decision 12) ---------------- */
  // Positions fixed by drivers on the map or at the customer; Supervisor, Manager and Admin can change them back.
  function positionsHtml() {
    const c = cs();
    if (!c.posLog) {
      if (!c.posLoading && navigator.onLine !== false) {
        c.posLoading = true;
        App.data.call(sb().from("tdg_customer_position_log").select("id, account_number, account_name, changed_by_name, changed_by_role, changed_at, from_lat").is("reverted_at", null).order("changed_at", { ascending: false }).limit(10))
          .then(({ data }) => { c.posLog = data || []; }, () => { c.posLog = []; })
          .finally(() => { c.posLoading = false; App.render(); });
      }
      return "";
    }
    if (!c.posLog.length) return "";
    return `<section class="card" aria-label="Recent position changes"><div class="card-h"><h2>Recent position changes</h2></div>
      ${c.posLog.map((l) => `<div class="mini-row" style="align-items:center"><span class="grow"><b>${esc(l.account_name || l.account_number)}</b><div class="small muted">${esc(l.changed_by_name)} (${esc(l.changed_by_role)}) · ${esc(stamp(l.changed_at))}</div></span>
        <button class="btn btn-sm btn-outline" data-action="revertPos" data-id="${esc(l.id)}">Change back</button></div>`).join("")}</section>`;
  }
  function revertPos(d) {
    const l = cs().posLog.find((x) => x.id === d.id);
    if (!l) return;
    App.showConfirm({
      title: "Change the position back?", okText: "Change back",
      msg: `${l.account_name || l.account_number}: the position before ${l.changed_by_name}'s change${l.from_lat == null ? " (none: it will be looked up from the address again)" : ""}.`,
      onOk: async () => {
        try {
          const { data } = await App.data.call(sb().rpc("tdg_customer_revert_position", { p_log_id: l.id }));
          const cust = App.data.cachedCustomers().find((x) => x.id === data.id);
          if (cust) App.data.putCustomer({ ...cust, lat: data.lat, lng: data.lng, geoSource: data.geo_source }, prov());
        } catch (error) {
          return App.showResult(false, "Position not changed back", reason(error), "Nothing was changed.");
        }
        cs().posLog = null;
        App.showResult(true, "Position changed back", "Saved to Supabase.", `${l.account_name || l.account_number} uses its earlier position again.`);
        App.render();
      },
    });
  }

  /* ---------------- reload plants ---------------- */
  function plantsHtml() {
    const all = App.data.cachedPlants(), p = prov();
    const cur = p ? App.data.plantsIn(p).length : 0;
    const provs = App.location.PROVINCES.filter(([k]) => all.some((x) => x.province === k));
    const open = cs().plantsOpen ?? !!(p && !cur);
    return `<details class="fold" ${open ? "open" : ""}><summary data-action="plantsFold">Reload plants · ${all.length} in ${provs.length} province${provs.length === 1 ? "" : "s"}</summary><div class="fold-b">
      <p class="small muted" style="margin:0 0 8px">Drivers' Reload lists the plants of the province they are in. Add a province's plants before sending a driver there.</p>
      ${p && !cur ? `<div class="note-box">No reload plant in ${esc(provName(p))} yet.</div>` : ""}
      <button class="btn btn-sm btn-primary" data-action="plantAdd">${icon("plus", 16)} Add plant</button>
      ${provs.map(([k, n]) => `<p class="label" style="margin:14px 0 0">${k} · ${esc(n)}${k === p ? ` <span class="chip brand">Current</span>` : ""}</p>
        ${all.filter((x) => x.province === k).map((x) => `<div class="mini-row" style="align-items:center"><span class="grow">${esc(x.name)}<div class="small muted">Code ${esc(x.code)} · ${esc([x.address, x.city].filter(Boolean).join(", "))}${x.updatedBy ? ` · ${esc(x.updatedBy)} · ${esc(stamp(x.updatedAt))}` : ""}</div>
          <div class="small ${x.emails.length ? "muted" : ""}" style="overflow-wrap:anywhere">${x.emails.length ? `Receipt email: ${x.emails.map(esc).join(", ")}` : `<span class="chip warn">No receipt email</span>`}</div></span>
          <button class="btn btn-sm btn-outline" data-action="plantEdit" data-id="${esc(x.id)}">Edit</button></div>`).join("")}`).join("")}
    </div></details>`;
  }

  function openPlant(id = null) {
    const x = id ? App.data.cachedPlants().find((p) => p.id === id) : null;
    App.openSheet({
      title: x ? `Reload plant · code ${esc(x.code)}` : "Add reload plant",
      tall: true,
      body: `${x ? `<div class="kmbox" style="margin-bottom:12px"><b>${esc(provName(x.province))}</b><div class="small muted">The code and province stay the same. Saved reload records keep their old location.</div></div>`
          : `<div class="note-box">The plant gets the next free code (000–099) when you save.</div>
        <div class="field"><label class="label" for="plProv">Province *</label><select class="select" id="plProv">${prov() ? "" : `<option value="" selected>Choose…</option>`}${App.location.PROVINCES.map(([k, n]) => `<option value="${k}" ${k === prov() ? "selected" : ""}>${k} · ${esc(n)}</option>`).join("")}</select></div>`}
        <div class="field"><label class="label" for="plName">Plant name *</label><input class="input" id="plName" value="${esc(x?.name || "")}" placeholder="e.g. Linde Burnaby Plant" autocomplete="off"></div>
        <div class="field"><label class="label" for="plAddr">Address *</label><input class="input" id="plAddr" value="${esc(x?.address || "")}" autocomplete="off"></div>
        <div class="field"><label class="label" for="plCity">City *</label><input class="input" id="plCity" value="${esc(x?.city || "")}" autocomplete="off"></div>
        <div class="field"><label class="label" for="plMail">Receipt email</label><input class="input" id="plMail" type="text" inputmode="email" autocomplete="off" autocapitalize="none" value="${esc(x ? x.emails.join(", ") : "")}" placeholder="name@example.com">
          <p class="hint">Drivers email their Reload Log here. Separate several addresses with commas. Optional: without it, drivers can still print or save the PDF.</p></div>`,
      footer: `${x ? `<button class="btn btn-danger-outline" data-action="plantRemove">Remove</button>` : `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button>`}<button class="btn btn-primary" data-action="plantSave">Save</button>`,
      data: { id: x?.id || null },
    });
  }

  async function savePlant() {
    const old = App.data.cachedPlants().find((p) => p.id === S().sheet.data.id) || null;
    const f = { id: old?.id || null, province: old ? old.province : $("#plProv").value, name: $("#plName").value.trim(), address: $("#plAddr").value.trim(), city: $("#plCity").value.trim() };
    if (!f.province || !f.name || !f.address || !f.city) return App.sheetErr("Fill in all fields marked *.");
    f.emails = $("#plMail").value.split(/[,;\s]+/).filter(Boolean);
    const bad = f.emails.find((m) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m));
    if (bad) return App.sheetErr(`Check the receipt email: ${bad}`);
    App.sheetBusy(true);
    let plant;
    try { plant = await App.data.savePlant(f); } catch (error) { App.sheetBusy(false); return App.sheetErr(`Not saved: ${reason(error)}`); }
    App.closeSheet(false);
    App.showResult(true, "Reload plant saved", "Saved to Supabase.", `${provName(plant.province)}: ${plant.name} · code ${plant.code}. Saved reload records keep their old location.`);
    App.render();
  }

  function removePlant() {
    const old = App.data.cachedPlants().find((p) => p.id === S().sheet.data.id);
    if (!old) return;
    const lastOne = App.data.plantsIn(old.province).length === 1;
    App.showConfirm({
      title: "Remove this reload plant?", okText: "Remove", danger: true,
      msg: `${old.name} (code ${old.code}). Code ${old.code} will not be used again.${lastOne ? ` Drivers in ${provName(old.province)} cannot add a Reload until another plant is added.` : ""}`,
      onOk: async () => {
        try { await App.data.removePlant(old.id); } catch (error) {
          App.closeSheet(false);
          return App.showResult(false, "Reload plant not removed", reason(error), "Nothing was changed.");
        }
        App.closeSheet(false);
        App.showResult(true, "Reload plant removed", "Saved to Supabase.", `${old.name} (code ${old.code}). Saved reload records keep their old location.`);
        App.render();
      },
    });
  }

  /* ---------------- CSV import (website, Supervisor, Manager, Admin) ---------------- */
  // The current site's column names (any upper or lower case), plus Province (also "State/Prov",
  // REGION_PROPOSAL.md 3.4).
  const CSV_COLS = {
    account_number: ["accountNumber", "accountNo", "no", "Position", "Account Number", "AccountNo"],
    account_name: ["accountName", "name", "Customer Name", "Account Name"],
    account_address: ["accountAddress", "address", "Address", "Account Address"],
    city: ["city", "City"],
    route: ["route", "Route"],
    province: ["province", "Province", "State/Prov"],
  };

  function provinceCode(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    const hit = App.location.PROVINCES.find(([k, n]) => k === s.toUpperCase() || n.toLowerCase() === s.toLowerCase());
    return hit ? hit[0] : null;
  }

  // Rows for the upsert, or the first problem found. Missing columns cannot clear existing values,
  // so all columns but Province are required; without Province, customers keep theirs.
  function csvRows(text) {
    let body;
    try { body = window.TDG_CSV.parse(text); } catch (error) { return { error: `${error.message}.` }; }
    if (!body.length) return { error: "The CSV file has no rows." };
    const names = Object.keys(body[0]);
    const at = {};
    for (const [col, aliases] of Object.entries(CSV_COLS)) at[col] = names.find((n) => aliases.some((a) => a.toLowerCase() === n.toLowerCase()));
    if (["account_number", "account_name", "account_address", "city", "route"].some((c) => !at[c])) {
      return { error: "The CSV needs the columns Account Number, Name, Address, City and Route (and Province or State/Prov). Missing columns cannot clear existing values." };
    }
    const rows = [];
    for (const [i, r] of body.entries()) {
      const row = {};
      for (const col of Object.keys(CSV_COLS)) if (at[col]) row[col] = r[at[col]];
      if (!row.account_number || !row.account_name) return { error: `Row ${i + 2}: Account Number and Name are needed.` };
      if ("province" in row) {
        const code = provinceCode(row.province);
        if (code == null) return { error: `Row ${i + 2}: "${row.province}" is not a province. Use a code such as MB or ON.` };
        row.province = code;
      }
      rows.push(row);
    }
    if (new Set(rows.map((r) => r.account_number)).size !== rows.length) return { error: "The CSV has the same Account Number more than once." };
    return { rows, withProvince: !!at.province };
  }

  async function importCsv(text) {
    const parsed = csvRows(text);
    if (parsed.error) return App.showResult(false, "CSV not imported", parsed.error, "Nothing was changed.");
    let existing;
    try { existing = new Set((await App.data.fetchAllCustomers()).map((c) => c.accountNumber)); } catch (error) {
      return App.showResult(false, "CSV not imported", reason(error), "Nothing was changed.");
    }
    const fresh = parsed.rows.filter((r) => !existing.has(r.account_number));
    const plant = fresh.find((r) => plantCode(r.account_number));
    if (plant) return App.showResult(false, "CSV not imported", `${plant.account_number} is a new customer number in 000–099. These numbers are kept for reload plants.`, "Nothing was changed.");
    App.showConfirm({
      title: `Import ${parsed.rows.length} customers?`, okText: "Import",
      msg: `${fresh.length} new, ${parsed.rows.length - fresh.length} updated. Existing values, including empty cells, are replaced.${parsed.withProvince ? "" : " There is no Province column: customers keep their province, new ones get none."}`,
      onOk: async () => {
        try {
          for (let i = 0; i < parsed.rows.length; i += 500) {
            await App.data.call(sb().from("tdg_customers").upsert(parsed.rows.slice(i, i + 500), { onConflict: "account_number", ignoreDuplicates: false }));
          }
        } catch (error) {
          return App.showResult(false, "CSV not fully imported", reason(error), "Rows before the problem may be saved. Fix the file and import it again.");
        }
        cs().allList = null;
        cs().all = false;
        await App.syncRegion({ full: true });
        App.showResult(true, "CSV imported", "Saved to Supabase.", `${fresh.length} new, ${parsed.rows.length - fresh.length} updated.`);
      },
    });
  }
  App.onChange.custCsv = async (t) => {
    const file = t.files?.[0];
    t.value = "";
    if (file) await importCsv(await file.text());
  };

  App.SCREENS.customers = renderCustomers;
  Object.assign(App.ACTIONS, {
    searchAll,
    custScope: (d) => setScope(d.all === "1"),
    custNoProv: () => { cs().noProv = !cs().noProv; App.render(); },
    custOpen: (d) => openCustomer(d.id),
    custAdd: () => openForm(),
    custEdit: (d) => { App.closeSheet(false); openForm(findCust(d.id)); },
    custSave: saveCustomer,
    custDelete: (d) => deleteCustomer(d.id),
    custImport: () => $("#custCsv")?.click(),
    // Stays open or closed across re-renders (the click comes before the browser toggles it).
    plantsFold: (d, el) => { cs().plantsOpen = !el.parentElement.open; },
    revertPos,
    plantAdd: () => openPlant(),
    plantEdit: (d) => openPlant(d.id),
    plantSave: savePlant,
    plantRemove: removePlant,
  });

  App.customers = { resultsHtml, hit, csvRows, openNew: (prefill, saved) => openForm(null, prefill, saved) };
  // for the website's own Customers page (js/app/web_customers.js)
  App.customers.kit = { cs, source, findCust, prov, provName, where, stamp, plantsHtml, positionsHtml, canImport };
})();
