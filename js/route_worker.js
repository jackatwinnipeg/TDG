/* Route planning off the screen's thread (owner's choice 2026-10-28): js/app/route.js posts the
 * stops, their curbs, the driving times it already has and a time limit; this runs
 * TDG_ROUTE_PLAN.splitDays and posts back each day's stops as their places in the posted list. */
importScripts("route_plan.js?v=2");

self.onmessage = ({ data: { id, start, end, stops, days, curbs, known, limit } }) => {
  try {
    const P = self.TDG_ROUTE_PLAN, at = new Map(stops.map((s, i) => [s, i]));
    const groups = P.splitDays(P.costTable(known), start, end, stops, days, { curbOf: (s) => curbs[at.get(s)], until: Date.now() + limit });
    self.postMessage({ id, groups: groups.map((g) => g.map((s) => at.get(s))) });
  } catch (error) {
    self.postMessage({ id, error: error.message || "Planning failed" });
  }
};
