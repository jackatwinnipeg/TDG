/* Linde TDG Log — shared helpers for the new mobile UI (website and Android app).
 * Plain scripts sharing window.TDG_APP, like js/tdg_core.js, so they run the same in
 * every browser and in the Android WebView without a build step. */
(() => {
  "use strict";
  const App = (window.TDG_APP = window.TDG_APP || {});

  App.VERSION = "1.0.5";
  // Where the app looks for a newer APK (android.json beside it, ANDROID_APP_PROPOSAL.md 3.7).
  // Set in js/supabaseConfig.js (test builds for the local server write their own); empty: no check.
  App.UPDATE_URL = window.TDG_UPDATE_URL || "";
  // Running inside the Android app (Capacitor) rather than a browser.
  App.inApp = !!window.Capacitor?.isNativePlatform?.();
  App.KG_PER_LB = 0.45359237;
  // The one product the truck carries, chosen at Check-in (PRODUCTS_PROPOSAL.md; shift column product).
  App.PRODUCTS = [
    { code: "UN1073", name: "OXYGEN", text: "UN1073, OXYGEN, REFRIGERATED LIQUID, 2.2(5.1)" },
    { code: "UN1977", name: "NITROGEN", text: "UN1977, NITROGEN, REFRIGERATED LIQUID, 2.2" },
    { code: "UN1951", name: "ARGON", text: "UN1951, ARGON, REFRIGERATED LIQUID, 2.2" },
    { code: "UN2187", name: "CARBON DIOXIDE", text: "UN2187, CARBON DIOXIDE, REFRIGERATED LIQUID, 2.2" },
  ];
  App.productName = (code) => { const p = App.PRODUCTS.find((x) => x.code === code); return p ? `${p.code} ${p.name}` : ""; };

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
  const pad2 = (n) => String(n).padStart(2, "0");
  // Local calendar date and time, same as the current site (tdgLocalDate / nowHHMM).
  const localDate = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const nowHHMM = (d = new Date()) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const nowIso = () => new Date().toISOString();
  const parseLocalDate = (s) => {
    const [y, m, d] = String(s || "").split("-").map(Number);
    return y && m && d ? new Date(y, m - 1, d) : null;
  };
  const addDays = (s, n) => { const d = parseLocalDate(s); d.setDate(d.getDate() + n); return localDate(d); };
  const weekday = (s) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parseLocalDate(s).getDay()];
  const lbsToKg = (lbs) => lbs * App.KG_PER_LB;
  const kgToLbs = (kg) => kg / App.KG_PER_LB;
  const normVeh = (v) => window.TDG_VOLUME.normalizeVehicleNo(v);
  const initials = (name) => String(name || "").split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("").slice(0, 2);
  const uuid = () => {
    try { return crypto.randomUUID(); } catch { return "cr_" + Date.now() + "_" + Math.random().toString(16).slice(2); }
  };
  // Number fields are text fields with digits only (no mouse-wheel changes); NaN when empty.
  const numVal = (sel) => {
    const el = $(sel);
    const raw = el ? String(el.value).trim() : "";
    const n = Number(raw);
    return raw !== "" && Number.isFinite(n) ? n : NaN;
  };

  // Per-account storage (js/tdg_core.js scopes keys to the signed-in user).
  const store = {
    get(key, fallback = null) {
      try {
        const raw = window.TDG_STORAGE.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    // Throws when the phone cannot save (e.g. storage full) so callers never lose data silently.
    set(key, value) { window.TDG_STORAGE.setItem(key, JSON.stringify(value)); },
    remove(key) { window.TDG_STORAGE.removeItem(key); },
  };
  // Device settings that do not belong to an account (theme).
  const device = {
    get(key, fallback = null) { try { return localStorage.getItem("tdg_app:" + key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem("tdg_app:" + key, value); } catch {} },
  };

  const ICONS = {
    today: '<path d="M9 3h6v3H9z"/><path d="M8 4.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1h-2"/><path d="m9 14 2 2 4-4"/>',
    deliveries: '<path d="M3 7.5 12 3l9 4.5-9 4.5z"/><path d="M3 7.5v9L12 21l9-4.5v-9"/><path d="M12 12v9"/>',
    route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16"/>',
    history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 7v6"/><path d="M12 16.8v.2"/><circle cx="12" cy="12" r="9"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    file: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    truck: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    chev: '<path d="m9 5 7 7-7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
    update: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    flame: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-9-1.5 2-2 3.5-2 5-1-1-1.5-2-1.5-3C8 10 6 12.5 6 15a6 6 0 0 0 6 6z"/>',
    customers: '<path d="M4 9h16l-1.5-5h-13z"/><path d="M5 9v11h14V9"/><path d="M10 20v-6h4v6"/>',
    pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    nav: '<path d="M3 11 21 3l-8 18-2-8z"/>',
    upload: '<path d="M12 20V9"/><path d="m7 14 5-5 5 5"/><path d="M5 4h14"/>',
    siren: '<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 18h14v3H5z"/><path d="M12 2v2M4.2 5.2l1.4 1.4M19.8 5.2l-1.4 1.4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    up: '<path d="m6 14 6-6 6 6"/>',
    down: '<path d="m6 10 6 6 6-6"/>',
    calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
    locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
    zoom: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M11 8.5v5M8.5 11h5"/>',
  };
  const icon = (name, size = 22) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  Object.assign(App, {
    $, esc, fmtN, localDate, nowHHMM, nowIso, parseLocalDate, addDays, weekday, lbsToKg, kgToLbs,
    normVeh, initials, uuid, numVal, store, device, icon,
  });
})();
