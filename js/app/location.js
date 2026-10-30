/* Where the driver is (REGION_PROPOSAL.md 3.1, 3.2, decisions 3, 4, 6, 7, 10): shown at the top left.
 * Phones check their location at sign-in and the first time the app opens each day; the city and
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
  const position = (fresh) => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This device has no location."));
    navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new Error(e.message || "Location not available.")), { enableHighAccuracy: false, timeout: 10000, maximumAge: fresh ? 0 : 5 * 60000 });
  });

  async function locateNow(fresh = false) {
    const pos = await position(fresh);
    const r = await window.supabaseClient.functions.invoke("tdg-locate", { body: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
    if (r.error) {
      let message = r.error.message;
      try { message = (await r.error.context.json()).error || message; } catch {}
      throw new Error(message);
    }
    device.set(`located:${S().session.userId}`, localDate());
    return fromAccount(r.data.location, "phone");
  }

  // At start-up: the account's last location first, then (phones, once a day) a fresh one.
  // Without a connection the last location seen on this phone is used.
  async function init() {
    let account = null, read = false;
    try { account = await readAccount(); read = true; } catch (error) { console.warn("Location on the account not read:", error.message); }
    let saved = null;
    try { saved = JSON.parse(device.get(`loc:${S().session.userId}`, "null")); } catch {}
    setLoc(read || !saved ? fromAccount(account, isPhone() ? "last" : "account") : { ...saved, src: isPhone() ? "last" : saved.src });
    if (isPhone() && device.get(`located:${S().session.userId}`) !== localDate()) {
      try { setLoc(await locateNow()); } catch (error) { console.warn("Phone location failed; using the last saved one:", error.message); }
    }
    if (S().loc.src === "none" && read) openProv(true);
  }

  function openProv(firstTime = false) {
    const l = S().loc || { src: "none" };
    const how = {
      phone: `From phone location${l.at ? ` at ${localTime(l.at)}` : ""}.`,
      last: "Phone location unavailable. Using the last saved location.",
      manual: "Chosen by you. Lasts until the next location check.",
      account: l.how === "manual" ? "Chosen on this account." : `Last phone location on this account${l.at ? `, ${localDay(l.at)} ${localTime(l.at)}` : ""}.`,
      none: "No location saved on this account yet.",
    }[l.src];
    App.openSheet({
      title: firstTime ? "Choose your province" : "Your location",
      tall: true,
      body: `<div class="loc-box ${l.src === "phone" ? "ok" : "warn"}" style="flex-direction:row"><span>${icon("pin", 18)}</span><div><b>${esc(label())}</b><div class="small muted">${esc(how)}</div></div></div>
        <p class="hint" style="margin-top:0">${isPhone() ? "Your location is checked when you sign in and the first time you open the app each day. " : "Computers use the location of your last phone sign-in. "}Only the city and province are saved, never your position.</p>
        ${isPhone() ? `<button class="btn btn-outline block" data-action="relocate">${icon("pin", 18)} Use phone location</button>` : ""}
        <p class="label" style="margin:16px 0 8px">Or choose a province</p>
        <div class="radio-list">${PROVINCES.map(([k, n]) => `<button class="${k === l.prov ? "on" : ""}" data-action="setProv" data-prov="${k}"><b style="width:30px">${k}</b><span class="grow">${n}</span></button>`).join("")}</div>`,
    });
  }

  async function relocate() {
    App.sheetBusy(true);
    try {
      setLoc(await locateNow(true));
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
