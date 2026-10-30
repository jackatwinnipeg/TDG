/* Website Customers (mockups/web-v1): the province's customers as a table with the picked one beside it
 * (its place on the map, Fill Log, and Edit / Delete for Supervisor, Manager and Admin), then the reload
 * plants and the drivers' recent position changes. Search, scope, forms, CSV import and plants are the
 * app's own (js/app/customers.js). */
(() => {
  "use strict";
  const App = window.TDG_APP;
  if (!App.web) return;
  const { $, esc, fmtN, icon } = App;
  const W = App.web$;
  const K = () => App.customers.kit;
  const PER = 20;
  const ws = () => (App.S.wcust ||= { page: 0, pick: null });

  function rows() {
    const c = K().cs();
    let list = c.q.trim() ? App.data.searchCustomers(K().source(), c.q) : K().source();
    if (c.noProv) list = list.filter((x) => !x.province);
    return list.slice().sort((a, b) => a.accountName.localeCompare(b.accountName) || a.accountAddress.localeCompare(b.accountAddress));
  }
  const placed = (x) => `<span class="w-dash">${x.lat != null ? "Placed" : "Not placed"}</span>`;

  function tableHtml() {
    const c = K().cs(), w = ws();
    if (c.all && !c.allList) return `<div class="w-empty">${esc(c.error || "Loading all provinces…")}</div>`;
    const list = rows();
    if (!list.length) return `<div class="w-empty">${K().source().length ? `No customer matches “${esc(c.q)}”. Check the account number, or add the customer.` : "No customers downloaded for this province yet."}</div>`;
    const pages = Math.ceil(list.length / PER);
    w.page = Math.min(w.page, pages - 1);
    const shown = list.slice(w.page * PER, w.page * PER + PER);
    const pick = shown.find((x) => x.id === w.pick) || shown[0];
    w.pick = pick.id;
    return `<div class="w-table"><table>
        <thead><tr><th class="w-dt">Account</th><th>Customer</th><th class="w-dt">Province</th><th class="w-dt">Route</th><th>Map</th></tr></thead>
        <tbody>${shown.map((x) => `<tr class="w-pick" data-action="webCust" data-id="${esc(x.id)}" tabindex="0" aria-selected="${x === pick}">
          <td class="w-dt num">${esc(x.accountNumber)}</td>
          <td>${esc(x.accountName)}<span class="w-sub2">${esc(K().where(x) || "No address")}<span class="w-ph"> · ${esc(x.accountNumber)}${x.route ? ` · ${esc(x.route)}` : ""}</span></span></td>
          <td class="w-dt">${x.province ? esc(x.province) : W.pill("No province", "warn")}</td>
          <td class="w-dt">${x.route ? esc(x.route) : W.pill("No route", "warn")}</td>
          <td>${placed(x)}</td></tr>`).join("")}</tbody></table></div>
      <div class="w-pager"><span class="w-meta num">${fmtN(w.page * PER + 1)}–${fmtN(w.page * PER + shown.length)} of ${fmtN(list.length)}</span>
        <span class="w-actions-row"><button class="btn btn-outline" data-action="webCustPage" data-step="-1" ${w.page ? "" : "disabled"}>Previous</button><button class="btn btn-outline" data-action="webCustPage" data-step="1" ${w.page < pages - 1 ? "" : "disabled"}>Next</button></span></div>`;
  }

  function detailHtml() {
    const x = K().findCust(ws().pick);
    if (!x) return W.panel("wCdH", "Customer", "", `<div class="w-empty">Pick a customer to see them.</div>`, { span: 4 });
    const edit = App.canEditCustomer();
    return W.panel("wCdH", esc(x.accountName), "", `
      <p class="w-sub num" style="margin:-8px 0 12px">${esc(x.accountNumber)} · ${esc(K().where(x) || "No address")}</p>
      <dl class="w-kv w-kv3"><div><dt>Province</dt><dd>${esc(x.province || "—")}</dd></div><div><dt>Route</dt><dd>${esc(x.route || "—")}</dd></div><div><dt>Map</dt><dd>${x.lat != null ? "Placed" : "—"}</dd></div></dl>
      ${x.lat != null ? `<div class="w-pointmap" id="wCustMap" role="img" aria-label="Where ${esc(x.accountName)} is on the map"></div>`
        : `<div class="w-notice">No map position yet. Routes look it up from the address; a driver can set it on the map.</div>`}
      <div class="w-foot w-actions-row"><button class="btn btn-outline" data-action="webFillLog" data-id="${esc(x.id)}">${icon("file", 16)} Fill Log</button>
        ${edit ? `<button class="btn btn-outline" data-action="custEdit" data-id="${esc(x.id)}">${icon("edit", 16)} Edit</button><button class="btn btn-outline w-danger" data-action="custDelete" data-id="${esc(x.id)}">${icon("trash", 16)} Delete</button>` : ""}</div>`,
      { span: 4, cls: "col" });
  }

  function customers() {
    const c = K().cs(), edit = App.canEditCustomer(), p = K().prov();
    const here = p ? K().provName(p) : "this computer";
    const noProv = edit ? K().source().filter((x) => !x.province).length : 0;
    const right = `${K().canImport() ? `<button class="btn btn-outline" data-action="custImport">${icon("upload", 16)} Import CSV</button><input type="file" id="custCsv" accept=".csv,text/csv" hidden>` : ""}
      ${App.canAddCustomer() ? `<button class="btn btn-primary" data-action="custAdd">${icon("plus", 16)} Add customer</button>` : ""}`;
    const total = (c.all ? c.allList || [] : App.data.cachedCustomers()).length;
    const sub = `${fmtN(total)} customers ${c.all ? "in all provinces" : `in ${esc(here)}`}${noProv ? ` · ${noProv} without a province` : ""}`;
    const card = (on, action, label, value) => `<button class="w-count" type="button" ${action} aria-pressed="${on}"><span>${label}</span><b class="num">${value}</b></button>`;
    const cards = edit ? `<div class="w-counts">
        ${card(!c.all && !c.noProv, 'data-action="custScope" data-all="0"', esc(here), fmtN(App.data.cachedCustomers().length))}
        ${card(c.all && !c.noProv, 'data-action="custScope" data-all="1"', "All provinces", c.allList ? fmtN(c.allList.length) : "—")}
        ${noProv || c.noProv ? card(c.noProv, 'data-action="custNoProv"', "No province", fmtN(noProv)) : ""}
      </div>` : "";
    return `
      ${W.title("Customers", sub, right)}
      ${cards}
      <div class="w-grid top">
        ${W.panel("wClH", c.noProv ? "No province" : c.all ? "All provinces" : esc(here), `${fmtN(rows().length)} found`, `
          <div class="w-toolbar"><label class="w-searchbox">${icon("search", 16)}<input class="input" id="wCustQ" type="search" value="${esc(c.q)}" placeholder="Name, account number, address or city" aria-label="Search customers" autocomplete="off"></label></div>
          <div id="wCustTable">${tableHtml()}</div>`, { span: 8 })}
        ${detailHtml()}
      </div>
      ${edit ? `<div class="w-grid top" style="margin-top:16px">
        ${W.panel("wPlH", "Reload plants", "", `<div class="w-appbox">${K().plantsHtml()}</div>`, { span: 6 })}
        ${W.panel("wPosH", "Position changes by drivers", "", `<div class="w-appbox">${K().positionsHtml() || '<p class="w-note">No position changes waiting.</p>'}</div>`, { span: 6 })}
      </div>` : ""}`;
  }

  // The picked customer's place, on the same OpenStreetMap streets as Route.
  let map = null;
  function drawMap() {
    const el = document.getElementById("wCustMap"), x = K().findCust(ws().pick), L = window.L;
    if (map && !map.getContainer().isConnected) { map.remove(); map = null; }
    if (!el || !x || x.lat == null || !L) return;
    map = L.map(el, { scrollWheelZoom: false }).setView([x.lat, x.lng], 15);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    L.circleMarker([x.lat, x.lng], { radius: 9, color: "#ffffff", weight: 2, fillColor: "#005591", fillOpacity: 1 }).addTo(map);
  }

  App.onInput.wCustQ = (t) => {
    K().cs().q = t.value;
    ws().page = 0;
    const box = $("#wCustTable");
    if (box) box.innerHTML = tableHtml();
  };
  Object.assign(App.ACTIONS, {
    webCust: (d) => { ws().pick = d.id; App.render(); },
    webCustPage: (d) => { ws().page += Number(d.step); App.render(); },
    webFillLog: (d) => { const x = K().findCust(d.id); if (x) App.history.previewFillLog(x); },
  });
  App.WEB_SCREENS.customers = customers;
  App.webDraw("customers", drawMap);
})();
