/* Where the driver is (REGION_PROPOSAL.md 3.1, 3.2, decisions 3, 4, 6, 7, 10): shown at the top left.
 * The app checks its location every time it is opened or comes back to the screen (owner, 2026-11-03);
 * a phone's browser at sign-in and the first time it opens each day. The city and
 * province (never coordinates) are saved on the account. Computers use the account's last
 * location; an account that has never been located chooses a province once. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { esc, icon, localDate, nowHHMM, device } = App;
  const localTime = (iso) => (iso ? nowHHMM(new Date(iso)) : "");
  const localDay = (iso) => (iso ? localDate(new Date(iso)) : "");
  const S = () => App.S;

  const PROVINCES = [["MB", "Manitoba"], ["SK", "Saskatchewan"], ["AB", "Alberta"], ["BC", "British Columbia"], ["ON", "Ontario"], ["QC", "Quebec"],
    ["NB", "New Brunswick"], ["NS", "Nova Scotia"], ["PE", "Prince Edward Island"], ["NL", "Newfoundland and Labrador"], ["YT", "Yukon"], ["NT", "Northwest Territories"], ["NU", "Nunavut"]];
  const provName = (p) => (PROVINCES.find(([k]) => k === p) || [p, p])[1];

  // "Phone" means the Android app or a phone's browser; computers never ask for location.
  const isPhone = () => App.inApp || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

  const fromAccount = (row, src) => ({
    city: row?.last_city || "", prov: row?.last_province || "", src: row?.last_province ? src : "none",
    at: row?.last_located_at || "", how: row?.last_location_source || "",
  });

  function label() {
    const l = S().loc;
    if (!l || l.src === "none") return "Choose province";
    const place = `${l.city ? l.city + ", " : ""}${l.prov}`;
    if (l.src === "manual") return `${provName(l.prov)} · chosen`;
    if (l.src === "last") return `${place} · last known`;
    if (l.src === "account") return l.how === "manual" ? `${provName(l.prov)} · chosen` : `${place} · from phone ${localDay(l.at)}`;
    return place;
  }

  function topbarHtml() {
    const l = S().loc;
    const warn = !l || l.src !== "phone";
    return `<button class="tb-loc ${warn ? "warn" : ""}" data-action="openProv" aria-label="Location: ${esc(label())}. Tap to change.">${icon("pin", 14)}${esc(label())} ▾</button>`;
  }

  // Every change of location goes through here: kept on this phone for offline starts, and a new
  // province downloads that province's customers and plants (3.3).
  function setLoc(next) {
    const before = S().loc?.prov;
    S().loc = next;
    if (next.src !== "none") device.set(`loc:${S().session.userId}`, JSON.stringify(next));
    App.renderChrome();
    if (next.prov !== before) App.syncRegion();
  }

  async function readAccount() {
    const { data } = await App.data.call(window.supabaseClient.from("tdg_profiles")
      .select("last_city, last_province, last_located_at, last_location_source").eq("id", S().session.userId).maybeSingle());
    return data;
  }

  // Phone position, at most 10 seconds (3.1 step 1). fresh: not a position remembered from before.
  // The error says what the driver can do about it (shown in the location sheet).
  const GEO_ERRORS = {
    1: () => (App.inApp ? "Location is not allowed for this app. Allow it in the phone's Settings → Apps → Linde TDG Log → Permissions → Location."
      : "Location is blocked for this site in the browser."),
    2: () => "The phone could not find its position. Check that Location is on.",
    3: () => "The phone did not find its position within 10 seconds.",
  };
  const position = (fresh) => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This device has no location."));
    navigator.geolocation.getCurrentPosition(resolve, (e) => reject(Object.assign(new Error(GEO_ERRORS[e.code]?.() || e.message || "Location not available."), { geo: e.code })),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: fresh ? 0 : 5 * 60000 });
  });

  const km = (a, b) => {
    const R = Math.PI / 180, dLat = (b.lat - a.lat) * R, dLng = (b.lng - a.lng) * R;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  // City and province from tdg-locate. down: the service did not answer (not "outside Canada", not
  // a sign-in problem), so the nearest customer can stand in.
  async function lookup(lat, lng) {
    const r = await window.supabaseClient.functions.invoke("tdg-locate", { body: { lat, lng } });
    if (!r.error) return { ...fromAccount(r.data.location, "phone"), near: !!r.data.near };
    let message = r.error.message, status = r.error.context?.status || 0;
    try { message = (await r.error.context.json()).error || message; } catch {}
    throw Object.assign(new Error(message), { down: ![401, 403, 422].includes(status) });
  }
  // The map service not answering (2026-11-24 on): the city and province of the nearest customer on
  // this phone with a position, within 25 km, saved like a phone location.
  function nearestCustomer(lat, lng) {
    let best = null;
    for (const c of App.data.cachedCustomers?.() || []) {
      if (c.lat == null || c.lng == null || !c.city || !PROVINCES.some(([k]) => k === c.province)) continue;
      const d = km({ lat, lng }, c);
      if (d <= 25 && (!best || d < best.d)) best = { d, city: c.city, prov: c.province };
    }
    return best;
  }
  async function saveNear({ city, prov }) {
    try {
      const { data } = await App.data.call(window.supabaseClient.rpc("tdg_save_location", { p_city: city, p_province: prov, p_source: "phone" }));
      const row = Array.isArray(data) ? data[0] : data;
      if (row) return { ...fromAccount(row, "phone"), near: true };
    } catch (error) { console.warn("Location not saved on the account:", error.message); }
    return { city, prov, src: "phone", at: new Date().toISOString(), how: "phone", near: true };
  }

  // The last lookup in this session, in memory only (positions are never saved, decision 10): the
  // app checks the phone's position at every open, and only asks for the city again after moving
  // 2 km or after 30 minutes.
  let lastFix = null;
  async function locateNow(fresh = false, reuse = false) {
    const pos = await position(fresh);
    const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (reuse && lastFix && lastFix.user === S().session.userId && Date.now() - lastFix.t < 30 * 60000 && km(lastFix, here) < 2) return lastFix.loc;
    let loc;
    try { loc = await lookup(here.lat, here.lng); } catch (error) {
      const near = error.down && nearestCustomer(here.lat, here.lng);
      if (!near) throw error;
      console.warn("City not looked up; using the nearest customer's:", error.message);
      loc = await saveNear(near);
    }
    lastFix = { ...here, t: Date.now(), user: S().session.userId, loc };
    device.set(`located:${S().session.userId}`, localDate());
    return loc;
  }

  let locating = false;
  async function refresh() {
    if (locating) return;
    locating = true;
    try {
      const loc = await locateNow(App.inApp, true);
      S().locError = "";
      setLoc(loc);
    } catch (error) {
      console.warn("Phone location failed; using the last saved one:", error.message);
      S().locError = error.message;
      if (S().loc?.src === "phone") setLoc({ ...S().loc, src: "last" });
      else App.renderChrome();
    }
    locating = false;
  }
  document.addEventListener("visibilitychange", () => { if (App.inApp && document.visibilityState === "visible" && App.S?.loc) refresh(); });

  // At start-up: the account's last location first, then a fresh one (the app always, a phone's
  // browser once a day). Without a connection the last location seen on this phone is used.
  async function init() {
    let account = null, read = false;
    try { account = await readAccount(); read = true; } catch (error) { console.warn("Location on the account not read:", error.message); }
    let saved = null;
    try { saved = JSON.parse(device.get(`loc:${S().session.userId}`, "null")); } catch {}
    setLoc(read || !saved ? fromAccount(account, isPhone() ? "last" : "account") : { ...saved, src: isPhone() ? "last" : saved.src });
    if (App.inApp || (isPhone() && device.get(`located:${S().session.userId}`) !== localDate())) await refresh();
    if (S().loc.src === "none" && read) openProv(true);
  }

  function openProv(firstTime = false) {
    const l = S().loc || { src: "none" };
    const why = S().locError ? ` ${S().locError}` : "";
    const how = {
      phone: `From phone location${l.at ? ` at ${localTime(l.at)}` : ""}.${l.near ? " The map service is not answering, so the city is the nearest customer's." : ""}`,
      last: `Phone location unavailable.${why} Using the last saved location.`,
      manual: "Chosen by you. Lasts until the next location check.",
      account: l.how === "manual" ? "Chosen on this account." : `Last phone location on this account${l.at ? `, ${localDay(l.at)} ${localTime(l.at)}` : ""}.`,
      none: "No location saved on this account yet.",
    }[l.src];
    App.openSheet({
      title: firstTime ? "Choose your province" : "Your location",
      tall: true,
      body: `<div class="loc-box ${l.src === "phone" ? "ok" : "warn"}" style="flex-direction:row"><span>${icon("pin", 18)}</span><div><b>${esc(label())}</b><div class="small muted">${esc(how)}</div></div></div>
        <p class="hint" style="margin-top:0">${App.inApp ? "Your location is checked every time you open the app. " : isPhone() ? "Your location is checked when you sign in and the first time you open the app each day. " : "Computers use the location of your last phone sign-in. "}Only the city and province are saved, never your position.</p>
        ${isPhone() ? `<button class="btn btn-outline block" data-action="relocate">${icon("pin", 18)} Use phone location</button>` : ""}
        <p class="label" style="margin:16px 0 8px">Or choose a province</p>
        <div class="radio-list">${PROVINCES.map(([k, n]) => `<button class="${k === l.prov ? "on" : ""}" data-action="setProv" data-prov="${k}"><b style="width:30px">${k}</b><span class="grow">${n}</span></button>`).join("")}</div>`,
    });
  }

  async function relocate() {
    App.sheetBusy(true);
    try {
      setLoc(await locateNow(true));
      S().locError = "";
      App.closeSheet(false);
      App.snackbar(`Located: ${S().loc.city ? S().loc.city + ", " : ""}${S().loc.prov}`);
    } catch (error) {
      App.sheetErr(navigator.onLine ? error.message : "No internet connection.");
    }
    App.sheetBusy(false);
  }

  // A chosen province lasts until the next location check (decision 7).
  async function setProv(prov) {
    try {
      await App.data.call(window.supabaseClient.rpc("tdg_save_location", { p_city: "", p_province: prov, p_source: "manual" }));
    } catch (error) {
      return App.sheetErr(navigator.onLine ? error.message : "No internet connection.");
    }
    setLoc({ city: "", prov, src: "manual", at: new Date().toISOString(), how: "manual" });
    App.closeSheet(false);
    App.snackbar(`Province set to ${provName(prov)}.`);
  }

  Object.assign(App.ACTIONS, {
    openProv: () => openProv(false),
    relocate,
    setProv: (d) => setProv(d.prov),
  });

  App.location = { init, topbarHtml, label, provName, PROVINCES, isPhone };
})();
