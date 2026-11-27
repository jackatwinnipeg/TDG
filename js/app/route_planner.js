/* Optional road/turn planner. The area planner remains usable until hosting is enabled;
 * the screen explicitly identifies that mode. Validated paths are cached by their exact stops. */
(() => {
  "use strict";
  const App = window.TDG_APP, KEY = "tdg_road_plans_v2";
  let active = null;
  const pointsKey = (points) => points.map((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? `${p.lat},${p.lng}` : "?").join(";");
  const cached = (points) => (App.store.get(KEY, {}) || {})[pointsKey(points)] || null;
  function remember(start, end, stops, result) {
    const kept = App.store.get(KEY, {}) || {};
    result.groups.forEach((group, i) => {
      const points = [start, ...group.map((j) => stops[j]), end].filter(Boolean);
      kept[pointsKey(points)] = { ...result.routes[i], version: result.version, network: result.network };
    });
    const keys = Object.keys(kept);
    keys.slice(0, Math.max(0, keys.length - 30)).forEach((k) => delete kept[k]);
    try { App.store.set(KEY, kept); } catch { /* No cache is safer than an incomplete route. */ }
  }
  function validate(result, count, days) {
    if (!result || !Array.isArray(result.groups) || result.groups.length !== days || !Array.isArray(result.routes) || result.routes.length !== days)
      throw new Error("The planning service returned an incomplete route.");
    const seen = new Set();
    if (result.groups.some((g) => !Array.isArray(g))) throw new Error("The planning service returned invalid days.");
    for (const group of result.groups) for (const i of group) {
      if (!Number.isInteger(i) || i < 0 || i >= count || seen.has(i)) throw new Error("The planning service repeated or lost an order.");
      seen.add(i);
    }
    if (seen.size !== count) throw new Error("The planning service did not include every order.");
    result.routes.forEach((route, i) => {
      if (!route || !Number.isFinite(route.s) || route.s < 0 || !Number.isFinite(route.m) || route.m < 0 ||
          !Array.isArray(route.legs) || route.legs.length !== result.groups[i].length + 1 ||
          route.legs.some((leg) => !Number.isFinite(leg.s) || leg.s < 0 || !Number.isFinite(leg.m) || leg.m < 0) ||
          !Array.isArray(route.line) || route.line.some((p) => !Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) ||
          [route.left, route.uturns, route.unknownEntrances].some((n) => !Number.isInteger(n) || n < 0))
        throw new Error("The planning service returned invalid road data.");
    });
    return result;
  }
  async function plan(start, end, stops, days, curbOf) {
    active?.abort();
    const controller = new AbortController(), owner = App.S.session?.userId;
    active = controller;
    const at = (p) => p ? { lat: p.lat, lng: p.lng } : null;
    const body = { start: at(start), end: at(end), days, stops: stops.map((s, i) => ({ id: String(i), ...at(s), curb: curbOf(s) })) };
    let timer;
    try {
      timer = setTimeout(() => controller.abort(), 75000);
      const r = await window.supabaseClient.functions.invoke("tdg-route-plan", { body, signal: controller.signal });
      if (controller.signal.aborted) throw new Error("Planning cancelled or timed out. Your saved route is unchanged.");
      if (App.S.session?.userId !== owner) throw new Error("The signed-in account changed during planning.");
      if (r.error) {
        let data;
        try { data = await r.error.context.json(); } catch {}
        if (data?.code === "PLANNER_NOT_CONFIGURED") return null;
        throw new Error(data?.error || r.error.message || "Planning service unavailable.");
      }
      validate(r.data, stops.length, days);
      remember(start, end, stops, r.data);
      return r.data.groups.map((g) => g.map((i) => stops[i]));
    } finally { clearTimeout(timer); if (active === controller) active = null; }
  }
  function note(start, list, end) {
    const data = cached([start, ...list, end].filter(Boolean));
    if (!data) return "Road turns not checked (turn planning is not set up yet).";
    return `${Number(data.left) || 0} road left turns · ${Number(data.uturns) || 0} U-turns · ${Number(data.unknownEntrances) || 0} unconfirmed entrances. Google Maps may choose a different road.`;
  }
  App.routePlanner = { plan, cached, note, validate, cancel: () => active?.abort() };
})();
