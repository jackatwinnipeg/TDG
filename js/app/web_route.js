/* Website Route and Team (mockups/web-v1). Route: the week's days as cards, the picked day's stops beside
 * its map. Team (Supervisor and Admin, decisions 4 and 10): everyone's routes, opened as in the app. The
 * stop rows, the map, uploads, re-planning and every edit are the app's own (js/app/route*.js). */
(() => {
  "use strict";
  const App = window.TDG_APP;
  if (!App.web) return;
  const { esc, fmtN, icon, weekday } = App;
  const W = App.web$;
  const RT = () => App.route;

  function mine() {
    const r = RT().R(), plan = r.plan, day = RT().today();
    const top = RT().noticeHtml(plan) + App.routeUpload.listCards();
    const upload = `<button class="btn btn-primary" data-action="startUpload">${icon("upload", 16)} Upload delivery list</button>`;
    if (!plan || !RT().activeStops(plan).length) {
      return `${W.title("Route", "No route this week", `<button class="btn btn-outline" data-action="emergency">${icon("siren", 16)} Emergency call</button>${upload}`)}
        ${top}
        <div class="w-empty w-big">Upload this week's delivery list. The Z02 (local) and Z01 (long distance) customers are planned into daily routes.<br>Route is optional: without it, check in and use Add delivery as usual.</div>`;
    }
    if (!r.day || !plan.dates.includes(r.day)) r.day = plan.dates.includes(day) ? day : plan.dates.find((x) => x >= day) || plan.dates.at(-1);
    const d = r.day, editing = r.editOrder === "me";
    const stops = plan.dates.reduce((a, x) => a + RT().dayStops(plan, x).length, 0);
    const kmAll = plan.dates.reduce((a, x) => a + RT().legs(plan, x).m, 0);
    const cards = plan.dates.map((x) => {
      const list = RT().dayStops(plan, x), L = RT().legs(plan, x), done = list.filter((s) => s.status === "done").length;
      const st = !list.length ? "No stops" : done === list.length ? "Done" : done ? `${done} of ${list.length} done` : "Planned";
      return `<button class="w-count w-day" type="button" data-action="routeDay" data-date="${x}" data-owner="me" aria-pressed="${x === d}" style="--dc:${RT().dayColor(plan, x)}">
        <span>${weekday(x)} ${x.slice(5)}${x === day ? " · today" : ""}</span><b class="num">${list.length} stop${list.length === 1 ? "" : "s"}</b>
        <small class="num">${RT().fmtKm(L.m)} km · ${RT().fmtDur(L.s)}</small><small>${st}</small></button>`;
    }).join("");
    const L = RT().legs(plan, d), list = RT().dayStops(plan, d), done = list.filter((s) => s.status === "done").length;
    const right = `<button class="btn btn-outline" data-action="emergency">${icon("siren", 16)} Emergency call</button>
      <button class="btn btn-outline" data-action="replan" data-owner="me">${icon("update", 16)} Re-plan</button>
      ${d === day && RT().pendingOn(plan, d).length > 1 ? `<button class="btn ${editing ? "btn-primary" : "btn-outline"}" data-action="editOrder" data-owner="me">${editing ? "Save order" : "Change order"}</button>` : ""}
      ${upload}`;
    return `
      ${W.title("Route", `Week of ${plan.dates[0]} · ${fmtN(stops)} stops over ${plan.dates.length} day${plan.dates.length === 1 ? "" : "s"} · ${RT().fmtKm(kmAll)} km planned`, right)}
      ${top}
      <div class="w-counts w-days">${cards}</div>
      <div class="w-grid">
        ${W.panel("wStH", `${weekday(d)} ${d}`, `${done} of ${list.length} delivered`, `<div class="w-appbox">${RT().stopList(plan, d, "me")}</div><p class="w-note">Driving times only: the time at each customer is not counted.</p>`, { span: 5 })}
        ${W.panel("wMapH", "Map", `${RT().fmtKm(L.m)} km · ${RT().fmtDur(L.s)} driving`, `<div class="w-mapbox w-bigmap">${RT().routeMap(plan, [d], "me")}</div>`, { span: 7 })}
      </div>`;
  }

  function team() {
    return `${W.title("Team", `${weekday(RT().today())} ${RT().today()} · everyone's routes this week`, "")}
      <div class="w-panel"><div class="w-appbox">${App.routeTeam.renderTeam()}</div></div>`;
  }

  App.WEB_SCREENS.route = () => (RT().R().tab === "team" ? team() : mine());
})();
