/* Route → Team (ROUTE_PROPOSAL.md 3.10, ROLES_PROPOSAL.md decisions 4, 10, 11): every driver's
 * route and progress today. Drivers look; Supervisors and Admins also change another driver's
 * route (order, day, remove, Re-plan, Emergency Call, move a stop to another driver). The driver
 * then sees "Route updated by <name>". Changes to someone else's route need a connection. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { $, esc, icon, localDate, initials } = App;
  const RT = () => App.route;
  const R = () => RT().R();
  const S = () => App.S;
  const sb = () => window.supabaseClient;
  const me = () => S().session.userId;

  // This week's plans of everyone, with their stops.
  async function load() {
    const r = R();
    r.teamError = "";
    try {
      const people = await App.viewing.people();
      const mon = RT().mondayOf(localDate());
      const { data: plans } = await App.data.call(sb().from("tdg_route_plans").select("*").eq("week_start", mon));
      const ids = (plans || []).map((p) => p.id);
      const stops = ids.length ? (await App.data.call(sb().from("tdg_route_stops").select("*").in("plan_id", ids))).data || [] : [];
      r.team = Object.fromEntries((plans || []).filter((p) => p.owner_id !== me()).map((p) => [p.owner_id, RT().fromRows(p, stops)]));
      r.teamPeople = people;
    } catch (error) {
      r.teamError = RT().reason(error);
    }
    r.teamLoaded = true;
    App.render();
  }
  const nameOf = (id) => (id === me() ? S().session.displayName : (R().teamPeople || App.S.people || []).find((p) => p.id === id)?.display_name || "this driver");
  const roleOf = (id) => App.ROLE_LABEL[(R().teamPeople || []).find((p) => p.id === id)?.role] || "Driver";

  function renderTeam() {
    const r = R();
    if (!r.teamLoaded) { if (!r.teamLoading) { r.teamLoading = true; load().finally(() => { r.teamLoading = false; }); } return `<div class="empty">Loading…</div>`; }
    if (r.teamError) return `<div class="empty">${esc(r.teamError)}</div>`;
    const day = localDate();
    const rows = [{ id: me(), name: `${S().session.displayName || S().session.username} (you)`, role: App.ROLE_LABEL[S().role], plan: R().plan }]
      .concat((r.teamPeople || []).filter((p) => p.id !== me()).map((p) => ({ id: p.id, name: p.display_name || p.driver_number, role: App.ROLE_LABEL[p.role] || "Driver", plan: r.team[p.id] })));
    return `<p class="muted small" style="margin:-4px 2px 12px">${RT().dayLabel(day)} · ${RT().canEditOthers() ? "You can change other drivers' routes." : "You can see every route and change only your own."}</p>
      <div class="list">${rows.map((x) => {
        const list = x.plan ? RT().dayStops(x.plan, day) : [];
        const done = list.filter((s) => s.status === "done").length;
        const nx = list.find((s) => s.status === "pending");
        const sub = list.length ? (nx ? `Next: ${nx.name}` : "All stops delivered") : x.plan && RT().activeStops(x.plan).length ? "No stops today" : "No route this week";
        return `<button class="rowbtn" data-action="openTeam" data-id="${esc(x.id)}">
          <div class="avatar sm">${esc(initials(x.name))}</div>
          <div class="grow"><div class="row"><span class="rec-name ellipsis">${esc(x.name)}</span><span class="chip">${esc(x.role)}</span></div>
            <div class="rec-sub ellipsis">${esc(sub)}</div>
            ${list.length ? `<div class="progress" role="img" aria-label="${done} of ${list.length} delivered"><span style="width:${Math.round((done / list.length) * 100)}%"></span></div>` : ""}</div>
          <div class="rec-amt">${list.length ? `${done}/${list.length}` : "—"}<div class="u">done</div></div>
        </button>`;
      }).join("")}</div>`;
  }

  function renderTeamDriver() {
    const r = R(), id = r.teamId, p = r.team[id];
    const top = `<button class="back" data-action="teamBack">${icon("back", 20)} Team</button>
      <div class="page-h"><h1 style="font-size:22px">${esc(nameOf(id))}</h1><span class="chip">${esc(roleOf(id))}</span></div>`;
    if (!p || !RT().activeStops(p).length) return `${top}<div class="empty">No route this week.</div>`;
    const day = localDate();
    if (!r.teamDay || !p.dates.includes(r.teamDay)) r.teamDay = p.dates.includes(day) ? day : p.dates.find((d) => d >= day) || p.dates[0];
    const d = r.teamDay, can = RT().canEditOthers(), editing = r.editOrder === id, first = nameOf(id).split(" ")[0];
    return `${top}
      <div class="note-box">${can ? `You can change ${esc(first)}'s route. ${esc(first)} then sees “Route updated by ${esc(S().session.displayName || S().session.username)}”.` : "View only. The driver, supervisors and admins can change this route."}</div>
      ${RT().dayChips(p, d, id)}${RT().routeSum(p, d)}
      ${r.mode === "map" ? RT().routeMap(p, [d], id) : RT().stopList(p, d, id)}
      ${can ? `<div class="grid2" style="margin-top:14px">
        <button class="btn btn-outline" data-action="emergency" data-owner="${esc(id)}">${icon("siren", 18)} Emergency</button>
        <button class="btn btn-outline" data-action="replan" data-owner="${esc(id)}">${icon("update", 18)} Re-plan</button>
        ${RT().pendingOn(p, d).length > 1 ? `<button class="btn ${editing ? "btn-primary" : "btn-outline"}" data-action="editOrder" data-owner="${esc(id)}">${editing ? "Save order" : "Change order"}</button>` : ""}
      </div>` : ""}`;
  }

  // Someone else's route (and, moving a stop, two routes) saved at once; refused when it changed meanwhile.
  async function saveOther(plans, title, detail, noticeItem) {
    if (navigator.onLine === false) {
      await load();
      return App.showResult(false, "Change not saved", "No internet connection.", "Nothing was changed. Try again when the connection is back.");
    }
    try {
      const saves = plans.map((p) => ({ plan: RT().planRow(p), stops: p.stops.map(RT().stopRow), base_version: p.version || null, notice: p.ownerId === me() ? null : { items: [noticeItem || title] } }));
      const { data } = await App.data.call(sb().rpc("tdg_route_save", { p_saves: saves }));
      for (const v of data || []) for (const p of plans) if (p.id === v.id) p.version = v.version;
      if (plans.some((p) => p.ownerId === me())) { R().plan = plans.find((p) => p.ownerId === me()); RT().persist(); }
    } catch (error) {
      await load();
      if (error.code === "P0409") return App.showResult(false, "Route was just changed", error.message, "The latest version is shown now. Your change was not saved. Please make it again.");
      return App.showResult(false, "Change not saved", RT().reason(error), "Nothing was changed.");
    }
    App.render();
    const others = [...new Set(plans.map((p) => p.ownerId).filter((o) => o !== me()))].map(nameOf);
    App.showResult(true, title, "Saved to Supabase.", `${detail}${others.length ? ` ${others.join(" and ")} ${others.length > 1 ? "see" : "sees"} “Route updated by ${S().session.displayName || S().session.username}”.` : ""}`);
  }

  async function emergencyOther(owner, data, next) {
    const p = R().team[owner], day = localDate();
    if (!p) return App.showResult(false, "No route", `${nameOf(owner)} has no route this week.`, "");
    RT().ensureDate(p, day);
    const s = RT().mkStop(data, { src: "emergency", next, date: day, seq: 999 });
    p.stops.push(s);
    if (next) {
      const list = RT().dayStops(p, day).filter((x) => x !== s);
      RT().assign(day, list.filter((x) => x.status === "done").concat([s], list.filter((x) => x.status !== "done")));
    } else {
      await RT().ensureCosts([p.start, p.end, ...RT().dayStops(p, day)]);
      RT().insertCheapest(p, s);
    }
    await saveOther([p], "Emergency stop added", `${data.name} added to ${nameOf(owner)}'s route for today${next ? " as the next stop" : ""}.`, `Emergency stop added: ${data.name}`);
  }

  // Move a stop to another driver, same day, where it adds the least driving.
  function openMoveDriver(d) {
    const owner = d.owner, s = RT().planFor(owner)?.stops.find((x) => x.id === d.id);
    if (!s) return;
    const targets = [[me(), `${S().session.displayName || "You"} (you)`]].concat((R().teamPeople || []).filter((p) => p.id !== me() && p.id !== owner).map((p) => [p.id, p.display_name || p.driver_number]))
      .filter(([id]) => id !== owner);
    const sel = R().moveTo;
    const target = sel ? (sel === me() ? R().plan : R().team[sel]) : null;
    const needStart = sel && !target;
    App.openSheet({
      title: `Move ${esc(s.name)} to`,
      body: `<div class="radio-list">${targets.map(([id, n]) => {
          const p = id === me() ? R().plan : R().team[id], cnt = p ? RT().dayStops(p, s.date).length : 0;
          return `<button class="${sel === id ? "on" : ""}" data-action="pickMoveTo" data-to="${esc(id)}" data-id="${esc(s.id)}" data-owner="${esc(owner)}"><span class="grow"><b>${esc(n)}</b><div class="small muted">${p ? `${cnt} stop${cnt === 1 ? "" : "s"} that day` : "No route this week"}</div></span></button>`;
        }).join("")}</div>
        ${needStart ? `<div class="field" style="margin-top:14px"><label class="label" for="mdStart">Start point for ${esc(nameOf(sel))} *</label>
          <input class="input" id="mdStart" placeholder="Street address where the route starts and finishes" autocomplete="off"><p class="hint">${esc(nameOf(sel))} has no route this week. The driver's default start point is used if there is one.</p></div>` : ""}
        <p class="hint">Same day (${s.date === localDate() ? "today" : RT().dayLabel(s.date)}). The stop goes where it adds the least driving.</p>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="doMoveDriver" ${sel ? "" : "disabled"}>Move</button>`,
      data: { id: s.id, owner },
    });
  }
  async function doMoveDriver() {
    const { id, owner } = S().sheet.data, to = R().moveTo;
    if (!to) return;
    const from = RT().planFor(owner), s = from.stops.find((x) => x.id === id);
    let target = to === me() ? R().plan : R().team[to];
    App.sheetBusy(true);
    try {
      if (!target) {
        let start = null;
        const { data: def } = await App.data.call(sb().from("tdg_route_defaults").select("start_point, end_point").eq("owner_id", to).maybeSingle());
        if (def) start = def.start_point;
        const typed = ($("#mdStart")?.value || "").trim();
        if (!start) {
          if (!typed) { App.sheetBusy(false); return App.sheetErr("Enter the start point."); }
          const p = await RT().geocodeText(typed);
          if (!p) { App.sheetBusy(false); return App.sheetErr(`“${typed}” was not found on the map.`); }
          start = { name: typed, address: typed, lat: p.lat, lng: p.lng };
        }
        target = RT().newPlan(to, from.weekStart, start, def ? def.end_point : start);
        if (to === me()) R().plan = target; else R().team[to] = target;
      }
    } catch (error) {
      App.sheetBusy(false);
      return App.sheetErr(RT().reason(error));
    }
    App.sheetBusy(false);
    App.closeSheet(false);
    R().moveTo = null;
    const date = s.date;
    from.stops = from.stops.filter((x) => x !== s);
    RT().renumber(from, date);
    RT().ensureDate(target, date);
    s.next = false;
    target.stops.push(s);
    await RT().ensureCosts([target.start, target.end, ...RT().dayStops(target, date)]);
    RT().insertCheapest(target, s);
    await saveOther([from, target], "Stop moved", `${s.name} moved to ${to === me() ? "your" : `${nameOf(to)}'s`} route for ${date === localDate() ? "today" : RT().dayLabel(date)}.`, `${s.name} moved to ${to === me() ? "the route of " + (S().session.displayName || "a supervisor") : nameOf(to)}`);
  }

  App.SCREENS.teamDriver = renderTeamDriver;
  Object.assign(App.ACTIONS, {
    openTeam: (d) => { if (d.id === me()) { R().tab = "mine"; return App.render(); } R().teamId = d.id; R().teamDay = null; R().editOrder = null; App.go("teamDriver"); },
    teamBack: () => { R().tab = "team"; R().editOrder = null; App.go("route"); },
    moveDriver: (d) => { App.closeSheet(false); R().moveTo = null; openMoveDriver(d); },
    pickMoveTo: (d) => { R().moveTo = d.to; App.closeSheet(false); openMoveDriver({ id: d.id, owner: d.owner }); },
    doMoveDriver,
  });

  App.routeTeam = { load, renderTeam, nameOf, saveOther, emergencyOther };
})();
