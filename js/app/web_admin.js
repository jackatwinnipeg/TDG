/* Website Admin pages (mockups/web-v1; ROLES_PROPOSAL.md decisions 6–9, 27, 28), Admin only, website only:
 * - Users: the accounts in tdg_profiles through the same calls and rules as admin.html (js/admin.js,
 *   tdg-admin-create-user / tdg-admin-update-user). Accounts are deactivated, never deleted (owner,
 *   2026-10-29); the only active Admin cannot change role or be deactivated (decision 9).
 * - Fill Log settings: each customer's Tank Size SF/BD, Gas Part Number and Fill box location
 *   (account_fill_log_profile), the fields the Fill Log prints; drivers can change them on the Fill Log too. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  if (!App.web) return;
  const { $, esc, fmtN, icon, localDate, nowHHMM } = App;
  const W = App.web$;
  const A = () => window.TDG_ADMIN;
  const sb = () => window.supabaseClient;
  const PER = 20;
  const fail = (title, error) => App.showResult(false, title, navigator.onLine ? error.message : "No internet connection.", "Nothing was changed.");
  const stamp = (iso) => (iso ? `${localDate(new Date(iso))} ${nowHHMM(new Date(iso))}` : "");
  const newPassword = () => { const C = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; return [...crypto.getRandomValues(new Uint32Array(14))].map((v) => C[v % C.length]).join(""); };

  // js/admin.js (the calls and rules of admin.html) is loaded only when an Admin opens Users or Fill Log
  // settings, so the other pages never carry it (loaded up front it slowed every page down).
  let adminJs = null;
  const needAdmin = () => (adminJs ||= new Promise((resolve, reject) => {
    if (window.TDG_ADMIN) return resolve();
    const s = document.createElement("script");
    s.src = "./js/admin.js?v=2";
    s.onload = () => (window.TDG_ADMIN ? resolve() : reject(new Error("The admin tools did not load.")));
    s.onerror = () => { adminJs = null; reject(new Error("The admin tools did not load. Check the connection and try again.")); };
    document.head.appendChild(s);
  }));

  /* ---------------- Users ---------------- */
  const us = () => (App.S.wusers ||= { list: null, loading: false, error: "", filter: "all", q: "", off: false, pick: null, saved: "" });
  async function loadUsers() {
    const u = us();
    u.loading = true; u.error = "";
    try { await needAdmin(); u.list = await A().Api.list(); } catch (error) { u.error = error.message; }
    u.loading = false;
    App.render();
  }
  const roleName = (r) => (A()?.ROLES.find(([k]) => k === r) || [r, r])[1];
  const onlyAdmin = (x) => x.isActive && x.role === "admin" && us().list.filter((y) => y.isActive && y.role === "admin").length === 1;

  function users() {
    const u = us();
    if (!u.list && !u.loading && !u.error) setTimeout(loadUsers);
    if (!u.list) return `${W.title("Users", u.error ? esc(u.error) : "Loading the accounts…", "")}`;
    const live = u.list.filter((x) => x.isActive), q = u.q.trim().toLowerCase();
    const counts = [["all", "All roles", live.length], ...A().ROLES.map(([k, l]) => [k, l, live.filter((x) => x.role === k).length])];
    const rows = u.list.filter((x) => (u.off || x.isActive) && (u.filter === "all" || x.role === u.filter)
      && (!q || [x.displayName, x.driverNumber, x.email, x.phone].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    const sel = rows.find((x) => x.id === u.pick) || rows[0];
    if (sel) u.pick = sel.id;
    const status = (x) => (!x.isActive ? W.pill("Deactivated") : x.mustChangePassword ? W.pill("New password needed", "warn") : '<span class="w-dash">Active</span>');
    return `
      ${W.title("Users", `${live.length} active accounts · ${u.list.length - live.length} deactivated · ${live.filter((x) => x.mustChangePassword).length} must set a new password at the next sign-in`,
        `<button class="btn btn-primary" data-action="wUserAdd">${icon("plus", 16)} Add user</button>`)}
      <div class="w-counts">${counts.map(([k, l, v]) => `<button class="w-count" type="button" data-action="wUserFilter" data-f="${k}" aria-pressed="${k === u.filter}"><span>${l}</span><b class="num">${v}</b></button>`).join("")}</div>
      <div class="w-grid top">
        ${W.panel("wUlH", counts.find((x) => x[0] === u.filter)[1], `${rows.length} shown`, `
          <div class="w-toolbar"><label class="w-searchbox">${icon("search", 16)}<input class="input" id="wUserQ" type="search" value="${esc(u.q)}" placeholder="Name, Driver Number, email or phone" aria-label="Search users" autocomplete="off"></label></div>
          ${rows.length ? `<div class="w-table"><table><thead><tr><th>Name</th><th class="w-dt">Driver Number</th><th class="w-dt">Role</th><th class="w-dt">Default truck</th><th>Status</th></tr></thead>
            <tbody>${rows.map((x) => `<tr class="w-pick" data-action="wUserPick" data-id="${esc(x.id)}" tabindex="0" aria-selected="${x === sel}">
              <td>${esc(x.displayName || x.driverNumber)}<span class="w-sub2">${esc(x.email || x.phone)}<span class="w-ph"> · ${roleName(x.role)} · ${esc(x.driverNumber)}</span></span></td>
              <td class="w-dt num">${esc(x.driverNumber)}</td><td class="w-dt">${roleName(x.role)}</td><td class="w-dt num">${x.vehicleNo ? esc(x.vehicleNo) : '<span class="w-dash">—</span>'}</td><td>${status(x)}</td></tr>`).join("")}</tbody></table></div>`
            : `<div class="w-empty">No account matches${u.q ? ` “${esc(u.q)}”` : ""}.</div>`}`,
          { span: 8, tools: `<button class="w-toggle" type="button" data-action="wUserOff" aria-pressed="${u.off}"><span class="w-sw" aria-hidden="true"></span>Show deactivated</button>` })}
        ${sel ? W.panel("wUdH", esc(sel.displayName || sel.driverNumber), "", userDetail(sel), { span: 4 }) : W.panel("wUdH", "Account", "", '<div class="w-empty">Pick an account.</div>', { span: 4 })}
      </div>`;
  }

  function userDetail(x) {
    const last = onlyAdmin(x);
    return `
      <p class="w-sub num" style="margin:-8px 0 14px">Signs in with Driver Number ${esc(x.driverNumber)} · account since ${esc((x.createdAt || "").slice(0, 10))}</p>
      <div class="w-form">
        <div class="w-field"><label for="wuName">Name</label><input class="input" id="wuName" maxlength="60" value="${esc(x.displayName)}"></div>
        <div class="w-two">
          <div class="w-field"><label for="wuRole">Role</label><select class="select" id="wuRole" ${last ? 'disabled aria-describedby="wuLast"' : ""}>${A().ROLES.map(([k, l]) => `<option value="${k}" ${k === x.role ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="w-field"><label for="wuTruck">Default truck</label><input class="input num" id="wuTruck" value="${esc(x.vehicleNo)}"></div>
        </div>
        ${last ? '<p class="w-note" id="wuLast" style="margin-top:-6px">The only Admin. Make someone else Admin before changing this role.</p>' : ""}
        <div class="w-field"><label for="wuEmail">Email</label><input class="input" id="wuEmail" type="email" value="${esc(x.email)}"></div>
        <div class="w-field"><label for="wuPhone">Phone</label><input class="input num" id="wuPhone" type="tel" value="${esc(x.phone)}"></div>
        <div class="w-actions-row"><button class="btn btn-outline" data-action="wUserSave">Save changes</button>${us().saved ? `<span class="w-note w-ok">${esc(us().saved)}</span>` : ""}</div>
      </div>
      <h3 class="w-h3" style="margin-top:20px">Password</h3>
      <div class="w-line"><span class="w-what">${x.mustChangePassword ? "A temporary password is set" : "Chosen by the user"}<small>${x.mustChangePassword ? "They choose their own at the next sign-in" : "Reset gives a temporary one, 12 characters or more"}</small></span><button class="btn btn-outline" data-action="wUserReset">Reset</button></div>
      <h3 class="w-h3">Account</h3>
      <div class="w-line"><span class="w-what">${x.isActive ? "Can sign in on the website and the app" : "Deactivated: cannot sign in"}<small>${last ? "The only Admin cannot be deactivated" : "Records, reports and routes stay either way"}</small></span>
        ${x.isActive ? `<button class="btn btn-outline w-danger" data-action="wUserDeact" ${last ? "disabled" : ""}>Deactivate</button>` : `<button class="btn btn-outline" data-action="wUserReact">Reactivate</button>`}</div>`;
  }

  const picked = () => us().list.find((x) => x.id === us().pick);
  async function update(x, patch, okTitle, detail) {
    try {
      await A().Api.update(x.id, { ...x, password: "", ...patch, expectedUpdatedAt: x.updatedAt });
    } catch (error) {
      return fail("Not saved", error);
    }
    us().list = null;
    await loadUsers();
    if (okTitle) App.showResult(true, okTitle, "Saved to Supabase.", detail || "");
  }

  function openAdd() {
    App.openSheet({
      title: "Add user",
      body: `
        <div class="field"><label class="label" for="nuName">Name *</label><input class="input" id="nuName" maxlength="60" autocomplete="off"></div>
        <div class="grid2">
          <div class="field"><label class="label" for="nuDn">Driver Number *</label><input class="input" id="nuDn" autocomplete="off" aria-describedby="nuDnHint"></div>
          <div class="field"><label class="label" for="nuRole">Role *</label><select class="select" id="nuRole">${A().ROLES.map(([k, l]) => `<option value="${k}" ${k === "driver" ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        </div>
        <p class="hint" id="nuDnHint" style="margin-top:-8px">Used to sign in. Letters, digits, dot, dash or underscore; 2 to 32 characters.</p>
        <div class="field"><label class="label" for="nuEmail">Work email *</label><input class="input" id="nuEmail" type="email" autocomplete="off"></div>
        <div class="grid2">
          <div class="field"><label class="label" for="nuTruck">Default truck</label><input class="input" id="nuTruck" autocomplete="off"></div>
          <div class="field"><label class="label" for="nuPhone">Phone</label><input class="input" id="nuPhone" type="tel" autocomplete="off"></div>
        </div>
        <div class="field"><label class="label" for="nuPw">First password *</label>
          <div class="row"><input class="input" id="nuPw" value="${newPassword()}" autocomplete="off" aria-describedby="nuPwHint"><button class="btn btn-outline" data-action="wNewPw" data-for="nuPw">New one</button></div>
          <p class="hint" id="nuPwHint">12 characters or more. They choose their own at the first sign-in.</p></div>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="wUserCreate">Add user</button>`,
    });
  }
  async function create() {
    const v = (id) => $("#" + id).value.trim();
    const dn = v("nuDn").toLowerCase();
    const taken = us().list?.find((x) => x.driverNumber === dn);
    if (taken) return App.sheetErr(`${dn} is already ${taken.displayName || "someone"}'s Driver Number.`);
    App.sheetBusy(true);
    try {
      const made = await A().Api.create({ displayName: v("nuName"), driverNumber: dn, role: v("nuRole"), email: v("nuEmail"), vehicleNo: v("nuTruck"), phone: v("nuPhone"), password: $("#nuPw").value, mustChangePassword: true, isActive: true });
      us().pick = made?.id || null;
    } catch (error) {
      App.sheetBusy(false);
      return App.sheetErr(error.message);
    }
    App.sheetBusy(false);
    App.closeSheet(false);
    Object.assign(us(), { list: null, filter: "all", q: "", saved: "" });
    await loadUsers();
    App.showResult(true, "User added", "Saved to Supabase.", `${v("nuName") || dn} signs in with Driver Number ${dn} and chooses a new password at the first sign-in.`);
  }

  function openReset() {
    const x = picked();
    App.openSheet({
      title: `Reset ${esc(x.displayName || x.driverNumber)}'s password`,
      body: `<div class="field"><label class="label" for="rpPw">Temporary password</label>
          <div class="row"><input class="input" id="rpPw" value="${newPassword()}" autocomplete="off" aria-describedby="rpHint"><button class="btn btn-outline" data-action="wNewPw" data-for="rpPw">New one</button></div>
          <p class="hint" id="rpHint">12 characters or more. Give it to ${esc((x.displayName || x.driverNumber).split(" ")[0])} in person or by phone.</p></div>
        <label class="toggle-row"><input type="checkbox" id="rpMust" checked> Must choose a new password at the next sign-in</label>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="wUserResetGo">Set password</button>`,
    });
  }

  App.onInput.wUserQ = (t) => {
    us().q = t.value;
    App.render();
    const i = $("#wUserQ");
    if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  };
  Object.assign(App.ACTIONS, {
    wUserFilter: (d) => { us().filter = d.f; App.render(); },
    wUserOff: () => { us().off = !us().off; App.render(); },
    wUserPick: (d) => { us().pick = d.id; us().saved = ""; App.render(); },
    wUserAdd: openAdd,
    wUserCreate: create,
    wNewPw: (d) => { const i = $("#" + d.for); if (i) i.value = newPassword(); },
    wUserSave: async () => {
      const x = picked(), v = (id) => $("#" + id).value.trim();
      await update(x, { displayName: v("wuName"), role: onlyAdmin(x) ? x.role : v("wuRole"), vehicleNo: v("wuTruck"), email: v("wuEmail"), phone: v("wuPhone") });
      us().saved = `Saved at ${nowHHMM()}`;
      App.render();
    },
    wUserReset: openReset,
    wUserResetGo: async () => {
      const x = picked(), pw = $("#rpPw").value;
      if (pw.length < 12) return App.sheetErr("The password needs 12 characters or more.");
      App.closeSheet(false);
      await update(x, { password: pw, mustChangePassword: $("#rpMust")?.checked !== false }, "Password reset", `${x.displayName || x.driverNumber} signs in with the temporary password.`);
    },
    wUserDeact: () => {
      const x = picked();
      App.showConfirm({
        title: `Deactivate ${x.displayName || x.driverNumber}?`, okText: "Deactivate", danger: true,
        msg: `${(x.displayName || x.driverNumber).split(" ")[0]} can no longer sign in on the website or the app. Records, reports and routes stay, and the account can be reactivated.`,
        onOk: () => update(x, { isActive: false }, "Account deactivated", "Records, reports and routes stay."),
      });
    },
    wUserReact: () => { const x = picked(); update(x, { isActive: true }, "Account reactivated", `${x.displayName || x.driverNumber} can sign in again.`); },
  });

  /* ---------------- Fill Log settings ---------------- */
  const fs = () => (App.S.wfill ||= { custs: null, profiles: null, names: {}, loading: false, error: "", filter: "notank", q: "", page: 0, pick: null, saved: "" });
  async function loadFill() {
    const f = fs();
    f.loading = true; f.error = "";
    try {
      await needAdmin();
      const [custs, prof, list] = await Promise.all([
        App.data.fetchAllCustomers(),
        window.TDG_CORE.paged(sb().from("account_fill_log_profile").select("*")),
        A().Api.list().catch(() => []),
      ]);
      if (prof.error) throw prof.error;
      f.custs = custs;
      f.profiles = Object.fromEntries((prof.data || []).map((p) => [p.account_number, p]));
      f.names = Object.fromEntries(list.map((x) => [x.id, x.displayName || x.driverNumber]));
    } catch (error) {
      f.error = navigator.onLine ? error.message : "No internet connection.";
    }
    f.loading = false;
    App.render();
  }
  const prof = (c) => fs().profiles[c.accountNumber] || null;
  const KEEP = {
    all: () => true,
    set: (c) => { const p = prof(c); return p && p.tank_size && p.fill_box_location; },
    notank: (c) => { const p = prof(c); return p && !p.tank_size; },
    nospot: (c) => { const p = prof(c); return p && !p.fill_box_location; },
    none: (c) => !prof(c),
  };

  function fillLog() {
    const f = fs();
    if (!f.custs && !f.loading && !f.error) setTimeout(loadFill);
    if (!f.custs) return W.title("Fill Log settings", f.error ? esc(f.error) : "Loading the customers and their Fill Log details…", "");
    const all = f.custs, q = f.q.trim().toLowerCase();
    const counts = [["all", "All customers"], ["set", "Complete"], ["notank", "No tank size"], ["nospot", "No fill box location"], ["none", "Not set up"]].map(([k, l]) => [k, l, all.filter(KEEP[k]).length]);
    const rows = all.filter((c) => KEEP[f.filter](c) && (!q || [c.accountName, c.accountNumber, c.accountAddress, c.city].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => a.accountName.localeCompare(b.accountName));
    const pages = Math.max(1, Math.ceil(rows.length / PER));
    f.page = Math.min(f.page, pages - 1);
    const shown = rows.slice(f.page * PER, f.page * PER + PER);
    if (!shown.some((c) => c.accountNumber === f.pick)) { const i = rows.findIndex((c) => c.accountNumber === f.pick); if (i >= 0) { f.page = Math.floor(i / PER); return fillLog(); } }
    const sel = shown.find((c) => c.accountNumber === f.pick) || shown[0];
    if (sel) f.pick = sel.accountNumber;
    const dash = '<span class="w-dash" aria-label="not set">—</span>';
    return `
      ${W.title("Fill Log settings", `${fmtN(counts[1][2])} of ${fmtN(all.length)} customers have complete Fill Log details · ${fmtN(counts[4][2])} not set up yet`, "")}
      <div class="w-counts">${counts.map(([k, l, v]) => `<button class="w-count" type="button" data-action="wFillFilter" data-f="${k}" aria-pressed="${k === f.filter}"><span>${l}</span><b class="num">${fmtN(v)}</b></button>`).join("")}</div>
      <div class="w-grid top">
        ${W.panel("wFlH", counts.find((x) => x[0] === f.filter)[1], `${fmtN(rows.length)} found`, `
          <div class="w-toolbar"><label class="w-searchbox">${icon("search", 16)}<input class="input" id="wFillQ" type="search" value="${esc(f.q)}" placeholder="Name, account number or address" aria-label="Search customers" autocomplete="off"></label></div>
          ${shown.length ? `<div class="w-table"><table><thead><tr><th>Customer</th><th>Tank size</th><th class="w-dt">Fill box location</th><th class="n w-dt">Changed</th></tr></thead>
            <tbody>${shown.map((c) => { const p = prof(c); return `<tr class="w-pick" data-action="wFillPick" data-acc="${esc(c.accountNumber)}" tabindex="0" aria-selected="${c === sel}">
              <td>${esc(c.accountName)}<span class="w-sub2 num">${esc(c.accountNumber)} · ${esc(c.city || "")}</span></td>
              <td class="num">${!p ? '<span class="w-dash">Not set up</span>' : p.tank_size ? esc(p.tank_size) : dash}</td>
              <td class="w-dt"><span class="w-trunc">${p?.fill_box_location ? esc(p.fill_box_location) : dash}</span></td>
              <td class="n num w-dt">${p ? `${esc(stamp(p.updated_at).slice(0, 10))}<span class="w-sub2">${esc(f.names[p.updated_by] || "")}</span>` : dash}</td></tr>`; }).join("")}</tbody></table></div>
            <div class="w-pager"><span class="w-meta num">${fmtN(f.page * PER + 1)}–${fmtN(f.page * PER + shown.length)} of ${fmtN(rows.length)}</span>
              <span class="w-actions-row"><button class="btn btn-outline" data-action="wFillPage" data-step="-1" ${f.page ? "" : "disabled"}>Previous</button><button class="btn btn-outline" data-action="wFillPage" data-step="1" ${f.page < pages - 1 ? "" : "disabled"}>Next</button></span></div>`
            : `<div class="w-empty">No customer matches${f.q ? ` “${esc(f.q)}”` : ""}.</div>`}`, { span: 8 })}
        ${sel ? W.panel("wFdH", esc(sel.accountName), "", fillDetail(sel), { span: 4, cls: "col" }) : W.panel("wFdH", "Customer", "", '<div class="w-empty">Pick a customer.</div>', { span: 4 })}
      </div>`;
  }

  function fillDetail(c) {
    const p = prof(c), f = fs();
    return `
      <p class="w-sub num" style="margin:-8px 0 14px">${esc(c.accountNumber)} · ${esc([c.accountAddress, c.city].filter(Boolean).join(", "))}</p>
      <div class="w-form">
        <div class="w-field"><label for="wfTank">Tank Size SF/BD</label><input class="input" id="wfTank" value="${esc(p?.tank_size || "")}"></div>
        <div class="w-field"><label for="wfPart">Gas Part Number</label><input class="input" id="wfPart" value="${esc(p ? p.gas_part_number ?? "" : "CD BEVBULK")}"></div>
        <div class="w-field"><label for="wfSpot">Fill box location</label><textarea class="textarea" id="wfSpot" rows="3">${esc(p?.fill_box_location || "")}</textarea></div>
        <div class="w-actions-row"><button class="btn btn-outline" data-action="wFillSave">Save</button>${f.saved && f.savedAcc === c.accountNumber ? `<span class="w-note w-ok">${esc(f.saved)}</span>` : ""}</div>
      </div>
      <p class="w-note" style="margin-top:12px">${p ? `Last changed${f.names[p.updated_by] ? ` by ${esc(f.names[p.updated_by])}` : ""} on ${esc(stamp(p.updated_at))}. Drivers can change these on the Fill Log too.` : "Not set up yet. The Fill Log prints these fields empty until someone fills them in."}</p>
      <div class="w-foot w-actions-row"><button class="btn btn-outline" data-action="wFillPreview">${icon("file", 16)} Preview Fill Log</button>${p ? `<button class="btn btn-outline w-danger" data-action="wFillClear">Clear details</button>` : ""}</div>`;
  }

  async function saveFill() {
    const f = fs(), c = f.custs.find((x) => x.accountNumber === f.pick), p = prof(c), v = (id) => $("#" + id).value.trim();
    const payload = { account_number: c.accountNumber, account_name: c.accountName || "", tank_size: v("wfTank"), gas_part_number: v("wfPart"), fill_box_location: v("wfSpot"), updated_by: App.S.session.userId, updated_at: new Date().toISOString() };
    try {
      // Like the Fill Log page: an update only if nobody changed it since it was read.
      const q = p ? sb().from("account_fill_log_profile").update(payload).eq("id", p.id).eq("updated_at", p.updated_at).select() : sb().from("account_fill_log_profile").insert(payload).select();
      const { data, error } = await q;
      if (error) throw error;
      if (!data?.length) { await loadFill(); return App.showResult(false, "Changed meanwhile", "Someone changed these details a moment ago.", "The latest details are shown now. Make your change again."); }
      f.profiles[c.accountNumber] = data[0];
    } catch (error) {
      return fail("Not saved", error);
    }
    // the customer stays picked even when the change moves it out of the list being shown
    Object.assign(f, { saved: `Saved at ${nowHHMM()}`, savedAcc: c.accountNumber, filter: KEEP[f.filter](c) ? f.filter : "all" });
    App.render();
  }

  App.onInput.wFillQ = (t) => {
    Object.assign(fs(), { q: t.value, page: 0 });
    App.render();
    const i = $("#wFillQ");
    if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  };
  Object.assign(App.ACTIONS, {
    wFillFilter: (d) => { Object.assign(fs(), { filter: d.f, page: 0 }); App.render(); },
    wFillPage: (d) => { fs().page += Number(d.step); App.render(); },
    wFillPick: (d) => { Object.assign(fs(), { pick: d.acc, saved: "" }); App.render(); },
    wFillSave: saveFill,
    wFillPreview: () => { const f = fs(), c = f.custs.find((x) => x.accountNumber === f.pick); if (c) App.history.previewFillLog(c); },
    wFillClear: () => {
      const f = fs(), c = f.custs.find((x) => x.accountNumber === f.pick), p = prof(c);
      App.showConfirm({
        title: `Clear the Fill Log details of ${c.accountName}?`, okText: "Clear details", danger: true,
        msg: "Tank size, gas part number and fill box location are removed. Deliveries and printed Fill Logs are not affected.",
        onOk: async () => {
          try { const { error } = await sb().from("account_fill_log_profile").delete().eq("id", p.id); if (error) throw error; } catch (error) { return fail("Not cleared", error); }
          delete f.profiles[c.accountNumber];
          f.saved = "";
          App.render();
        },
      });
    },
  });

  App.WEB_SCREENS.users = () => (App.S.role === "admin" ? users() : "");
  App.WEB_SCREENS.filllog = () => (App.S.role === "admin" ? fillLog() : "");
})();
