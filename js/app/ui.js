/* App shell from mockups/mobile-ui-v2.html: top bar, banner, screens, action bar, tab bar,
 * bottom sheets, result dialogs (green/red, closed only with OK) and the snackbar. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { $, esc, icon, weekday } = App;

  App.ACTIONS = {};
  App.SCREENS = {};
  App.onChange = {};
  App.onInput = {};

  const ROLE_LABEL = { driver: "Driver", supervisor: "Supervisor", manager: "Manager", viewer: "Viewer", admin: "Admin" };
  App.ROLE_LABEL = ROLE_LABEL;
  App.canRecord = () => ["driver", "supervisor", "admin"].includes(App.S.role);
  // Customers (ROLES_PROPOSAL.md decision 5): everyone but Viewer adds; Supervisor, Manager and
  // Admin edit and delete customers and look after the reload plants (REGION_PROPOSAL.md decision 12).
  App.canAddCustomer = () => App.S.role !== "viewer";
  App.canEditCustomer = () => ["supervisor", "manager", "admin"].includes(App.S.role);

  function tabsFor() {
    if (App.canRecord()) return ["today", "deliveries", "route", "history", "more"];
    // Viewer and Manager have no Route (ROLES_PROPOSAL.md decisions 15-16).
    if (App.S.role === "manager") return ["today", "history", "customers", "more"];
    return ["today", "history", "more"];
  }
  App.tabsFor = tabsFor;

  const content = () => $("#content");
  const screenKey = () => App.S.screen;

  function render() {
    const S = App.S;
    if (!S) return;
    const box = content();
    const keepScroll = box.dataset.screen === screenKey();
    const top = box.scrollTop;
    // Keep what is being typed in the Today screen's fields across re-renders.
    const focused = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : null;
    renderTopbar();
    renderBanner();
    const screen = (App.web && App.WEB_SCREENS?.[S.screen]) || App.SCREENS[S.screen] || App.SCREENS.today;
    box.innerHTML = screen();
    box.dataset.screen = screenKey();
    if (App.web) box.classList.toggle("w-own", !!App.WEB_SCREENS?.[S.screen]);
    box.scrollTop = keepScroll ? top : 0;
    if (focused && keepScroll) $("#" + CSS.escape(focused))?.focus({ preventScroll: true });
    $("#actionbar").innerHTML = App.web ? App.actionbars?.[S.screen]?.() || "" : renderActionbar();
    renderTabbar();
    if (App.web) App.webAfter();
  }
  App.render = render;
  // Top bar and banner only (upload status), without redrawing what is being typed.
  App.renderChrome = () => { if (App.S) { renderTopbar(); renderBanner(); } };

  function syncState() {
    const pending = App.outbox.count();
    const error = App.outbox.lastError();
    if (!navigator.onLine) return { cls: "offline", label: pending ? `Offline · ${pending} waiting` : "Offline", pending };
    if (pending && error && !error.transient) return { cls: "offline", label: `${pending} not uploaded`, pending, error };
    if (pending) return { cls: "waiting", label: `${pending} waiting`, pending, error };
    return { cls: "", label: "Synced", pending: 0 };
  }

  function renderTopbar() {
    const S = App.S;
    const st = syncState();
    if (App.web) { $("#topbar").innerHTML = App.webTopbar(st); return; }
    $("#topbar").innerHTML = `
      <div>
        <div class="tb-title">Linde TDG Log</div>
        <div class="tb-sub">${weekday(S.day.date)} ${S.day.date} · ${esc(S.session.displayName || S.session.username)}</div>
        ${S.loc ? App.location.topbarHtml() : ""}
      </div>
      <button class="sync-pill ${st.cls}" data-action="syncNow" aria-label="Upload status: ${esc(st.label)}"><span class="dot"></span>${esc(st.label)}</button>`;
  }

  function renderBanner() {
    const b = $("#banner");
    const st = syncState();
    b.classList.remove("show", "bad");
    if (!navigator.onLine) {
      b.innerHTML = `${icon("cloud", 18)}<span>No connection. ${st.pending ? `${st.pending} item${st.pending > 1 ? "s are" : " is"} saved on this phone and will upload automatically.` : "New records will be saved on this phone."}</span>`;
      b.classList.add("show");
    } else if (st.error && !st.error.transient) {
      b.innerHTML = `${icon("alert", 18)}<span><b>Upload stopped:</b> ${esc(st.error.message)}</span><button class="btn btn-primary" data-action="syncNow">Retry</button>`;
      b.classList.add("show", "bad");
    } else if (st.pending) {
      b.innerHTML = `${icon("cloud", 18)}<span>${st.pending} item${st.pending > 1 ? "s" : ""} waiting to upload.</span><button class="btn btn-primary" data-action="syncNow">Upload now</button>`;
      b.classList.add("show");
    } else {
      b.innerHTML = "";
    }
  }

  function renderActionbar() {
    const S = App.S;
    // Shown before check-in too (as in the mockup); Add Delivery then asks to check in first.
    const extra = App.actionbars?.[S.screen];
    if (extra) return extra();
    if (S.screen === "today" && App.day.status() !== "out" && App.canRecord()) {
      return `<button class="btn btn-primary block lg" data-action="addDelivery">${icon("plus", 20)} Add Delivery</button>`;
    }
    return "";
  }

  // Screens under a tab: the tab that stays lit, and where the back key goes.
  const PARENT = { reloadLog: "history", upload: "route", readCheck: "route", planSetup: "route", planReview: "route", teamDriver: "route", nextWeek: "route", deliveryLists: "more" };
  const BACK = { ...PARENT, readCheck: "upload", planSetup: "upload", planReview: "planSetup" };

  // The Android back key (android/.../MainActivity.java): a dialog, then a sheet, then the screen
  // above; on a tab other than Today, Today. Returns false on Today, and the app goes to the background.
  App.handleBack = () => {
    const S = App.S;
    if (!S) return false;
    if (S.dialog) { closeDialog(false); return true; }
    if (S.sheet) { closeSheet(true); return true; }
    const up = S.screen === "day" ? S.dayView?.from || "history"
      : S.screen === "customers" && !tabsFor().includes("customers") ? "more" : BACK[S.screen];
    if (up) { go(up); return true; }
    if (S.screen !== "today") { go("today"); return true; }
    return false;
  };

  function renderTabbar() {
    if (App.web) return App.webNav();
    const LBL = { today: "Today", deliveries: "Deliveries", route: "Route", history: "History", customers: "Customers", more: "More" };
    const tabs = tabsFor();
    const screen = App.S.screen === "day" ? App.S.dayView?.from || "history" : PARENT[App.S.screen] || App.S.screen;
    const active = tabs.includes(screen) ? screen : "more";
    const bar = $("#tabbar");
    bar.style.gridTemplateColumns = `repeat(${tabs.length}, 1fr)`;
    bar.innerHTML = tabs.map((k) => `
      <button class="tab ${active === k ? "active" : ""}" data-action="tab" data-screen="${k}" ${active === k ? 'aria-current="page"' : ""}>
        <span class="tab-ic">${icon(k, 22)}</span>${LBL[k]}
      </button>`).join("");
  }

  function go(screen) {
    App.S.screen = screen;
    render();
  }
  App.go = go;

  /* ---------------- sheets & dialogs ---------------- */
  function openSheet({ title, body, footer = "", tall = false, onCancel = null, data = {} }) {
    const sheetEl = $("#sheet");
    App.S.sheet = { onCancel, data };
    sheetEl.className = "sheet" + (tall ? " tall" : "");
    sheetEl.innerHTML = `
      <div class="sheet-h"><h2 id="sheetTitle">${title}</h2><button class="icon-btn" data-action="sheetCancel" aria-label="Close">${icon("x", 18)}</button></div>
      <div class="sheet-b">${body}<p class="err" id="sheetErr"></p></div>
      ${footer ? `<div class="sheet-f">${footer}</div>` : ""}`;
    requestAnimationFrame(() => { if (!App.S.sheet) return; sheetEl.classList.add("show"); $("#scrim").classList.add("show"); });
  }
  function closeSheet(cancelled) {
    const S = App.S;
    if (!S.sheet) return;
    const cb = S.sheet.onCancel;
    S.sheet = null;
    $("#sheet").classList.remove("show");
    if (!S.dialog) $("#scrim").classList.remove("show");
    if (cancelled && cb) cb();
  }
  const sheetErr = (msg) => { const e = $("#sheetErr"); if (e) e.textContent = msg; };
  // While a sheet is saving, its buttons are disabled so a double tap cannot save twice.
  function sheetBusy(busy) {
    document.querySelectorAll("#sheet .sheet-f .btn").forEach((b) => { b.disabled = busy; });
  }

  function showResult(ok, title, msg, detail = "", onClose = null) {
    const wrap = $("#dlgWrap");
    App.S.dialog = { onClose };
    wrap.innerHTML = `
      <div class="dlg ${ok ? "ok" : "bad"}" role="alertdialog" aria-modal="true" aria-labelledby="dlgT" aria-describedby="dlgM">
        <div class="dlg-band">
          <div class="dlg-ic">${icon(ok ? "check" : "alert", 30)}</div>
          <h2 id="dlgT">${esc(title)}</h2>
          <p id="dlgM">${esc(msg)}</p>
        </div>
        <div class="dlg-body">${detail ? esc(detail) : ""}</div>
        <div class="dlg-f"><button class="btn ${ok ? "btn-ok" : "btn-bad"} lg" data-action="dlgOk">OK</button></div>
      </div>`;
    wrap.classList.add("show");
    $(".dlg-f .btn", wrap).focus();
  }
  function showConfirm({ title, msg, okText, danger = false, onOk, cancelText = "Cancel", onCancel = null }) {
    const wrap = $("#dlgWrap");
    App.S.dialog = { onOk, onCancel };
    wrap.innerHTML = `
      <div class="dlg neutral" role="alertdialog" aria-modal="true" aria-labelledby="dlgT">
        <div class="dlg-band"><div class="dlg-ic">${icon("alert", 28)}</div><h2 id="dlgT">${esc(title)}</h2></div>
        <div class="dlg-body">${esc(msg)}</div>
        <div class="dlg-f"><button class="btn btn-outline" data-action="dlgCancel">${esc(cancelText)}</button><button class="btn ${danger ? "btn-bad" : "btn-primary"}" data-action="dlgConfirm">${esc(okText)}</button></div>
      </div>`;
    wrap.classList.add("show");
  }
  function closeDialog(confirmed) {
    const S = App.S;
    const d = S.dialog;
    S.dialog = null;
    const wrap = $("#dlgWrap");
    wrap.classList.remove("show");
    wrap.innerHTML = "";
    if (!S.sheet) $("#scrim").classList.remove("show");
    if (d && confirmed && d.onOk) d.onOk();
    if (d && !confirmed && d.onCancel) d.onCancel();
    if (d && d.onClose) d.onClose();
  }
  let snackTimer;
  function snackbar(msg) {
    const el = $("#snackbar");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function setTheme(v) {
    App.S.theme = v;
    App.device.set("theme", v);
    applyTheme();
    render();
  }
  function applyTheme() {
    const v = App.S?.theme || App.device.get("theme", "system");
    if (v === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", v);
  }

  Object.assign(App, { openSheet, closeSheet, sheetErr, sheetBusy, showResult, showConfirm, closeDialog, snackbar, setTheme, applyTheme });

  Object.assign(App.ACTIONS, {
    tab: (d) => go(d.screen),
    theme: (d) => setTheme(d.value),
    sheetCancel: () => closeSheet(true),
    scrim: () => { if (!App.S.dialog) closeSheet(true); },
    dlgOk: () => closeDialog(false),
    dlgCancel: () => closeDialog(false),
    dlgConfirm: () => closeDialog(true),
  });

  /* ---------------- events ---------------- */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.tagName === "INPUT" || el.disabled || !App.S) return;
    const fn = App.ACTIONS[el.dataset.action];
    if (fn) fn(el.dataset, el, e);
  });
  document.addEventListener("change", (e) => {
    const fn = App.onChange[e.target.id];
    if (fn && App.S) fn(e.target);
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    // Number fields are text fields so the mouse wheel and arrow keys cannot change them; keep digits only.
    if (t.dataset && t.dataset.num) {
      const v = t.value.replace(t.dataset.num === "dec" ? /[^0-9.]/g : /[^0-9]/g, "");
      if (v !== t.value) t.value = v;
    }
    const fn = App.onInput[t.id];
    if (fn && App.S) fn(t);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "vehicleInput") e.target.blur();
    if (e.key === "Escape" && App.S?.sheet && !App.S.dialog) closeSheet(true);
  });
  window.addEventListener("online", () => App.S && render());
  window.addEventListener("offline", () => App.S && render());
})();
