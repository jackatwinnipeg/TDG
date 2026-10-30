/* The website look (mockups/web-v1, approved by the owner 2026-10-29; ANDROID_APP_PROPOSAL.md decision 6):
 * a Linde-blue frame, sidebar and top bar, around a white work sheet. Website only: the app build leaves
 * the web files out, and a page opens in this look only when it is marked data-ui="web" (build_release.py
 * marks the website's pages) or the address has ?ui=web (kept on this device; ?ui=app goes back).
 * Records, uploads, sheets and dialogs are the app's own; the website redraws the frame and the screens
 * in App.WEB_SCREENS, and shows the app's screen inside the sheet for any it has not redrawn. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { $, esc, icon, weekday } = App;

  const asked = new URLSearchParams(location.search).get("ui");
  if (asked === "web" || asked === "app") App.device.set("ui", asked);
  const pick = App.device.get("ui", "");
  App.web = !App.inApp && (pick ? pick === "web" : document.documentElement.dataset.ui === "web");
  if (!App.web) return;
  document.documentElement.classList.add("web");

  App.WEB_SCREENS = {};
  const after = {};
  // What a screen draws (charts, maps) once its HTML is on the page; a screen may have several.
  App.webDraw = (screen, fn) => { (after[screen] ||= []).push(fn); };
  App.webAfter = () => {
    const fns = after[App.S.screen] || [];
    if (fns.length) (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => fns.forEach((fn) => { try { fn(); } catch (e) { console.warn("Drawing failed:", e.message); } }));
  };

  // The real Linde logo with its white letters lifted off the blue, so it sits on the flat frame.
  const LOGO_FILTER = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="wLogo" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.8 0.8 0.8 0 -1.35"/></filter></svg>';
  App.webLogo = (cls = "w-logo") => `<svg class="${cls}" viewBox="60 385 1080 350" role="img" aria-label="Linde"><image href="./assets/linde-logo.jpg" width="1200" height="1200" filter="url(#wLogo)"/></svg>`;

  const ICONS = {
    team: '<circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="7" r="2.5"/><circle cx="12" cy="17" r="2.5"/><path d="M9.5 7h5M8.3 9.2l2.4 5.6M15.7 9.2l-2.4 5.6"/>',
    users: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    lists: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M12 17.5v-6M9.5 14 12 11.5 14.5 14"/>',
    filllog: '<path d="M7 3.5h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2"/><path d="M10.5 18.5h3"/>',
  };
  const wIcon = (k, size = 18) => ICONS[k]
    ? `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`
    : icon(k, size);
  App.wIcon = wIcon;

  /* ---------------- navigation: what each role has (ROLES_PROPOSAL.md 3, 4.5) ---------------- */
  const LABEL = { today: "Today", route: "Route", team: "Team", history: "History", customers: "Customers", deliveryLists: "Delivery lists", users: "Users", filllog: "Fill Log settings", more: "More" };
  function nav() {
    const r = App.S.role, rec = App.canRecord();
    const list = ["today"];
    if (rec) list.push("route");
    if (App.route?.canEditOthers?.()) list.push("team");
    list.push("history");
    if (App.canAddCustomer()) list.push("customers");
    if (App.canSendLists?.()) list.push("deliveryLists");
    if (r === "admin") list.push("users", "filllog");
    return list;
  }
  App.webNavList = nav;
  // Screens opened from another one light up their parent in the sidebar.
  const PARENT = { reloadLog: "history", day: "history", upload: "route", readCheck: "route", planSetup: "route", planReview: "route", nextWeek: "route", teamDriver: "team" };
  function current() {
    const S = App.S;
    if (S.screen === "route" && App.route.R().tab === "team") return "team";
    if (S.screen === "day") return S.dayView?.from === "deliveries" ? "today" : S.dayView?.from || "history";
    return PARENT[S.screen] || S.screen;
  }
  const navLink = (k, cur, cls) => `<button class="${cls}" type="button" data-action="webGo" data-screen="${k}" ${k === cur ? 'aria-current="page"' : ""}>${wIcon(k === "deliveryLists" ? "lists" : k === "customers" ? "customers" : k, cls ? 18 : 22)}<span>${LABEL[k]}</span></button>`;

  function scopeHtml() {
    const S = App.S;
    const where = S.loc ? App.location.label().split(" · ")[0] : "Location";
    const truck = App.canRecord() && S.day?.vehicle ? `Truck ${esc(S.day.vehicle)}` : "";
    return `<button class="w-scope" type="button" data-action="openProv" aria-label="${truck ? `${truck}, ` : ""}${esc(where)}. Change the location.">${icon(truck ? "truck" : "pin", 18)}<span>${truck || esc(where)}<small>${truck ? esc(where) : "Change location"}</small></span>${icon("down", 16)}</button>`;
  }

  App.webNav = () => {
    const S = App.S, cur = current(), items = nav();
    if (S.pdfZoom == null) S.pdfZoom = window.innerWidth > 860 ? "100" : "fit";
    let side = $("#wside");
    if (!side) {
      side = document.createElement("aside");
      side.id = "wside";
      side.className = "w-side";
      side.setAttribute("aria-label", "Main");
      $("#app").prepend(side);
      document.body.insertAdjacentHTML("afterbegin", LOGO_FILTER);
    }
    const name = S.session.displayName || S.session.username;
    side.innerHTML = `
      <div class="w-brand">${App.webLogo()}<b>TDG Log</b></div>
      ${scopeHtml()}
      <nav class="w-nav">${items.map((k) => `${k === "users" ? '<span class="w-group">Admin</span>' : ""}${navLink(k, cur, "w-item")}`).join("")}</nav>
      <div class="w-bottom">
        <button class="w-user" type="button" data-action="webGo" data-screen="more" ${cur === "more" ? 'aria-current="page"' : ""}><span class="w-avatar">${esc(App.initials(name))}</span><span class="w-who">${esc(name)}<small>${App.ROLE_LABEL[S.role] || S.role}${App.canRecord() && S.session.driverNumber ? ` ${esc(S.session.driverNumber)}` : ""}</small></span>${icon("chev", 16)}</button>
      </div>`;
    // On a phone the sidebar folds into the bottom tabs: the pages that work on a phone.
    const tabs = items.filter((k) => !["deliveryLists", "users", "filllog"].includes(k));
    const bar = $("#tabbar");
    bar.style.gridTemplateColumns = `repeat(${tabs.length + 1}, 1fr)`;
    bar.innerHTML = tabs.map((k) => navLink(k, cur, "")).join("") + navLink("more", cur, "");
  };

  App.webTopbar = (st) => {
    const S = App.S;
    const title = current() === "more" ? "Account" : LABEL[current()] || "TDG Log";
    return `
      <span class="w-date num">${weekday(S.day.date)} ${esc(S.day.date)}</span>
      <span class="w-ptitle">${App.webLogo("w-logo sm")}<span>${esc(title)}</span></span>
      <span class="w-search">${icon("search", 16)}<input id="wSearch" type="search" placeholder="Search customers or account numbers" aria-label="Search customers or account numbers" autocomplete="off"><kbd>/</kbd></span>
      <span class="w-right"><button class="w-sync ${st.cls}" type="button" data-action="syncNow" aria-label="Upload status: ${esc(st.label)}"><i></i><span>${esc(st.label)}</span></button></span>`;
  };

  App.ACTIONS.webGo = (d) => {
    const S = App.S;
    if (d.screen === "route" || d.screen === "team") {
      const r = App.route.R();
      r.tab = d.screen === "team" ? "team" : "mine";
      r.editOrder = null;
      if (d.screen === "team") App.routeTeam.load();
      S.screen = "route";
      return App.render();
    }
    App.go(d.screen);
  };

  // The search in the top bar finds customers on the Customers page; Enter opens a focused table row.
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("tr[data-action][tabindex]")) { e.preventDefault(); e.target.click(); return; }
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) {
      const q = $("#wSearch");
      if (q && q.offsetParent) { e.preventDefault(); q.focus(); }
    }
    if (e.key === "Enter" && e.target.id === "wSearch" && App.canAddCustomer()) {
      App.customers.kit.cs().q = e.target.value;
      if (App.S.wcust) App.S.wcust.page = 0;
      App.go("customers");
    }
  });

  /* ---------------- report previews (TDG Report, Fill Log, Reload Log) ---------------- */
  // The drawer as wide as the report's own page, and 100% by default on a computer (owner, 2026-10-29).
  App.webPreviewFit = (layoutWidth) => {
    const box = $("#pvPages"), frame = $("#pvFrame"), doc = frame?.contentDocument, sheet = $("#sheet");
    if (!box || !doc?.body) return;
    frame.style.width = layoutWidth + "px";
    const pages = [...doc.querySelectorAll(".sheet")];
    const widths = (pages.length ? pages : [...doc.body.children]).map((e) => e.getBoundingClientRect().width).filter((w) => w > 0);
    const pageW = Math.min(layoutWidth, Math.ceil(Math.max(...widths, 320)) + 24); // the page with a little grey around it
    frame.style.width = pageW + "px";
    const height = doc.documentElement.scrollHeight;
    // sheet padding 2 × 24, the grey frame 2 × 8, room for a scrollbar
    sheet.style.setProperty("--pv-w", `${pageW + 48 + 16 + 18}px`);
    const scale = App.S.pdfZoom === "100" ? 1 : Math.min(1, (box.clientWidth - 16) / pageW);
    frame.style.height = height + "px";
    frame.style.transform = `scale(${scale})`;
    $("#pvPage").style.width = pageW * scale + "px";
    $("#pvPage").style.height = height * scale + "px";
  };
  window.addEventListener("resize", () => { if ($("#pvFrame")?.contentDocument?.body) App.webPreviewFit(1100); });

  /* ---------------- small building blocks the web screens share ---------------- */
  App.web$ = {
    title: (h1, sub, right = "") => `<div class="w-title"><div><h1>${h1}</h1>${sub ? `<p class="w-sub num">${sub}</p>` : ""}</div>${right ? `<div class="w-actions">${right}</div>` : ""}</div>`,
    panel: (id, h2, meta, body, { span = 12, tools = "", cls = "" } = {}) =>
      `<section class="w-panel ${cls}" style="grid-column: span ${span}" aria-labelledby="${id}">
        <header><div class="w-h"><h2 id="${id}">${h2}</h2>${meta ? `<span class="w-meta num">${meta}</span>` : ""}</div>${tools}</header>${body}</section>`,
    pill: (text, kind = "") => `<span class="w-pill ${kind}">${esc(text)}</span>`,
  };
})();
