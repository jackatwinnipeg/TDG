/* Website History (mockups/web-v1): the work days as a table to tick and print together, and the picked
 * day beside it. The loading, filters, selection and reports are the app's (js/app/history.js); a day's
 * own page and the report previews open as in the app. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  if (!App.web) return;
  const { esc, fmtN, icon, weekday } = App;
  const W = App.web$;
  const H = () => App.history;
  const plural = (n, one, many) => `${fmtN(n)} ${n === 1 ? one : many}`;

  function history() {
    const h = H().hist();
    if (!h.data && !h.loading && !h.error) setTimeout(H().reload);
    const days = H().filteredDays();
    const sel = days.find((d) => d.date === h.wPick) || days[0];
    const nDel = days.reduce((a, d) => a + d.deliveries.length, 0), lbs = days.reduce((a, d) => a + d.lbs, 0);
    const nf = H().activeFilterCount();
    const who = App.canRecord() ? "" : App.viewing.viewedName();
    const sub = h.loading ? "Loading…" : `${who ? `${esc(who)} · ` : ""}${plural(days.length, "work day", "work days")} · ${plural(nDel, "delivery", "deliveries")} · ${fmtN(lbs)} lbs · ${h.from} to ${h.to}`;
    const right = `
      ${App.canRecord() ? "" : `<span class="w-picker">${App.viewing.driverSelect()}</span>`}
      <label class="w-date-in"><span class="w-vh">From</span><input class="input num" type="date" id="date-from" value="${h.from}" aria-label="From"></label>
      <label class="w-date-in"><span class="w-vh">To</span><input class="input num" type="date" id="date-to" value="${h.to}" aria-label="To"></label>
      <button class="btn btn-outline" data-action="filters">${icon("filter", 16)} Filters${nf ? ` (${nf})` : ""}</button>
      <button class="btn btn-primary" data-action="printSelected" ${h.selected.size ? "" : "disabled"}>${icon("print", 16)} Print ${h.selected.size || ""} TDG report${h.selected.size === 1 ? "" : "s"}</button>`;
    const all = days.length && days.every((d) => h.selected.has(d.date));
    const table = h.error ? `<div class="w-empty">${esc(h.error)}</div>`
      : h.loading && !h.data ? `<div class="w-empty">Loading…</div>`
      : !days.length ? `<div class="w-empty">No work days ${nf ? "match these filters" : "in these dates"}.</div>`
      : `<div class="w-table"><table>
          <thead><tr><th class="w-ck"><button class="w-check" data-action="webPickAllDays" aria-pressed="${all}" aria-label="Select all days">${icon("check", 14)}</button></th><th>Day</th><th class="w-dt">Truck</th><th class="w-dt">Shift</th><th class="n">Deliveries</th><th class="n">Delivered</th></tr></thead>
          <tbody>${days.map((d) => `
            <tr class="w-pick" data-action="webDay" data-date="${d.date}" tabindex="0" aria-selected="${d === sel}">
              <td class="w-ck"><button class="w-check" data-action="toggleDay" data-date="${d.date}" aria-pressed="${h.selected.has(d.date)}" aria-label="Select ${weekday(d.date)} ${d.date}">${icon("check", 14)}</button></td>
              <td class="num">${weekday(d.date)} ${d.date}${d.deliveries.some((r) => r.emergency) ? ` ${W.pill(`${d.deliveries.filter((r) => r.emergency).length} emergency`, "warn")}` : ""}<span class="w-ph w-sub2">${esc(d.vehicles.join(" / "))}${d.shift.start ? ` · ${esc(d.shift.start)}–${esc(d.shift.end || "…")}` : ""}</span></td>
              <td class="w-dt num">${esc(d.vehicles.join(" / "))}</td>
              <td class="w-dt num" style="white-space:nowrap">${d.shift.start ? `${esc(d.shift.start)}–${esc(d.shift.end || "…")}` : '<span class="w-dash">—</span>'}</td>
              <td class="n num">${d.deliveries.length}</td><td class="n num">${fmtN(d.lbs)} lbs</td></tr>`).join("")}
          </tbody></table></div>`;
    return `
      ${W.title("History", sub, right)}
      <div class="w-grid top">
        ${W.panel("wDaysH", "Work days", "Newest first · tick days to print together", table, { span: 7 })}
        ${sel ? dayPanel(sel) : W.panel("wDayH", "Day", "", `<div class="w-empty">Pick a day to see it.</div>`, { span: 5 })}
      </div>`;
  }

  function dayPanel(d) {
    const recs = d.records.slice().sort((a, b) => String(a.arrivalTime).localeCompare(String(b.arrivalTime)));
    const V = window.TDG_VOLUME;
    const kpi = (k, v, u = "") => `<div><dt>${k}</dt><dd class="num">${v}${u ? `<small> ${u}</small>` : ""}</dd></div>`;
    return W.panel("wDayH", `${weekday(d.date)} ${d.date}`, `${esc(d.vehicles.join(" / "))}${d.shift.start ? ` · ${esc(d.shift.start)}–${esc(d.shift.end || "…")}` : ""}`, `
      <dl class="w-kv w-kv3">${kpi("Deliveries", d.deliveries.length)}${kpi("Delivered", fmtN(d.lbs), "lbs")}${kpi("Week cycle", d.cycle || "—")}</dl>
      ${recs.map((r) => {
        const reload = V.getReloadAmountKg(r), adj = V.getAdjustmentAmountLbs(r);
        return `<div class="w-line"><span class="num w-time">${esc(r.arrivalTime)}</span><span class="w-what">${r.emergency ? `${W.pill("Emergency", "warn")} ` : ""}${reload ? `Reload${r.accountName ? ` at ${esc(r.accountName)}` : ""}` : adj ? "TDG adjustment" : esc(r.accountName)}<small>${esc([r.accountAddress, r.accountNumber].filter(Boolean).join(" · "))}</small></span><span class="num">${reload ? `+${fmtN(reload)} kg` : adj ? `${fmtN(adj)} lbs` : `${fmtN(r.deliveredVolume)} lbs`}</span></div>`;
      }).join("")}
      <div class="w-foot w-actions-row"><button class="btn btn-outline" data-action="openDay" data-date="${d.date}" data-from="history">${icon("file", 16)} TDG report</button>
        <button class="btn btn-outline" data-action="fillLogSearch">${icon("file", 16)} Fill Log</button>
        <button class="btn btn-outline" data-action="openReloadLog">${icon("file", 16)} Reload Log</button></div>`, { span: 5, cls: "col" });
  }

  Object.assign(App.ACTIONS, {
    webDay: (d) => { H().hist().wPick = d.date; App.render(); },
    webPickAllDays: () => {
      const h = H().hist(), days = H().filteredDays();
      const all = days.length && days.every((d) => h.selected.has(d.date));
      days.forEach((d) => (all ? h.selected.delete(d.date) : h.selected.add(d.date)));
      App.render();
    },
  });
  // A tick in a row toggles that day only, not the row's own action.
  const toggle = App.ACTIONS.toggleDay;
  App.ACTIONS.toggleDay = (d, el, e) => { e?.stopPropagation(); toggle(d, el, e); };
  App.WEB_SCREENS.history = history;
})();
