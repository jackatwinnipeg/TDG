/* Website Team (Supervisor, Admin) and Today for Manager and Viewer (mockups/web-v1; ROLES_PROPOSAL.md
 * 4.2, 4.5): everyone's day in one table and the picked person beside it.
 * - Supervisor and Admin see routes and move stops to another driver, several at once, with each driver's
 *   extra driving worked out first (same day, each stop where it adds the least, as the app's move);
 *   other edits open the person's route as in the app.
 * - Manager and Viewer see each day read only, with no routes (decisions 15, 16); the picked driver is
 *   also the one History shows. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  if (!App.web) return;
  const { esc, fmtN, icon, localDate, normVeh, nowHHMM, weekday } = App;
  const W = App.web$;
  const RT = () => App.route;
  const R = () => RT().R();
  const V = () => window.TDG_VOLUME;
  const me = () => App.S.session.userId;
  const edits = () => RT().canEditOthers();
  const wt = () => (App.S.wteam ||= { days: null, loading: false, error: "", pick: null, ticked: new Set(), at: "" });

  // Everyone's today from the server: shifts, records and the open truck's balance (App.viewing.loadDay).
  async function load() {
    const t = wt();
    if (t.loading) return;
    t.loading = true; t.error = "";
    App.render();
    try {
      const people = await App.viewing.people();
      if (edits()) await App.routeTeam.load();
      const days = await Promise.all(list(people).map((p) => App.viewing.loadDay(p.id).catch((e) => ({ ownerId: p.id, error: e.message }))));
      t.days = Object.fromEntries(days.map((d) => [d.ownerId, d]));
      t.at = nowHHMM();
    } catch (error) {
      t.error = navigator.onLine ? error.message : "No internet connection.";
    }
    t.loading = false;
    App.render();
  }
  const list = (people) => {
    const self = App.canRecord() ? [{ id: me(), display_name: App.S.session.displayName || App.S.session.username, role: App.S.role, driver_number: App.S.session.driverNumber }] : [];
    return self.concat((people || []).filter((p) => p.id !== me()));
  };
  const planOf = (id) => (id === me() ? R().plan : R().team?.[id] || null);
  const ownerKey = (id) => (id === me() ? "me" : id);

  function rows() {
    const t = wt(), day = localDate();
    return list(App.S.people).map((p) => {
      const d = t.days?.[p.id] || null;
      const shifts = d?.shifts || [];
      const status = !d || d.error ? "unknown" : !shifts.length ? "off" : shifts.some((r) => !r.check_out_time) ? "on" : "out";
      const recs = d?.records || [];
      const dels = recs.filter((r) => !V().isNonDeliveryEvent(r));
      const plan = planOf(p.id), stops = plan ? RT().dayStops(plan, day) : [];
      const own = p.id === me() ? App.day.balance() : null;
      return {
        p, d, status, recs, dels, plan, stops, you: p.id === me(),
        name: p.display_name || p.driver_number, role: App.ROLE_LABEL[p.role] || "Driver",
        truck: d?.vehicle || "", since: shifts.map((r) => r.check_in_time).filter(Boolean).sort()[0] || "",
        until: status === "out" ? shifts.map((r) => r.check_out_time).sort().at(-1) : "",
        lbs: dels.reduce((a, r) => a + (Number(r.deliveredVolume) || 0), 0), emg: dels.filter((r) => r.emergency).length,
        left: own ? own.remainingKg : d?.balance ? d.balance.remainingKg : null,
        done: stops.filter((s) => s.status === "done").length, next: stops.find((s) => s.status === "pending") || null,
        note: R().wNotes?.[p.id] || "",
      };
    });
  }
  const pill = (x) => ({ on: W.pill("On shift", "pos"), out: W.pill(`Checked out ${x.until}`), off: W.pill("Not checked in"), unknown: '<span class="w-dash">—</span>' })[x.status];
  const toGo = (x) => x.stops.length - x.done;

  function screen() {
    const t = wt();
    if (!t.days && !t.loading && !t.error) setTimeout(load);
    const all = rows(), sup = edits();
    const pick = all.find((x) => x.p.id === (sup ? t.pick : App.S.viewDriver || t.pick)) || (sup ? all.find((x) => x.status === "off" && toGo(x)) : null) || all[0];
    if (pick && !sup && App.S.viewDriver !== pick.p.id) App.S.viewDriver = pick.p.id;
    const count = (st) => all.filter((x) => x.status === st).length;
    const stranded = sup ? all.find((x) => x.status === "off" && toGo(x) && !x.you) : null;
    const em = all.flatMap((x) => x.dels.filter((r) => r.emergency).map((r) => `${x.name.split(" ")[0]} ${r.arrivalTime}`));
    const sub = !t.days ? (t.error ? esc(t.error) : "Loading everyone's day…")
      : sup ? `${weekday(localDate())} ${localDate()} · ${count("on")} on shift · ${stranded ? `${esc(stranded.name)} has not checked in and has ${toGo(stranded)} stops to go` : "every stop today has a driver on shift"}`
      : `${weekday(localDate())} ${localDate()} · ${count("on")} on shift · ${count("out")} checked out · ${count("off")} not checked in${em.length ? ` · ${em.length} emergency ${em.length === 1 ? "delivery" : "deliveries"} (${esc(em.join(", "))})` : ""}`;
    const withDel = all.filter((x) => x.dels.length);
    const right = `<button class="btn btn-outline" data-action="webTeamLoad" ${t.loading ? "disabled" : ""}>${icon("update", 16)} ${t.loading ? "Updating…" : `Updated ${t.at || "—"}`}</button>
      ${sup ? (stranded ? `<button class="btn btn-primary" data-action="webTeamMove" data-owner="${esc(stranded.p.id)}" data-all="1">${icon("swap", 16)} Move ${esc(stranded.name)}'s ${toGo(stranded)} stops</button>` : "")
        : `<button class="btn btn-primary" data-action="webTeamPrint" ${withDel.length ? "" : "disabled"}>${icon("print", 16)} Print today's TDG reports</button>`}`;
    const head = sup
      ? '<th>Driver</th><th>Status</th><th class="n">Stops</th><th class="w-dt">Next stop</th><th class="n w-dt">TDG left</th>'
      : '<th>Driver</th><th>Status</th><th class="n">Deliveries</th><th class="n w-dt">Delivered</th><th class="n w-dt">TDG left</th>';
    const row = (x) => `<tr class="w-pick" data-action="webTeamPick" data-id="${esc(x.p.id)}" tabindex="0" aria-selected="${x === pick}">
        <td>${esc(x.name)}${x.you ? " (you)" : ""}<span class="w-sub2 num">${x.note ? esc(x.note) : [x.role, x.truck ? `truck ${esc(x.truck)}` : "", x.since ? `since ${esc(x.since)}` : ""].filter(Boolean).join(" · ")}</span></td>
        <td>${pill(x)}</td>
        ${sup ? `<td class="n num">${x.stops.length ? `${x.done} of ${x.stops.length}<span class="w-bar" aria-hidden="true"><i style="width:${Math.round((x.done / x.stops.length) * 100)}%"></i></span>` : '<span class="w-dash">No route today</span>'}<span class="w-ph w-sub2">${x.left != null ? `${fmtN(x.left)} kg left` : ""}</span></td>
          <td class="w-dt">${x.next ? esc(x.next.name) : x.stops.length ? "All delivered" : '<span class="w-dash">—</span>'}</td>`
        : `<td class="n num">${x.dels.length}${x.emg ? `<span class="w-sub2">${x.emg} emergency</span>` : ""}<span class="w-ph w-sub2">${x.left != null ? `${fmtN(x.left)} kg left` : ""}</span></td><td class="n num w-dt">${fmtN(x.lbs)} lbs</td>`}
        <td class="n num w-dt">${x.left != null ? `${fmtN(x.left)} kg` : '<span class="w-dash">—</span>'}</td></tr>`;
    const table = !t.days ? `<div class="w-empty">${t.error ? esc(t.error) : "Loading…"}</div>`
      : `<div class="w-table"><table><thead><tr>${head}</tr></thead><tbody>${all.map(row).join("")}</tbody></table></div>`;
    return `
      ${W.title(sup ? "Team" : "Today", sub, right)}
      ${W.panel("wTeamH", sup ? "Routes today" : "Drivers today", `${all.length} people`, table)}
      ${pick && t.days ? (sup ? routeOf(pick) : dayOf(pick)) : ""}`;
  }

  // Supervisor / Admin: the picked person's stops today and the map; tick stops to move them.
  function routeOf(x) {
    const t = wt(), day = localDate();
    if (!x.plan || !x.stops.length) {
      return `<div class="w-detail"><h2>${esc(x.name)}${x.you ? " (you)" : ""} · ${weekday(day)} ${day}</h2></div>
        <div class="w-empty">${x.plan ? "No stops today." : "No route this week."}</div>`;
    }
    const L = RT().legs(x.plan, day), pend = x.stops.filter((s) => s.status === "pending");
    const ticked = pend.filter((s) => t.ticked.has(s.id)).length;
    const all = pend.length && ticked === pend.length;
    const owner = ownerKey(x.p.id);
    return `
      <div class="w-detail"><div><h2>${esc(x.name)}${x.you ? " (you)" : ""} · ${weekday(day)} ${day}</h2><p class="w-sub num">${x.truck ? `Truck ${esc(x.truck)} · ` : ""}${x.done} of ${x.stops.length} delivered · ${RT().fmtKm(L.m)} km · ${RT().fmtDur(L.s)} driving</p></div>
        <div class="w-actions"><button class="btn btn-outline" data-action="emergency" data-owner="${esc(owner)}">${icon("siren", 16)} Emergency call</button><button class="btn btn-outline" data-action="replan" data-owner="${esc(owner)}">${icon("update", 16)} Re-plan</button>${x.you ? "" : `<button class="btn btn-outline" data-action="openTeam" data-id="${esc(x.p.id)}">Change order or day</button>`}</div></div>
      <div class="w-grid">
        ${W.panel("wTsH", "Stops", `${pend.length} to go`, `
          ${pend.length ? `<div class="w-toolbar"><button class="w-check" data-action="webTeamTickAll" data-owner="${esc(x.p.id)}" aria-pressed="${all}" aria-label="Tick every stop to go">${icon("check", 14)}</button>
            <button class="btn btn-outline" data-action="webTeamMove" data-owner="${esc(x.p.id)}" ${ticked ? "" : "disabled"}>${icon("swap", 16)} Move ${ticked || ""} to another driver</button></div>` : ""}
          ${L.rows.map(({ stop: s, m, s: secs }, i) => `<div class="w-line">
            ${s.status === "pending" ? `<button class="w-check" data-action="webTeamTick" data-id="${esc(s.id)}" aria-pressed="${t.ticked.has(s.id)}" aria-label="Tick ${esc(s.name)}">${icon("check", 14)}</button>` : '<span class="w-check w-gap"></span>'}
            <span class="w-n ${s.status === "done" ? "done" : ""}">${i + 1}</span>
            <span class="w-what">${esc(s.name)}<small>${esc(s.addr || "")}${s.acc ? ` · ${esc(s.acc)}` : ""}</small></span>
            <span class="w-leg num">${RT().fmtKm(m)} km<small>${Math.max(1, Math.round(secs / 60))} min</small></span>
            <span class="w-when num">${s.status === "done" ? esc(s.doneAt || "Done") : s === x.next && x.status === "on" ? "<b>Next</b>" : '<span class="w-dash">—</span>'}</span></div>`).join("")}`, { span: 5 })}
        ${W.panel("wTmH", "Map", esc(x.name), `<div class="w-mapbox w-bigmap">${RT().routeMap(x.plan, [day], owner)}</div>`, { span: 7 })}
      </div>`;
  }

  // Manager / Viewer: the picked driver's day, read only.
  function dayOf(x) {
    const d = x.d, day = localDate();
    if (!d || d.error) return `<div class="w-empty">${esc(d?.error || "Not loaded.")}</div>`;
    const b = d.balance;
    const head = `<div class="w-detail"><div><h2>${esc(x.name)} · ${weekday(day)} ${day}</h2><p class="w-sub num">${[x.role, x.truck ? `truck ${esc(x.truck)}` : "", x.since ? `check-in ${esc(x.since)}` : "", x.until ? `check-out ${esc(x.until)}` : ""].filter(Boolean).join(" · ")}</p></div>
      <div class="w-actions">${x.recs.length ? `<button class="btn btn-outline" data-action="openDay" data-date="${day}" data-from="today">${icon("file", 16)} TDG report</button>` : ""}<button class="btn btn-outline" data-action="fillLogSearch">${icon("file", 16)} Fill Log</button></div></div>`;
    if (x.status === "off" && !x.recs.length) return `${head}<div class="w-empty">${esc(x.name)} has not checked in today.</div>`;
    let ledger = "";
    if (b) {
      const open = Math.round(b.baseKg), rel = Math.round(b.totalReloadKg), adj = Math.round(b.totalAdjustmentKg), del = open + rel - adj - b.remainingKg;
      ledger = `<b>${fmtN(open)}</b> kg opening${rel ? ` + <b>${fmtN(rel)}</b> kg reload` : ""} − <b>${fmtN(del)}</b> kg delivered (${fmtN(b.totalDeliveredLbs)} lbs)${adj ? ` − <b>${fmtN(adj)}</b> kg adjustment` : ""} = <b>${fmtN(b.remainingKg)}</b> kg`;
    }
    const recs = x.recs.slice().sort((a, c) => String(a.arrivalTime).localeCompare(String(c.arrivalTime)));
    return `${head}
      <div class="w-grid">
        ${W.panel("wTbH", "TDG balance", x.truck ? `Truck ${esc(x.truck)}` : "", b
          ? `<div class="w-answer num">${fmtN(b.remainingKg)}<small>kg</small></div><p class="w-ledger num">${ledger}</p><div class="w-chart" id="wTeamChart"></div>`
          : `<div class="w-answer num">—<small>kg</small></div><p class="w-note">No TDG balance for today.</p>`, { span: 7 })}
        ${W.panel("wTdH", "Deliveries", `${x.dels.length} · ${fmtN(x.lbs)} lbs`, recs.length ? recs.map((r) => {
          const k = App.webKindOf(r);
          return `<div class="w-line"><span class="num w-time">${esc(r.arrivalTime)}</span><span class="w-what">${r.emergency ? `${W.pill("Emergency", "warn")} ` : ""}${k === "reload" ? `Reload${r.accountName ? ` at ${esc(r.accountName)}` : ""}` : k === "adjust" ? "TDG adjustment" : esc(r.accountName)}<small>${esc([r.accountAddress, r.accountNumber].filter(Boolean).join(" · "))}</small></span><span class="num">${k === "reload" ? `+${fmtN(V().getReloadAmountKg(r))} kg` : k === "adjust" ? `${fmtN(V().getAdjustmentAmountLbs(r))} lbs` : `${fmtN(r.deliveredVolume)} lbs`}</span></div>`;
        }).join("") : '<p class="w-note">No deliveries yet.</p>', { span: 5 })}
      </div>`;
  }

  function draw() {
    if (App.canRecord() && App.S.screen === "today") return;
    const el = document.getElementById("wTeamChart");
    const x = el && rows().find((r) => r.p.id === App.S.viewDriver);
    if (!x?.d?.balance) return;
    App.webBalanceChart(el, { base: x.d.balance.baseKg, records: x.recs.filter((r) => normVeh(r.vehicleNo) === normVeh(x.truck)), open: x.status === "on", start: (([h, m]) => h * 60 + m)((x.since || "0:0").split(":").map(Number)) });
  }

  /* ---------------- moving ticked stops to another driver ---------------- */
  const clonePlan = (p) => ({ ...p, dates: [...p.dates], stops: p.stops.map((s) => ({ ...s })) });
  async function openMove(d) {
    const t = wt(), day = localDate(), src = planOf(d.owner);
    if (!src) return;
    const pend = RT().dayStops(src, day).filter((s) => s.status === "pending");
    const moved = d.all ? pend : pend.filter((s) => t.ticked.has(s.id));
    if (!moved.length) return;
    const srcName = rows().find((x) => x.p.id === d.owner)?.name || "this driver";
    const cands = rows().filter((x) => x.p.id !== d.owner);
    const title = `Move ${moved.length} stop${moved.length === 1 ? "" : "s"} from ${esc(srcName)}`;
    App.openSheet({ title, body: `<div class="w-empty">Working out each driver's extra driving…</div>`, footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button>`, data: { owner: d.owner, ids: moved.map((s) => s.id) } });
    try {
      const withPlan = cands.filter((x) => x.plan);
      await RT().ensureCosts([...moved, ...withPlan.flatMap((x) => [x.plan.start, x.plan.end, ...RT().dayStops(x.plan, day)])].filter((p) => p && p.lat != null));
      const opts = withPlan.map((x) => {
        const before = RT().legs(x.plan, day), c = clonePlan(x.plan);
        RT().ensureDate(c, day);
        for (const s of moved) { const copy = { ...s, next: false }; c.stops.push(copy); RT().insertCheapest(c, copy); }
        const after = RT().legs(c, day);
        return { x, km: (after.m - before.m) / 1000, min: Math.round((after.s - before.s) / 60), toGo: toGo(x) + moved.length };
      }).sort((a, b) => a.km - b.km);
      if (!App.S.sheet) return;
      const pickTo = opts.find((o) => o.x.status === "on")?.x.p.id || opts[0]?.x.p.id || null;
      App.S.sheet.data.to = pickTo;
      App.openSheet({
        title,
        body: `<p class="w-note" style="margin:0 0 12px">Same day. Each stop goes where it adds the least driving; delivered stops keep their order. Both drivers see “Route updated by ${esc(App.S.session.displayName || App.S.session.username)}”.</p>
          <div class="w-opts" role="radiogroup" aria-label="Move to">${opts.map((o, i) => `<button class="w-opt" role="radio" data-action="webTeamTo" data-to="${esc(o.x.p.id)}" aria-checked="${o.x.p.id === pickTo}">
            <span class="w-what">${esc(o.x.name)}${o.x.you ? " (you)" : ""}<small>${[o.x.status === "on" ? "On shift" : o.x.status === "out" ? "Checked out" : "Not checked in", o.x.left != null ? `${fmtN(o.x.left)} kg TDG left` : "", i === 0 ? "least extra driving" : ""].filter(Boolean).join(" · ")}</small></span>
            <span class="w-leg num">${toGo(o.x)} → ${o.toGo}<small>stops to go</small></span>
            <span class="w-leg num">${o.km < 0 ? "−" : "+"}${Math.abs(o.km).toFixed(1)} km<small>${o.min < 0 ? "−" : "+"}${Math.abs(o.min)} min</small></span></button>`).join("")}</div>
          ${cands.filter((x) => !x.plan).length ? `<p class="w-note">${cands.filter((x) => !x.plan).map((x) => esc(x.name)).join(", ")}: no route this week. To give them a stop, open the stop in Route (it asks for a start point).</p>` : ""}`,
        footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="webTeamDoMove" ${pickTo ? "" : "disabled"}>Move ${moved.length} stop${moved.length === 1 ? "" : "s"}</button>`,
        data: { owner: d.owner, ids: moved.map((s) => s.id), to: pickTo },
      });
    } catch (error) {
      App.sheetErr(RT().reason(error));
    }
  }
  async function doMove() {
    const { owner, ids, to } = App.S.sheet?.data || {};
    if (!to) return;
    const day = localDate(), from = planOf(owner), target = planOf(to);
    const moved = from.stops.filter((s) => ids.includes(s.id));
    const names = Object.fromEntries(rows().map((x) => [x.p.id, x.name]));
    App.sheetBusy(true);
    from.stops = from.stops.filter((s) => !ids.includes(s.id));
    RT().renumber(from, day);
    RT().ensureDate(target, day);
    for (const s of moved) { s.next = false; target.stops.push(s); }
    try { await RT().ensureCosts([target.start, target.end, ...RT().dayStops(target, day)]); } catch {}
    for (const s of moved) RT().insertCheapest(target, s);
    App.sheetBusy(false);
    App.closeSheet(false);
    const n = `${moved.length} stop${moved.length === 1 ? "" : "s"}`;
    (R().wNotes ||= {})[to] = `+${n} from ${names[owner]} · ${nowHHMM()}`;
    R().wNotes[owner] = `${n} moved to ${names[to]} · ${nowHHMM()}`;
    wt().ticked.clear();
    wt().pick = to;
    await App.routeTeam.saveOther([from, target], "Stops moved", `${n} moved from ${names[owner]} to ${names[to]} for today.`, `${n} moved from ${names[owner]} to ${names[to]}`);
  }

  Object.assign(App.ACTIONS, {
    webTeamLoad: () => { wt().days = null; load(); },
    webTeamPick: (d) => {
      const t = wt();
      if (edits()) { t.pick = d.id; t.ticked.clear(); } else { App.S.viewDriver = d.id; App.device.set(`viewDriver:${App.S.session.userId}`, d.id); if (App.S.hist) { App.S.hist.data = null; App.S.hist.selected.clear(); } }
      App.render();
    },
    webTeamTick: (d) => { const t = wt(); if (t.ticked.has(d.id)) t.ticked.delete(d.id); else t.ticked.add(d.id); App.render(); },
    webTeamTickAll: (d) => {
      const t = wt(), pend = RT().dayStops(planOf(d.owner), localDate()).filter((s) => s.status === "pending");
      const all = pend.every((s) => t.ticked.has(s.id));
      pend.forEach((s) => (all ? t.ticked.delete(s.id) : t.ticked.add(s.id)));
      App.render();
    },
    webTeamMove: (d) => openMove({ owner: d.owner, all: d.all === "1" }),
    webTeamTo: (d) => {
      App.S.sheet.data.to = d.to;
      document.querySelectorAll('#sheet [data-action="webTeamTo"]').forEach((b) => b.setAttribute("aria-checked", String(b.dataset.to === d.to)));
    },
    webTeamDoMove: doMove,
    webTeamPrint: () => {
      const day = localDate(), ids = rows().filter((x) => x.recs.length).map((x) => x.p.id);
      App.history.previewTdg(ids.map((ownerId) => ({ date: day, ownerId })), `TDG Reports · ${day} · ${ids.length} ${ids.length === 1 ? "driver" : "drivers"}`);
    },
  });

  // Team replaces Route's Team view; Manager and Viewer get it as their Today.
  const route = App.WEB_SCREENS.route, today = App.WEB_SCREENS.today;
  App.WEB_SCREENS.route = () => (R().tab === "team" ? screen() : route());
  App.WEB_SCREENS.today = () => (App.canRecord() ? today() : screen());
  App.webDraw("route", draw);
  App.webDraw("today", draw);
})();
