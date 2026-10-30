/* Route (ROUTE_PROPOSAL.md): the driver's planned stops for the week, Today's Route, the Route
 * tab, stop actions, ticks from deliveries, Emergency Call, Delete Route, Re-plan and Off-Duty carry-over.
 * Route is optional (decision 29): without a route nothing here shows on the Today screen.
 * Plans and stops live in tdg_route_plans / tdg_route_stops; changes go through the upload
 * queue (route.save, route.tick) so the driver's own route also changes without a connection.
 * Uploading a list and planning are in route_upload.js; the Team view is in route_team.js. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { $, esc, icon, store, uuid, localDate, addDays, parseLocalDate, weekday, device, nowHHMM } = App;
  const P = () => window.TDG_ROUTE_PLAN;
  const S = () => App.S;
  const sb = () => window.supabaseClient;

  const ROUTE_KEY = "tdg_app_route_v1";
  const COSTS_KEY = "tdg_app_route_costs_v1";
  const KEPT = "Your change is kept on this phone and will upload automatically when the connection is back.";
  const reason = (e) => (navigator.onLine === false ? "No internet connection." : e?.message || "Request failed");

  /* ---------------- dates ---------------- */
  // The route's "today" is the open work day (it can run past midnight).
  const today = () => (App.canRecord() && S().day?.date) || localDate();
  function mondayOf(date) {
    const d = parseLocalDate(date);
    return addDays(date, d.getDay() === 0 ? -6 : 1 - d.getDay());
  }
  const isFriday = (date) => weekday(date) === "Fri";
  // Next Monday to Friday after a date, within the same week (Friday has none).
  function nextWorkday(date) {
    let d = addDays(date, 1);
    while (["Sat", "Sun"].includes(weekday(d))) d = addDays(d, 1);
    return mondayOf(d) === mondayOf(date) ? d : null;
  }
  const dayLabel = (d) => `${weekday(d)} ${d.slice(5).replace("-", "/")}`;

  /* ---------------- plan data ---------------- */
  const R = () => (S().route ||= { tab: "mine", day: null, mode: "map", editOrder: null, team: {}, ...store.get(ROUTE_KEY, {}) });
  function persist() {
    const r = R();
    store.set(ROUTE_KEY, { plan: r.plan || null, next: r.next || null, lists: r.lists || [], defaults: r.defaults || null });
  }

  const newPlan = (ownerId, weekStart, start, end) => ({ id: uuid(), ownerId, weekStart, dates: [], start, end, listId: null, version: 0, notice: null, stops: [] });
  const mkStop = (c, extra = {}) => ({
    id: uuid(), acc: c.accountNumber || c.acc || "", name: c.accountName || c.name || "Stop", addr: c.accountAddress ?? c.addr ?? "", city: c.city || "",
    lat: c.lat ?? null, lng: c.lng ?? null, date: null, seq: 0, status: "pending", src: "list", next: false, carried: false, waitReplan: false,
    doneAt: "", doneRecord: "", visits: [], product: c.product || "", rte: c.rte || "", ...extra,
  });

  const planRow = (p) => ({ id: p.id, owner_id: p.ownerId, week_start: p.weekStart, dates: p.dates, start_point: p.start, end_point: p.end, list_id: p.listId || null });
  const stopRow = (s) => ({
    id: s.id, account_number: s.acc, name: s.name, address: s.addr, city: s.city, lat: s.lat, lng: s.lng, plan_date: s.date, seq: s.seq,
    status: s.status, source: s.src, deliver_next: !!s.next, carried: !!s.carried, wait_replan: !!s.waitReplan, done_at: s.doneAt || "",
    done_record: s.doneRecord || "", visits: s.visits || [], product: s.product || "", co2_rte: s.rte || "",
  });
  const fromRows = (p, stops) => ({
    id: p.id, ownerId: p.owner_id, weekStart: p.week_start, dates: (p.dates || []).slice().sort(), start: p.start_point, end: p.end_point,
    listId: p.list_id, version: p.version, notice: p.notice, updatedByName: p.updated_by_name, updatedAt: p.updated_at,
    stops: stops.filter((s) => s.plan_id === p.id).map((s) => ({
      id: s.id, acc: s.account_number, name: s.name, addr: s.address, city: s.city, lat: s.lat, lng: s.lng, date: s.plan_date, seq: s.seq,
      status: s.status, src: s.source, next: s.deliver_next, carried: s.carried, waitReplan: s.wait_replan, doneAt: s.done_at,
      doneRecord: s.done_record, visits: s.visits || [], product: s.product, rte: s.co2_rte,
    })),
  });

  // A day's stops in route order: delivered ones first (in the order delivered), then the rest.
  function dayStops(plan, date) {
    const list = (plan?.stops || []).filter((s) => s.date === date && s.status !== "removed");
    const done = list.filter((s) => s.status === "done").sort((a, b) => String(a.doneAt).localeCompare(String(b.doneAt)) || a.seq - b.seq);
    return done.concat(list.filter((s) => s.status !== "done").sort((a, b) => a.seq - b.seq));
  }
  const pendingOn = (plan, date) => dayStops(plan, date).filter((s) => s.status === "pending");
  const activeStops = (plan) => (plan?.stops || []).filter((s) => s.status !== "removed");
  const assign = (date, list, from = 1) => list.forEach((s, i) => { s.date = date; s.seq = from + i; });
  function renumber(plan, date) { assign(date, dayStops(plan, date)); }
  function ensureDate(plan, date) { if (!plan.dates.includes(date)) { plan.dates.push(date); plan.dates.sort(); } }
  const dayColor = (plan, date) => `var(--d${(Math.max(0, plan.dates.indexOf(date)) % 5) + 1})`;
  // Where the driver is now on a day: the last delivered stop, or the start point.
  function curPos(plan, date) {
    const done = dayStops(plan, date).filter((s) => s.status === "done" && s.lat != null);
    return done.length ? done[done.length - 1] : plan.start;
  }

  /* ---------------- driving times and positions ---------------- */
  let costs = null;
  function costTable() {
    if (!costs) costs = P().costTable(store.get(COSTS_KEY, {}) || {});
    return costs;
  }
  function saveCosts() {
    const k = costs.known, keys = Object.keys(k);
    if (keys.length > 20000) keys.slice(0, keys.length - 15000).forEach((x) => delete k[x]); // the oldest go first
    try { store.set(COSTS_KEY, k); } catch { /* storage full: they are asked again next time */ }
  }
  async function fnError(error) {
    try { return new Error((await error.context.json()).error || error.message); } catch { return error; }
  }
  async function routeFn(body) {
    const r = await sb().functions.invoke("tdg-route", { body });
    if (r.error) throw await fnError(r.error);
    return r.data;
  }
  // Real driving times between all these points (one Matrix call); without a connection or when
  // the service is busy, the planning uses estimates and this returns false.
  async function ensureCosts(points) {
    const missing = P().missingPoints(costTable(), points);
    if (!missing.length) return true;
    try {
      const m = await routeFn({ action: "matrix", points: missing.map((p) => ({ lat: p.lat, lng: p.lng })) });
      costTable().add(missing, m.durations, m.distances);
      saveCosts();
      return true;
    } catch (error) {
      console.warn("Driving times not loaded; using estimates:", error.message);
      return false;
    }
  }
  // Customers' positions: found once on the server and kept on the customer (3.8). A found (auto)
  // one is asked again: the server keeps it while the address is the same, else finds it again.
  // The curb (decision 50) comes with it, worked out once per position.
  const posKey = (c) => `${Number(c.lat).toFixed(5)},${Number(c.lng).toFixed(5)}`;
  async function locateCustomers(custs) {
    const need = custs.filter((c) => c && c.id && (c.lat == null || c.geoSource === "auto" || c.curbFor !== posKey(c)));
    const found = {};
    for (let i = 0; i < need.length; i += 100) {
      const { results } = await routeFn({ action: "geocodeCustomers", ids: need.slice(i, i + 100).map((c) => c.id) });
      Object.assign(found, results);
    }
    for (const c of need) {
      const p = found[c.id];
      if (p) App.data.putCustomer({ ...c, lat: p.lat, lng: p.lng, geoSource: p.source, curb: p.curb ?? null, curbFor: p.curbFor || "" }, S().loc?.prov || "");
    }
    return found;
  }
  async function geocodeText(text) {
    const { results } = await routeFn({ action: "geocode", items: [{ key: "a", text }] });
    return results.a || null;
  }
  const findCustomer = (acc) => {
    const k = P().normAcc(acc);
    return k ? App.data.cachedCustomers().find((c) => P().normAcc(c.accountNumber) === k) || null : null;
  };
  // A stop's curb bearing, while it is the one for the customer's current position (decisions 49–50).
  const curbOf = (s) => { const c = findCustomer(s.acc); return c && c.lat != null && c.curbFor === posKey(c) ? c.curb : null; };

  /* ---------------- server ---------------- */
  const pendingRoute = () => App.outbox.items().some((it) => it.kind.startsWith("route."));

  // This week's and next week's plans, the lists received and the default start point.
  async function load() {
    if (!App.canRecord()) return;
    const r = R(), me = S().session.userId, mon = mondayOf(today()), nextMon = addDays(mon, 7);
    const [plans, lists, defs] = await Promise.all([
      App.data.call(sb().from("tdg_route_plans").select("*").eq("owner_id", me).in("week_start", [mon, nextMon])),
      App.data.call(sb().from("tdg_route_lists").select("*").eq("driver_id", me).neq("status", "replaced").gte("week_start", mon).order("sent_at", { ascending: false })),
      App.data.call(sb().from("tdg_route_defaults").select("start_point, end_point").eq("owner_id", me).maybeSingle()),
    ]);
    const ids = (plans.data || []).map((p) => p.id);
    const stops = ids.length ? (await App.data.call(sb().from("tdg_route_stops").select("*").in("plan_id", ids))).data || [] : [];
    // Changes made on this phone and not uploaded yet win until they are uploaded.
    if (!pendingRoute()) {
      const byWeek = (w) => (plans.data || []).find((p) => p.week_start === w);
      r.plan = byWeek(mon) ? fromRows(byWeek(mon), stops) : null;
      r.next = byWeek(nextMon) ? fromRows(byWeek(nextMon), stops) : null;
    }
    r.lists = lists.data || [];
    r.defaults = defs.data ? { start: defs.data.start_point, end: defs.data.end_point } : r.defaults || null;
    persist();
  }
  // The week moved on: next week's plan becomes this week's, last week's is over.
  function rollWeek() {
    const r = R(), mon = mondayOf(today());
    if (r.plan && r.plan.weekStart < mon) r.plan = null;
    if (r.next && r.next.weekStart === mon) { r.plan = r.next; r.next = null; }
    if (r.next && r.next.weekStart < mon) r.next = null;
  }
  async function refresh() {
    rollWeek();
    try { await load(); } catch (error) { console.warn("Route not read from the server; using this phone's copy:", error.message); }
    rollWeek();
    App.render();
  }

  // Upload queue: whole plans (base version for the conflict check) and single ticks.
  Object.assign(App.data.writes, {
    async "route.save"({ saves }) {
      try {
        const { data } = await App.data.call(sb().rpc("tdg_route_save", { p_saves: saves }));
        return { saved: data };
      } catch (error) {
        if (error.code === "P0409") return { conflict: true, message: error.message };
        throw error;
      }
    },
    async "route.tick"({ stopId, patch }) {
      try {
        const { data } = await App.data.call(sb().rpc("tdg_route_tick", { p_stop_id: stopId, p_patch: patch }));
        return { stop: data };
      } catch (error) {
        if (error.code === "P0002") return { gone: true }; // the stop was moved to another driver
        throw error;
      }
    },
    async "route.listAnswer"({ id, status }) {
      try {
        await App.data.call(sb().rpc("tdg_route_list_answer", { p_id: id, p_status: status }));
        return {};
      } catch (error) {
        if (error.code === "P0002") return { gone: true };
        throw error;
      }
    },
  });

  // After each accepted upload: new versions. A refused change brings the server's route back and
  // is reported at once, also when the queue sent it in the background (connection back, start-up).
  let conflictShowing = null;
  function uploaded(item, result) {
    if (!item.kind.startsWith("route.") || !S()) return;
    const r = R();
    if (item.kind === "route.save") {
      if (result?.conflict) {
        conflictShowing = conflictShown(result.message || "Route was just changed by someone else.");
        return;
      }
      for (const v of result?.saved || []) {
        for (const p of [r.plan, r.next, ...Object.values(r.team || {})]) if (p && p.id === v.id) p.version = v.version;
      }
      persist();
    }
  }

  // Saves the driver's own plan(s): on this phone first, then uploaded.
  async function commit(plans, { title, detail = "", notice = null, onClose = null } = {}) {
    persist();
    App.outbox.add("route.save", { saves: plans.map((p) => ({ plan: planRow(p), stops: p.stops.map(stopRow), base_version: p.version || null, notice })) });
    App.render();
    const before = conflictShowing;
    const res = await App.outbox.flush();
    if (conflictShowing !== before) { await conflictShowing; return false; }
    App.render();
    if (!title) return res.ok;
    if (res.ok) App.showResult(true, title, "Saved to Supabase.", detail, onClose);
    else App.showResult(false, `${title} on this phone`, reason(res.error), KEPT, onClose);
    return res.ok;
  }
  async function conflictShown(msg) {
    try { await load(); } catch {}
    App.render();
    App.showResult(false, "Route was just changed", msg, "The latest version is shown now. Your change was not saved. Please make it again.");
    return false;
  }
  // A tick (or a visit) uploads on its own and never conflicts with other changes.
  function queueTick(stop, patch) {
    persist();
    App.outbox.add("route.tick", { stopId: stop.id, patch });
  }
  // Its delivery was deleted or changed to nothing delivered: the stop is not delivered any more.
  function untick(rec) {
    const s = (R().plan?.stops || []).find((x) => x.status === "done" && x.doneRecord && x.doneRecord === rec.clientRecordId);
    if (!s) return;
    Object.assign(s, { status: "pending", doneAt: "", doneRecord: "" });
    queueTick(s, { status: "pending", done_at: "", done_record: "", undo_record: rec.clientRecordId });
    App.outbox.flush();
  }

  /* ---------------- ticks from deliveries (3.4, decision 30) ---------------- */
  // Called after a delivery is saved: the stop it was started from, or this week's pending stop
  // for the same customer (today's first). Returns a line for the result dialog.
  function afterDelivery(rec, stopId = null) {
    const plan = R().plan;
    if (!plan || !App.canRecord()) return "";
    const day = today();
    let s = stopId ? plan.stops.find((x) => x.id === stopId && x.status === "pending") : null;
    if (!s && rec.accountNumber) {
      const k = P().normAcc(rec.accountNumber);
      const hits = plan.stops.filter((x) => x.status === "pending" && x.acc && P().normAcc(x.acc) === k);
      s = hits.find((x) => x.date === day) || hits[0] || null;
    }
    if (!s) return "";
    // Nothing delivered: the stop goes to the end of the day for a later visit.
    if (!(Number(rec.deliveredVolume) > 0)) {
      s.visits = [...(s.visits || []), { t: rec.arrivalTime, note: rec.notes || "" }];
      s.next = false;
      s.seq = Math.max(0, ...dayStops(plan, s.date).map((x) => x.seq)) + 1;
      queueTick(s, { visits: s.visits, seq: s.seq, deliver_next: false });
      return "Nothing delivered. The stop moved to the end of today's route so you can come back later.";
    }
    const from = s.date;
    if (from !== day) { ensureDate(plan, day); s.date = day; }
    Object.assign(s, { status: "done", doneAt: rec.arrivalTime || nowHHMM(), doneRecord: rec.clientRecordId || "", next: false });
    renumber(plan, day);
    if (from !== day) renumber(plan, from);
    queueTick(s, { status: "done", done_at: s.doneAt, done_record: s.doneRecord, plan_date: s.date, seq: s.seq, deliver_next: false });
    return from !== day ? `Route stop ticked. It was planned for ${dayLabel(from)} and is taken off that day.` : "Route stop ticked.";
  }
  // Add Delivery turns Emergency Charge on for a customer who is a pending Emergency Call stop today.
  function isPendingEmergency(acc) {
    const k = P().normAcc(acc);
    return !!k && pendingOn(R().plan, today()).some((s) => s.src === "emergency" && P().normAcc(s.acc) === k);
  }

  /* ---------------- map: the stops on OpenStreetMap streets (Leaflet, owner's decision 2026-10-28) ---------------- */
  // Screens are HTML strings (App.render), so routeMap leaves an empty box and the map is made as
  // soon as the box is on the page. Without a connection there are no streets, the stops still show.
  const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  let maps = [], mapCount = 0;
  const cssColor = (c) => (c.startsWith("var(") ? getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1)).trim() : c);
  const pin = (html, className) => window.L.divIcon({ html, className, iconSize: [24, 24], iconAnchor: [12, 12] });
  // Each day's road (decision 47): the straight line first, the road from openrouteservice once it
  // comes; kept on the phone by the points it goes through (the last 20 days drawn). Screens are drawn
  // again often: one request per road at a time, and after a refusal none for 5 minutes.
  const ROADS_KEY = "tdg_app_route_roads_v1";
  const asking = new Map(), refused = new Map();
  function roadLine(points) {
    const key = points.map(posKey).join(";"), roads = store.get(ROADS_KEY, {}) || {};
    if (roads[key]) return Promise.resolve(roads[key]);
    if (navigator.onLine === false || Date.now() - (refused.get(key) || 0) < 300000) return Promise.resolve(null);
    if (!asking.has(key)) asking.set(key, routeFn({ action: "directions", points: points.map((p) => ({ lat: p.lat, lng: p.lng })) }).then(({ line }) => {
      const kept = store.get(ROADS_KEY, {}) || {}, keys = Object.keys(kept);
      keys.slice(0, Math.max(0, keys.length - 19)).forEach((k) => delete kept[k]);
      try { store.set(ROADS_KEY, { ...kept, [key]: line }); } catch { /* storage full: asked again next time */ }
      return line;
    }, (error) => {
      console.warn("Road not loaded; straight lines shown:", error.message);
      refused.set(key, Date.now());
      return null;
    }).finally(() => asking.delete(key)));
    return asking.get(key);
  }
  function mountMap(id, { layers, start, end, owner }) {
    const L = window.L, el = document.getElementById(id);
    for (const m of maps) if (!m.getContainer().isConnected) m.remove(); // maps of screens no longer shown
    maps = maps.filter((m) => m.getContainer().isConnected);
    if (!L || !el) return;
    const map = L.map(el, { scrollWheelZoom: false });
    // The app's pages are https://localhost: sent without a referrer (OpenStreetMap's tile policy for apps).
    L.tileLayer(TILES, { maxZoom: 19, referrerPolicy: App.inApp ? "no-referrer" : false,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    const at = (p) => [p.lat, p.lng];
    const bounds = [start, end].filter((p) => p?.lat != null).map(at);
    for (const ly of layers) {
      const color = cssColor(ly.color);
      const points = [start, ...ly.stops.map((x) => x.s), end || start].filter((p) => p?.lat != null);
      const line = L.polyline(points.map(at), { color, weight: 3, opacity: 0.6 }).addTo(map);
      if (points.length > 1) roadLine(points).then((road) => { if (road?.length > 1 && map.getContainer().isConnected) line.setLatLngs(road); });
      for (const { s, n } of ly.stops) {
        const m = L.marker(at(s), { icon: pin(`<span style="background:${color}">${n}</span>`, `map-dot${s.status === "done" ? " done" : ""}`), interactive: !!owner, keyboard: false }).addTo(map);
        if (owner) m.on("click", () => App.ACTIONS.stopTap({ id: s.id, owner }));
        bounds.push(at(s));
      }
    }
    if (start?.lat != null) L.marker(at(start), { icon: pin("S", "map-start"), interactive: false, keyboard: false }).addTo(map);
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    maps.push(map);
  }
  function routeMap(plan, dates, owner) {
    const layers = dates.map((d) => ({ color: dayColor(plan, d), stops: dayStops(plan, d).map((s, i) => ({ s, n: i + 1 })).filter((x) => x.s.lat != null) }));
    const hidden = dates.reduce((n, d) => n + dayStops(plan, d).filter((s) => s.lat == null).length, 0);
    const cap = `<p class="map-cap">Where the stops are, in route order (S = start). Tap a numbered stop to open it.${hidden ? ` ${hidden} stop${hidden > 1 ? "s have" : " has"} no position yet and ${hidden > 1 ? "are" : "is"} not drawn.` : ""} Roads and driving times © openrouteservice by HeiGIT.</p>`;
    const located = [plan.start, plan.end, ...layers.flatMap((ly) => ly.stops.map((x) => x.s))].some((p) => p?.lat != null);
    if (!located) return `<div class="empty">No positions to show yet.</div>${cap}`;
    const id = `routeMap${++mapCount}`;
    queueMicrotask(() => mountMap(id, { layers, start: plan.start, end: plan.end, owner }));
    return `<div class="map-wrap" id="${id}" role="img" aria-label="Map of the stops"></div>${cap}`;
  }

  /* ---------------- legs ---------------- */
  const fmtKm = (m) => { const k = m / 1000; return k < 10 ? k.toFixed(1) : String(Math.round(k)); };
  const fmtMin = (s) => Math.max(1, Math.round(s / 60));
  const fmtDur = (s) => { const m = fmtMin(s); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  const legs = (plan, date) => P().legs(costTable(), plan.start, dayStops(plan, date), plan.end);

  /* ---------------- Today's Route card (decision 11) ---------------- */
  const srcChips = (s) => [
    s.src === "emergency" ? `<span class="chip bad">Emergency</span>` : "",
    s.carried ? `<span class="chip warn">Carried over</span>` : "",
    s.next && s.status === "pending" ? `<span class="chip brand">Deliver next</span>` : "",
    s.waitReplan ? `<span class="chip warn">Re-plan when online</span>` : "",
    s.lat == null && s.status === "pending" ? `<span class="chip warn">No position</span>` : "",
    s.visits?.length && s.status === "pending" ? `<span class="chip warn">Visited ${esc(s.visits[s.visits.length - 1].t)} · not delivered</span>` : "",
  ].join("");

  function noticeHtml(plan) {
    const n = plan?.notice;
    if (!n || !n.at || device.get(`routeNotice:${S().session.userId}`) === n.at) return "";
    const at = n.at ? `${localDate(new Date(n.at))} ${nowHHMM(new Date(n.at))}` : "";
    return `<div class="notice">${icon("update", 20)}<div class="grow"><b>Route updated by ${esc(n.by || "someone")}</b><div class="small muted num">${esc(at)}</div>
      <ul>${(n.items || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div><button class="btn btn-sm btn-outline" data-action="dismissNotice">OK</button></div>`;
  }

  function todayCard() {
    if (!App.canRecord()) return "";
    const plan = R().plan, day = today();
    const list = plan ? dayStops(plan, day) : [];
    if (!list.length) return "";
    const done = list.filter((s) => s.status === "done").length;
    const L = legs(plan, day);
    const nx = L.rows.find((r) => r.stop.status === "pending");
    const out = App.day.status() === "out";
    return `<section class="card" aria-label="Today's route" style="--dc:${dayColor(plan, day)}">
      <div class="card-h"><h2>Today's Route</h2><span class="chip ${done === list.length ? "ok" : "brand"}">${done} / ${list.length} done</span></div>
      ${noticeHtml(plan)}
      ${nx ? `<div class="row" style="align-items:flex-start;margin-bottom:12px"><span class="num-badge">${L.rows.indexOf(nx) + 1}</span>
          <div class="grow"><div class="small muted num">Next stop · ${fmtKm(nx.m)} km · ${fmtMin(nx.s)} min</div><div class="rec-name">${esc(nx.stop.name)}</div><div class="rec-sub">${esc(nx.stop.addr)}</div><div class="rec-chips">${srcChips(nx.stop)}</div></div></div>
        <div class="grid2"><button class="btn btn-outline" data-action="navigate" data-id="${esc(nx.stop.id)}">${icon("nav", 18)} Navigate</button>
          <button class="btn btn-primary" data-action="startStop" data-id="${esc(nx.stop.id)}" ${out ? "disabled" : ""}>Start Delivery</button></div>`
        : `<p class="muted" style="margin:0 0 4px">All of today's stops are delivered.</p>`}
      <div class="grid2" style="margin-top:10px"><button class="btn btn-sm btn-outline" data-action="openRouteToday">${icon("list", 16)} Today's list</button>
        <button class="btn btn-sm btn-danger-outline" data-action="deleteRoute" ${nx ? "" : "disabled"}>${icon("trash", 16)} Delete Route</button></div>
    </section>`;
  }

  /* ---------------- Route tab ---------------- */
  function dayChips(plan, sel, owner) {
    return `<div class="seg-tabs day-tabs" role="tablist">${plan.dates.map((d) => `
      <button class="${d === sel ? "on" : ""}" style="--dc:${dayColor(plan, d)}" data-action="routeDay" data-date="${d}" data-owner="${esc(owner)}"><span class="day-dot"></span>${d === today() ? "Today" : dayLabel(d)} · ${dayStops(plan, d).length}</button>`).join("")}</div>`;
  }
  function routeSum(plan, d) {
    const list = dayStops(plan, d), L = legs(plan, d);
    const done = list.filter((s) => s.status === "done").length;
    return `<div class="route-sum"><div class="num"><b>${list.length} stop${list.length === 1 ? "" : "s"}</b> · ${done} done<div class="small muted">${fmtKm(L.m)} km · ${fmtDur(L.s)} driving</div></div>
      <span class="segmented" role="group" aria-label="List or map">
        <button class="${R().mode === "list" ? "on" : ""}" data-action="routeMode" data-mode="list">List</button>
        <button class="${R().mode === "map" ? "on" : ""}" data-action="routeMode" data-mode="map">Map</button></span></div>`;
  }
  function stopList(plan, date, owner) {
    const L = legs(plan, date);
    if (!L.rows.length) return `<div class="empty">No stops on this day.</div>`;
    const editing = R().editOrder === owner;
    const pend = L.rows.filter((r) => r.stop.status === "pending").map((r) => r.stop);
    const first = date === today() ? pend[0] : null;
    return `<div class="stops" style="--dc:${dayColor(plan, date)}">${L.rows.map(({ stop: s, m, s: secs }, i) => {
      const pi = pend.indexOf(s);
      const status = s.status === "done" ? `<span class="chip ok">${icon("check", 12)} Delivered ${esc(s.doneAt || "")}</span>` : "";
      return `<div class="leg">${i === 0 ? `From ${esc(plan.start?.name || "start")} · ` : ""}${fmtKm(m)} km · ${fmtMin(secs)} min</div>
        <div class="stop-row">
          <button class="stop ${s.status} ${s === first ? "next" : ""}" data-action="stopTap" data-id="${esc(s.id)}" data-owner="${esc(owner)}">
            <span class="num-badge">${s.status === "done" ? icon("check", 16) : i + 1}</span>
            <span class="grow"><span class="rec-name">${esc(s.name)}</span><span class="rec-sub">${esc(s.addr)}</span>
              <span class="rec-chips">${status}${srcChips(s)}${s === first ? `<span class="chip brand">Next</span>` : ""}</span></span>
          </button>
          ${editing && s.status === "pending" ? `<div class="ordbtns">
            <button data-action="moveUp" data-id="${esc(s.id)}" data-owner="${esc(owner)}" aria-label="Move up" ${pi === 0 ? "disabled" : ""}>${icon("up", 16)}</button>
            <button data-action="moveDown" data-id="${esc(s.id)}" data-owner="${esc(owner)}" aria-label="Move down" ${pi === pend.length - 1 ? "disabled" : ""}>${icon("down", 16)}</button></div>` : ""}
        </div>`;
    }).join("")}<div class="leg">${fmtKm(L.back.m)} km · ${fmtMin(L.back.s)} min back to ${esc(plan.end?.name || "the finish")}</div></div>`;
  }

  function renderRoute() {
    if (!App.canRecord()) return `<div class="empty">Route is not used by your role.</div>`;
    const r = R();
    const seg = `<span class="segmented" role="group" aria-label="Route view">
        <button class="${r.tab === "mine" ? "on" : ""}" data-action="routeTab" data-tab="mine">My route</button>
        <button class="${r.tab === "team" ? "on" : ""}" data-action="routeTab" data-tab="team">Team</button></span>`;
    return `<div class="page-h"><h1>Route</h1>${seg}</div>${r.tab === "team" ? App.routeTeam.renderTeam() : renderMine()}`;
  }

  function renderMine() {
    const r = R(), plan = r.plan, day = today();
    const top = noticeHtml(plan) + App.routeUpload.listCards();
    if (!plan || !activeStops(plan).length) {
      return `${top}
        <section class="card" style="text-align:center">
          <div class="ph-ic" style="margin:4px auto 12px">${icon("route", 32)}</div>
          <h2 style="margin:0 0 6px;font-size:18px">No route this week</h2>
          <p class="muted" style="margin:0 0 16px">Upload this week's delivery list. The app plans the Z02 (local) and Z01 (long distance) customers into daily routes. Route is optional: without it, check in and use Add Delivery as before.</p>
          <button class="btn btn-primary block lg" data-action="startUpload">${icon("upload", 20)} Upload List</button>
          <button class="btn btn-outline block" style="margin-top:10px" data-action="emergency">${icon("siren", 18)} Emergency Call</button>
        </section>`;
    }
    if (!r.day || !plan.dates.includes(r.day)) r.day = plan.dates.includes(day) ? day : plan.dates.find((d) => d >= day) || plan.dates[plan.dates.length - 1];
    const d = r.day, editing = r.editOrder === "me";
    return `${top}${dayChips(plan, d, "me")}${routeSum(plan, d)}
      ${r.mode === "map" ? routeMap(plan, [d], "me") : stopList(plan, d, "me")}
      <div class="grid2" style="margin-top:14px">
        <button class="btn btn-outline" data-action="emergency">${icon("siren", 18)} Emergency</button>
        <button class="btn btn-outline" data-action="startUpload">${icon("upload", 18)} Upload List</button>
        <button class="btn btn-outline" data-action="replan" data-owner="me">${icon("update", 18)} Re-plan</button>
        ${d === day && pendingOn(plan, d).length > 1 ? `<button class="btn ${editing ? "btn-primary" : "btn-outline"}" data-action="editOrder" data-owner="me">${editing ? "Save order" : "Change order"}</button>` : ""}
      </div>
      <p class="hint" style="text-align:center;margin-top:12px">Driving times only. Time at each customer is not counted, so there are no arrival times.</p>`;
  }

  /* ---------------- stop actions ---------------- */
  // owner: "me", "next" (next week), "draft" (a plan being reviewed) or a driver's id (Team).
  const planFor = (owner) => (owner === "me" ? R().plan : owner === "next" ? R().next : owner === "draft" ? R().draft : R().team[owner] || null);
  const findStop = (owner, id) => planFor(owner)?.stops.find((x) => x.id === id) || null;
  const canEditOthers = () => ["supervisor", "admin"].includes(S().role);

  function openStop(d) {
    const owner = d.owner, plan = planFor(owner), s = findStop(owner, d.id);
    if (!s) return;
    const own = owner === "me", draft = owner === "draft" || owner === "next";
    const editable = draft || (own ? App.canRecord() : canEditOthers());
    const pend = s.status === "pending";
    const c = s.acc ? findCustomer(s.acc) : null;
    const b = [];
    if (own && pend && s.date === today()) b.push(`<button class="btn btn-primary block lg" data-action="startStop" data-id="${esc(s.id)}" ${App.day.status() === "out" ? "disabled" : ""}>Start Delivery</button>`);
    if (own && pend) b.push(`<button class="btn btn-outline block" data-action="navigate" data-id="${esc(s.id)}">${icon("nav", 18)} Navigate</button>`);
    if (editable && pend) {
      b.push(own || draft
        ? `<button class="btn btn-outline block" data-action="moveDay" data-id="${esc(s.id)}" data-owner="${esc(owner)}">${icon("calendar", 18)} Move to another day</button>`
        : `<div class="grid2"><button class="btn btn-outline" data-action="moveDay" data-id="${esc(s.id)}" data-owner="${esc(owner)}">${icon("calendar", 18)} Another day</button>
            <button class="btn btn-outline" data-action="moveDriver" data-id="${esc(s.id)}" data-owner="${esc(owner)}">${icon("swap", 18)} Another driver</button></div>`);
      b.push(`<button class="btn btn-danger-outline block" data-action="removeStop" data-id="${esc(s.id)}" data-owner="${esc(owner)}">${icon("trash", 18)} Remove (order cancelled)</button>`);
    }
    if (c && App.canAddCustomer() && !draft) b.push(`<button class="btn btn-sm btn-outline block" data-action="fixPos" data-id="${esc(c.id)}">${icon("pin", 16)} Wrong position? Fix it</button>`);
    const when = s.status === "done" ? `<span class="chip ok">${icon("check", 12)} Delivered ${esc(s.doneAt || "")}</span>` : `<span class="chip">${s.date === today() ? "Today" : dayLabel(s.date)}</span>`;
    const whose = own ? "" : draft ? " · New plan" : ` · ${esc(App.routeTeam.nameOf(owner))}'s route`;
    App.openSheet({
      title: esc(s.name),
      body: `<div class="kmbox" style="margin-bottom:12px"><b>${esc([s.addr, s.city].filter(Boolean).join(", "))}</b><div class="small muted">${s.acc ? `Acc ${esc(s.acc)}` : "Not in Customers"}${whose}</div><div class="rec-chips">${when}${srcChips(s)}</div></div>
        ${s.visits?.length ? s.visits.map((v) => `<p class="hint">Visited ${esc(v.t)} · nothing delivered${v.note ? `: ${esc(v.note)}` : ""}</p>`).join("") : ""}
        <div class="stack">${b.join("") || `<p class="muted small" style="margin:0">View only.</p>`}</div>`,
    });
  }

  // Google Maps directions to the stop (its position when it was set by hand, else the address).
  function navigate(d) {
    const s = findStop("me", d.id);
    if (!s) return;
    const dest = s.lat != null && findCustomer(s.acc)?.geoSource === "manual" ? `${s.lat},${s.lng}` : [s.addr, s.city].filter(Boolean).join(", ");
    App.native.openExternal(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`);
  }

  function startStop(d) {
    const s = findStop("me", d.id);
    if (!s) return;
    App.closeSheet(false);
    const c = findCustomer(s.acc);
    App.flows.openAdd({ acc: c?.accountNumber || s.acc, name: s.name, addr: s.addr, city: s.city, route: c?.route || P().routeOf(s.rte) || "Z02", emergency: s.src === "emergency", stopId: s.id });
  }

  // Move to another day of the week: where it adds the least driving on that day.
  function openMoveDay(d) {
    const owner = d.owner, plan = planFor(owner), s = findStop(owner, d.id);
    const from = owner === "draft" || owner === "next" ? plan.dates[0] : today();
    const opts = plan.dates.filter((x) => x >= from && x !== s.date);
    const last = plan.dates[plan.dates.length - 1] || from;
    const extra = nextWorkday(last >= from ? last : from);
    if (extra && !opts.includes(extra) && extra !== s.date) opts.push(extra);
    App.openSheet({
      title: `Move ${esc(s.name)}`,
      body: `<p class="muted" style="margin:0 0 12px">${esc(s.addr)} · now on ${s.date === today() ? "today" : dayLabel(s.date)}</p>
        ${opts.length ? `<div class="radio-list">${opts.map((x) => `<button data-action="doMoveDay" data-date="${x}">
          <span class="day-dot" style="--dc:${plan.dates.includes(x) ? dayColor(plan, x) : "var(--line-strong)"}"></span>
          <span class="grow"><b>${x === today() ? "Today" : weekday(x)}</b> <span class="num">${x}</span><div class="small muted">${plan.dates.includes(x) ? `${dayStops(plan, x).length} stops` : "New day"}</div></span>${icon("chev", 18)}</button>`).join("")}</div>`
          : `<p class="muted">No other day left this week.</p>`}
        <p class="hint">The stop goes where it adds the least driving on that day.</p>`,
      data: { id: s.id, owner },
    });
  }
  function insertCheapest(plan, s) {
    const list = dayStops(plan, s.date).filter((x) => x !== s);
    const done = list.filter((x) => x.status === "done"), pend = list.filter((x) => x.status !== "done");
    const from = done.length ? done[done.length - 1] : plan.start;
    pend.splice(s.lat == null ? pend.length : P().cheapestIndex(costTable(), from, pend, plan.end, s), 0, s);
    assign(s.date, done.concat(pend));
  }
  async function doMoveDay(d) {
    const { id, owner } = S().sheet.data;
    const plan = planFor(owner), s = findStop(owner, id), from = s.date;
    App.closeSheet(false);
    ensureDate(plan, d.date);
    s.date = d.date; s.next = false;
    await ensureCosts([plan.start, plan.end, ...dayStops(plan, d.date)]);
    insertCheapest(plan, s);
    renumber(plan, from);
    if (owner === "draft") { App.render(); return App.snackbar(`Moved to ${dayLabel(d.date)}.`); }
    await save(owner, plan, "Stop moved", `${s.name} moved to ${dayLabel(d.date)}.`, `${s.name} moved to ${dayLabel(d.date)}`);
  }

  function removeStop(d) {
    const owner = d.owner, plan = planFor(owner), s = findStop(owner, d.id);
    App.showConfirm({
      title: "Remove this stop?", okText: "Remove", danger: true,
      msg: `${s.name}, ${s.addr}. Use this when the order is cancelled. It will not go to the undelivered list.`,
      onOk: async () => {
        App.closeSheet(false);
        s.status = "removed";
        renumber(plan, s.date);
        if (owner === "draft") { App.render(); return App.snackbar("Stop removed."); }
        await save(owner, plan, "Stop removed", `${s.name} was removed from ${owner === "me" ? "your" : `${App.routeTeam.nameOf(owner)}'s`} route.`, `${s.name} removed (order cancelled)`);
      },
    });
  }

  /* ---------------- Delete Route (Today's Route card, owner's request 2026-10-29) ---------------- */
  // Today's undelivered stops: delete one of them or all; the ones left are re-planned. Delivered stops stay.
  function openDeleteRoute() {
    const un = pendingOn(R().plan, today());
    if (!un.length) return;
    App.openSheet({
      title: "Delete Route",
      body: `<p class="muted" style="margin:0 0 12px">Tap a stop to delete it, or delete all of today's undelivered stops. The stops left are re-planned. Delivered stops stay.</p>
        <div class="radio-list">${un.map((s) => `<button data-action="deleteStops" data-id="${esc(s.id)}" aria-label="Delete ${esc(s.name)}">
          <span class="grow"><b>${esc(s.name)}</b><div class="small muted">${esc(s.addr)}</div></span>${icon("trash", 18)}</button>`).join("")}</div>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-bad" data-action="deleteStops" data-id="all">Delete all (${un.length})</button>`,
    });
  }
  function deleteStops(d) {
    const plan = R().plan, day = today(), un = pendingOn(plan, day);
    const all = d.id === "all", gone = all ? un : un.filter((s) => s.id === d.id);
    if (!gone.length) return;
    App.showConfirm({
      title: all ? `Delete all ${gone.length} stops?` : "Delete this stop?", okText: "Delete", danger: true,
      msg: all ? "All of today's undelivered stops are taken off the route. Delivered stops stay." : `${gone[0].name}, ${gone[0].addr}. It is taken off today's route and the other stops are re-planned.`,
      onOk: async () => {
        App.closeSheet(false);
        gone.forEach((s) => { s.status = "removed"; });
        const left = pendingOn(plan, day);
        if (left.length) {
          await ensureCosts([plan.start, plan.end, ...dayStops(plan, day)]); // estimates without a connection
          reorderToday(plan, day, curPos(plan, day));
        } else renumber(plan, day);
        await commit([plan], all
          ? { title: "Today's route deleted", detail: `${gone.length} undelivered stop${gone.length > 1 ? "s were" : " was"} taken off today's route.` }
          : { title: "Stop deleted", detail: `${gone[0].name} was taken off today's route.${left.length ? ` The other ${left.length} stop${left.length > 1 ? "s were" : " was"} re-planned.` : ""}` });
      },
    });
  }

  // Saves a plan after a change: the driver's own through the upload queue, someone else's at once.
  function save(owner, plan, title, detail, noticeItem) {
    if (owner === "me" || owner === "next") return commit([plan], { title, detail });
    return App.routeTeam.saveOther([plan], title, detail, noticeItem);
  }

  // Re-plan: today's remaining stops from the last delivered one; later days split again.
  async function replan(d) {
    const owner = d.owner || "me", plan = planFor(owner);
    if (!plan) return;
    if (navigator.onLine === false) return App.showResult(false, "Re-plan needs a connection", "No internet connection.", "The route on this phone is unchanged. Try again when the connection is back.");
    const day = today(), later = plan.dates.filter((x) => x > day), hasToday = plan.dates.includes(day);
    const laterStops = plan.stops.filter((s) => s.status === "pending" && s.date > day);
    await ensureCosts([plan.start, plan.end, ...activeStops(plan)]);
    if (hasToday) reorderToday(plan, day, curPos(plan, day));
    if (later.length && laterStops.length) await planDates(plan, later, laterStops);
    plan.stops.forEach((s) => { s.waitReplan = false; });
    const detail = `${hasToday ? "Today's remaining stops now start from the last delivered stop." : ""}${later.length ? " Later days were re-planned." : ""}`.trim();
    await save(owner, plan, "Route re-planned", detail, "Route re-planned");
  }
  // Undelivered stops ordered from a position; "Deliver next" stops go first (decision 18).
  function reorderToday(plan, date, pos) {
    const list = dayStops(plan, date);
    const done = list.filter((s) => s.status === "done"), pend = list.filter((s) => s.status === "pending");
    const first = pend.filter((s) => s.next);
    const rest = P().orderDay(costTable(), first.length ? first[first.length - 1] : pos, pend.filter((s) => !s.next), plan.end, curbOf);
    assign(date, done.concat(first, rest));
  }
  // Stops split over days (3.3), after any stops already delivered on those days.
  async function planDates(plan, dates, stops) {
    dates.forEach((d) => ensureDate(plan, d));
    const groups = await splitInBackground(plan.start, plan.end, stops, dates.length);
    dates.forEach((d, i) => assign(d, groups[i], plan.stops.filter((s) => s.date === d && s.status === "done").length + 1));
  }

  /* ---------------- planning off the screen's thread (owner's choice 2026-10-28) ---------------- */
  // Splitting days runs in a Web Worker (js/route_worker.js) so the screen never freezes; it stops
  // itself after PLAN_LIMIT_MS with the best plan found so far. "Planning your route…" shows when it
  // takes longer than a moment. Where no worker can run, the same code runs here.
  const PLAN_LIMIT_MS = 3000;
  let worker = null, jobs = 0;
  function inWorker(msg) {
    return new Promise((resolve, reject) => {
      try { worker ||= new Worker("js/route_worker.js?v=1"); } catch (error) { return reject(error); }
      const id = ++jobs, w = worker;
      const stop = () => { w.removeEventListener("message", got); w.removeEventListener("error", failed); };
      const got = (e) => { if (e.data?.id !== id) return; stop(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.groups); };
      const failed = (e) => { stop(); worker = null; e.preventDefault?.(); reject(new Error(e.message || "Planning worker failed")); };
      w.addEventListener("message", got);
      w.addEventListener("error", failed);
      w.postMessage({ id, ...msg });
    });
  }
  async function splitInBackground(start, end, stops, days) {
    const note = setTimeout(() => planningNote(true), 200);
    try {
      const pts = [start, end, ...stops].filter((p) => p?.lat != null).map(P().pointKey), known = costTable().known, sub = {};
      for (const a of pts) for (const b of pts) if (`${a}>${b}` in known) sub[`${a}>${b}`] = known[`${a}>${b}`];
      const at = (p) => (p ? { lat: p.lat ?? null, lng: p.lng ?? null } : null);
      try {
        const groups = await inWorker({ start: at(start), end: at(end), stops: stops.map((s) => ({ addr: s.addr, ...at(s) })), days, curbs: stops.map(curbOf), known: sub, limit: PLAN_LIMIT_MS });
        return groups.map((g) => g.map((i) => stops[i]));
      } catch (error) {
        console.warn("Planning on the screen's thread:", error.message);
        return P().splitDays(costTable(), start, end, stops, days, { curbOf, until: Date.now() + PLAN_LIMIT_MS });
      }
    } finally {
      clearTimeout(note);
      planningNote(false);
    }
  }
  function planningNote(on) {
    const el = document.getElementById("planBusy");
    if (!on) return el?.remove();
    if (!el) document.body.insertAdjacentHTML("beforeend", `<div class="plan-busy" id="planBusy" role="status" aria-live="polite"><div><span class="spin" aria-hidden="true"></span>Planning your route…</div></div>`);
  }

  // Change order: up and down buttons, then Save order.
  function toggleEditOrder(d) {
    const r = R(), owner = d.owner, plan = planFor(owner);
    if (r.editOrder !== owner) {
      r.editOrder = owner;
      r.mode = "list"; // the up/down arrows are only on the list
      r.orderSnap = plan.stops.map((s) => [s.id, s.seq, s.next]);
      return App.render();
    }
    r.editOrder = null;
    plan.stops.forEach((s) => { if (s.status === "pending") s.next = false; });
    save(owner, plan, "Order saved", "The new stop order is saved.", "Stop order changed");
  }
  function moveOrder(d, dir) {
    const plan = planFor(d.owner), s = findStop(d.owner, d.id);
    const pend = pendingOn(plan, s.date), i = pend.indexOf(s), j = i + dir;
    if (j < 0 || j >= pend.length) return;
    [pend[i].seq, pend[j].seq] = [pend[j].seq, pend[i].seq];
    App.render();
  }

  /* ---------------- Emergency Call (3.5, decisions 7, 17, 18, 26) ---------------- */
  function openEmergency(owner = "me") {
    const own = owner === "me";
    App.openSheet({
      title: own ? "Emergency Call" : `Emergency Call · ${esc(App.routeTeam.nameOf(owner))}`,
      tall: true,
      body: `<div class="note-box">Find the customer, or type the address from the dispatcher. It is added to ${own ? "today's route" : `${esc(App.routeTeam.nameOf(owner))}'s route for today`}.</div>
        <label class="label" for="emSearch">Find customer</label>
        <div class="search-wrap">${icon("search", 18)}<input class="input" id="emSearch" placeholder="Account no., name, address, city or route" autocomplete="off"></div>
        <div class="cust-results" id="emResults"></div>
        <div class="divider"></div>
        <div class="field"><label class="label" for="emAcc">Account Number (optional)</label><input class="input" id="emAcc" autocomplete="off" placeholder="e.g. 84100204"></div>
        <div id="emFound"></div>
        <div class="field"><label class="label" for="emAddr">Address *</label><input class="input" id="emAddr" placeholder="Street address" autocomplete="off"></div>
        <div class="field"><label class="label" for="emCity">City</label><input class="input" id="emCity" value="${esc(S().loc?.city || planFor(owner)?.start?.city || "")}" autocomplete="off"></div>
        <div class="field"><label class="label" for="emName">Name (optional)</label><input class="input" id="emName" autocomplete="off"></div>
        <label class="toggle-row"><input type="checkbox" id="emNext"> Deliver next</label>
        <p class="hint" style="margin:-2px 0 14px">If not ticked, it goes where it adds the least driving.</p>
        ${own ? `<div class="divider"></div><span class="label">Your current location</span>
          <div class="loc-box ok" id="emLocBox">${icon("locate", 18)}<span>The phone's location is used. Without it, type where you are now.</span></div>
          <div class="field"><label class="label" for="emHere">Current location (if the phone's location is off)</label><input class="input" id="emHere" placeholder="e.g. Pembina Hwy & Bishop Grandin" autocomplete="off"></div>` : ""}`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="emSubmit">Add to route</button>`,
      data: { owner },
    });
  }
  App.onInput.emSearch = (t) => { const box = $("#emResults"); if (box) box.innerHTML = App.customers.resultsHtml(t.value, "emResults", "pickEmCust", "Type the address below."); };
  App.onInput.emAcc = (t) => {
    const box = $("#emFound");
    if (!box) return;
    const c = t.value.trim() ? findCustomer(t.value) : null;
    if (c) {
      $("#emAddr").value = c.accountAddress; $("#emCity").value = c.city;
      if (!$("#emName").value) $("#emName").value = c.accountName;
      box.innerHTML = `<p class="hint" style="margin:-6px 0 12px">${icon("check", 14)} Found in Customers: <b>${esc(c.accountName)}</b>, ${esc(c.accountAddress)}</p>`;
    } else box.innerHTML = t.value.trim().length >= 6 ? `<p class="hint" style="margin:-6px 0 12px">Not in Customers. Type the address below.</p>` : "";
  };
  function pickEmCust(i) {
    const c = App.customers.hit("emResults", i);
    if (!c) return;
    $("#emAcc").value = c.accountNumber; $("#emAddr").value = c.accountAddress; $("#emCity").value = c.city; $("#emName").value = c.accountName;
    $("#emSearch").value = c.accountName;
    $("#emResults").innerHTML = "";
    $("#emFound").innerHTML = `<p class="hint" style="margin:-6px 0 12px">${icon("check", 14)} Selected: <b>${esc(c.accountName)}</b>, ${esc([c.accountAddress, c.city].filter(Boolean).join(", "))}</p>`;
  }
  // The phone's position, at most 10 seconds; null when location is off or unavailable.
  const phonePosition = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve({ name: "Your location", lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { timeout: 10000, maximumAge: 60000 });
  });

  async function emSubmit() {
    const { owner } = S().sheet.data;
    const own = owner === "me";
    const acc = $("#emAcc").value.trim(), addr = $("#emAddr").value.trim(), city = $("#emCity").value.trim(), name = $("#emName").value.trim();
    const next = $("#emNext").checked;
    const here = own ? ($("#emHere")?.value || "").trim() : "";
    if (!addr) return App.sheetErr("Enter the address.");
    App.sheetBusy(true);
    const c = acc ? findCustomer(acc) : null;
    const fail = (msg) => { App.sheetBusy(false); App.sheetErr(msg); };
    let pos = null, stopPos = null, online = navigator.onLine !== false;
    if (own) {
      pos = here ? null : await phonePosition();
      if (!pos && here) {
        if (!online) return fail("Without a connection, use the phone's location.");
        try { pos = await geocodeText(here); } catch (error) { return fail(reason(error)); }
        if (!pos) return fail(`“${here}” was not found. Check it, or turn on the phone's location.`);
        pos.name = here;
      }
      if (!pos) return fail("Turn on location, or enter your current location.");
    }
    // The stop's position: the customer's, or the address looked up.
    if (c && P().sameAddress(c.accountAddress, addr)) {
      if (c.lat == null && online) { try { await locateCustomers([c]); } catch {} }
      const fresh = findCustomer(acc);
      if (fresh?.lat != null) stopPos = { lat: fresh.lat, lng: fresh.lng };
    }
    if (!stopPos && online) {
      try { stopPos = await geocodeText([P().stripUnit(addr), city, "Canada"].filter(Boolean).join(", ")); } catch (error) { return fail(reason(error)); }
      if (!stopPos) return fail(`“${addr}” was not found on the map. Check the address and city.`);
    }
    const data = { acc: c ? c.accountNumber : acc, name: name || (c ? c.accountName : "Emergency delivery"), addr, city: city || c?.city || "", lat: stopPos?.lat ?? null, lng: stopPos?.lng ?? null };
    App.sheetBusy(false);
    App.closeSheet(false);
    if (own) return emergencyOwn(data, next, pos, online);
    return App.routeTeam.emergencyOther(owner, data, next);
  }

  async function emergencyOwn(data, next, pos, online) {
    const r = R(), day = today();
    let created = false;
    if (!r.plan) {
      const start = r.defaults?.start || pos, end = r.defaults?.end || start;
      r.plan = newPlan(S().session.userId, mondayOf(day), start, end);
      created = true;
    }
    const plan = r.plan;
    if (!plan.dates.includes(day)) created = true;
    ensureDate(plan, day);
    const s = mkStop(data, { src: "emergency", next, date: day, seq: 999 });
    plan.stops.push(s);
    r.day = day;
    if (online && data.lat != null) {
      await ensureCosts([pos, plan.start, plan.end, ...dayStops(plan, day)]); // estimates when the service is busy
      reorderToday(plan, day, pos);
      const n = dayStops(plan, day).indexOf(s) + 1;
      return commit([plan], { title: "Emergency stop added", detail: `${s.name} is stop ${n} of today's route${next ? " (deliver next)" : ""}. ${created ? "A route for today was created." : "The rest of today's stops were re-planned from your location."}` });
    }
    // No connection: at the end of today's stops for now, ordered when the connection is back.
    s.waitReplan = true;
    renumber(plan, day);
    persist();
    App.outbox.add("route.save", { saves: [{ plan: planRow(plan), stops: plan.stops.map(stopRow), base_version: plan.version || null, notice: null }] });
    App.render();
    App.showResult(false, "Saved on this phone", "No internet connection.", "The stop was added at the end of today's route. The order is re-planned automatically when the connection is back.");
  }
  // Back online: stops added without a connection get their place.
  async function replanWaiting() {
    const plan = R().plan, day = today();
    if (!plan || !plan.stops.some((s) => s.waitReplan && s.status === "pending") || navigator.onLine === false) return;
    for (const s of plan.stops.filter((x) => x.waitReplan && x.lat == null)) {
      try { const p = await geocodeText([P().stripUnit(s.addr), s.city, "Canada"].filter(Boolean).join(", ")); if (p) Object.assign(s, { lat: p.lat, lng: p.lng }); } catch { return; }
    }
    await ensureCosts([plan.start, plan.end, ...dayStops(plan, day)]);
    reorderToday(plan, day, curPos(plan, day));
    plan.stops.forEach((s) => { s.waitReplan = false; });
    await commit([plan]);
    App.snackbar("Today's route was re-planned with the emergency stop.");
  }
  window.addEventListener("online", () => { if (App.S && App.canRecord()) setTimeout(replanWaiting, 1500); });

  /* ---------------- Off-Duty (3.6, decisions 9, 19, 35) ---------------- */
  function carryTargets(plan, day) {
    const later = plan.dates.filter((d) => d > day);
    if (later.length) return later;
    const n = nextWorkday(day);
    return n ? [n] : [];
  }
  function offDutyLine() {
    const plan = R().plan, day = today();
    const list = plan ? dayStops(plan, day) : [];
    if (!list.length) return "";
    const un = list.filter((s) => s.status === "pending");
    if (!un.length) return `<li><span class="ck ok">${icon("check", 14)}</span>All of today's route stops delivered</li>`;
    const where = isFriday(day) ? "Deleted at Off-Duty (the week is over)" : `Moved to ${carryTargets(plan, day).map(dayLabel).join(", ")} and re-planned`;
    return `<li><span class="ck warn">${icon("alert", 14)}</span><span>${un.length} route stop${un.length > 1 ? "s" : ""} not delivered<div class="small muted">${where}</div></span></li>`;
  }
  // Today's undelivered stops: on to the next chosen days (or the next workday), or deleted on Friday.
  async function offDuty() {
    const plan = R().plan, day = today();
    const un = plan ? pendingOn(plan, day) : [];
    if (!un.length) return "";
    const targets = carryTargets(plan, day);
    if (isFriday(day) || !targets.length) {
      plan.stops.filter((s) => s.status === "pending" && s.date >= day).forEach((s) => { s.status = "removed"; });
      await commit([plan]);
      return `${un.length} undelivered route stop${un.length > 1 ? "s were" : " was"} deleted (the week is over).`;
    }
    un.forEach((s) => { s.carried = true; s.next = false; });
    const moving = plan.stops.filter((s) => s.status === "pending" && s.date >= day);
    await ensureCosts([plan.start, plan.end, ...moving]);
    await planDates(plan, targets, moving);
    await commit([plan]);
    return `${un.length} undelivered route stop${un.length > 1 ? "s were" : " was"} moved to ${targets.map(dayLabel).join(", ")} and re-planned.`;
  }

  /* ---------------- customer positions (decision 15) ---------------- */
  // On the phone, at the customer: the phone's position becomes the customer's, for every driver.
  function openFixPos(d) {
    const c = App.data.cachedCustomers().find((x) => x.id === d.id);
    if (!c) return;
    App.openSheet({
      title: `Position · ${esc(c.accountName)}`,
      body: `<div class="kmbox" style="margin-bottom:12px"><b>${esc([c.accountAddress, c.city].filter(Boolean).join(", "))}</b><div class="small muted">${c.lat == null ? "No position yet." : c.geoSource === "manual" ? "Position set by hand." : "Position found from the address."}</div></div>
        <p class="muted" style="margin:0 0 12px">Stand at the customer's fill box, then save. The position is used by every driver; the change is logged and supervisors can change it back.</p>
        <button class="btn btn-primary block" data-action="savePosHere" data-id="${esc(c.id)}">${icon("locate", 18)} Use my current location</button>
        <p class="hint">Picking the position on a street map comes with the map update.</p>`,
    });
  }
  async function savePosHere(d) {
    App.sheetBusy(true);
    const pos = await phonePosition();
    if (!pos) { App.sheetBusy(false); return App.sheetErr("The phone's location is off or not available."); }
    try {
      const { data } = await App.data.call(sb().rpc("tdg_customer_set_position", { p_customer_id: d.id, p_lat: pos.lat, p_lng: pos.lng }));
      const c = App.data.cachedCustomers().find((x) => x.id === d.id);
      if (c) App.data.putCustomer({ ...c, lat: data.lat, lng: data.lng, geoSource: "manual" }, S().loc?.prov || "");
      for (const p of [R().plan, R().next]) for (const s of p?.stops || []) if (s.status === "pending" && P().normAcc(s.acc) === P().normAcc(c?.accountNumber)) Object.assign(s, { lat: data.lat, lng: data.lng });
      persist();
    } catch (error) {
      App.sheetBusy(false);
      return App.sheetErr(`Not saved: ${reason(error)}`);
    }
    App.closeSheet(false);
    App.showResult(true, "Position saved", "Saved to Supabase.", "Every driver now uses this position. Your name and the time are logged.");
    App.render();
  }

  // Opening the Route tab reads the server again (a supervisor may have changed the route), at most twice a minute.
  let lastRefresh = 0;
  const tab = App.ACTIONS.tab;
  App.ACTIONS.tab = (d) => {
    if (d.screen === "route" && App.canRecord() && Date.now() - lastRefresh > 30000) { lastRefresh = Date.now(); refresh(); }
    tab(d);
  };

  App.SCREENS.route = renderRoute;
  Object.assign(App.ACTIONS, {
    routeTab: (d) => { R().tab = d.tab; R().editOrder = null; if (d.tab === "team") App.routeTeam.load(); App.render(); },
    routeDay: (d) => { if (d.owner === "me") R().day = d.date; else R().teamDay = d.date; R().editOrder = null; App.render(); },
    routeMode: (d) => { R().mode = d.mode; App.render(); },
    openRouteToday: () => { R().tab = "mine"; R().day = today(); R().mode = "list"; App.go("route"); },
    stopTap: openStop,
    navigate: (d) => { App.closeSheet(false); navigate(d); },
    startStop,
    moveDay: (d) => { App.closeSheet(false); openMoveDay(d); },
    doMoveDay,
    removeStop,
    deleteRoute: openDeleteRoute,
    deleteStops,
    replan,
    editOrder: toggleEditOrder,
    moveUp: (d) => moveOrder(d, -1),
    moveDown: (d) => moveOrder(d, 1),
    emergency: (d) => openEmergency(d.owner || "me"),
    pickEmCust: (d) => pickEmCust(Number(d.i)),
    emSubmit,
    dismissNotice: () => { const n = R().plan?.notice; if (n?.at) device.set(`routeNotice:${S().session.userId}`, n.at); App.render(); },
    fixPos: (d) => { App.closeSheet(false); openFixPos(d); },
    savePosHere,
  });

  App.route = {
    R, today, mondayOf, nextWorkday, isFriday, dayLabel, newPlan, mkStop, planRow, stopRow, fromRows, dayStops, pendingOn, activeStops,
    assign, renumber, ensureDate, dayColor, curPos, costTable, ensureCosts, locateCustomers, geocodeText, findCustomer, routeFn,
    load, refresh, persist, commit, uploaded, afterDelivery, untick, isPendingEmergency, todayCard, offDutyLine, offDuty, planDates,
    reorderToday, insertCheapest, routeMap, stopList, dayChips, routeSum, legs, fmtKm, fmtDur, srcChips, planFor, canEditOthers, reason, replanWaiting,
    noticeHtml,
  };
})();
