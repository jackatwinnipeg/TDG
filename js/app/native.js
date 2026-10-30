/* Inside the Android app (ANDROID_APP_PROPOSAL.md 3.2): Save PDF, Email PDF and (Reload Log
 * only) Print go to the app's TdgNative plugin (android/.../TdgNativePlugin.java), with HTML
 * snapshots of the website's own print pages, so the PDFs keep the website's layout
 * (decision 19). Navigate opens Google Maps outside the app. On the website none of this shows. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const plugin = () => window.Capacitor?.Plugins?.TdgNative || null;
  const available = () => App.inApp && !!plugin();

  // Test builds of the app for the local server (dev/build-android.sh wifi/local) write what they
  // do to the server (GET /dev-log there), to find where something stops on a phone. Never in
  // the real app or on the website.
  const devOn = () => !!window.TDG_LOCAL_DEV && App.inApp && !!window.SUPABASE_URL;
  let devQueue = [], devTimer = null;
  function devLog(...parts) {
    if (!devOn()) return;
    devQueue.push(parts.map((p) => (typeof p === "string" ? p : p instanceof Error ? `${p.name}: ${p.message}` : JSON.stringify(p))).join(" "));
    devTimer ||= setTimeout(() => {
      const body = devQueue.join("\n");
      devQueue = [];
      devTimer = null;
      fetch(`${window.SUPABASE_URL}/dev-log`, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body }).catch(() => {});
    }, 300);
  }
  if (devOn()) {
    window.addEventListener("error", (e) => devLog("error:", e.message, `${e.filename || ""}:${e.lineno || ""}`));
    window.addEventListener("unhandledrejection", (e) => devLog("unhandled:", e.reason?.message || String(e.reason)));
    plugin()?.addListener?.("devLog", (e) => devLog("native:", e?.msg || ""));
    devLog("app started", navigator.userAgent);
  }
  App.devLog = devLog;

  // Every call answers within a time limit, so the app never waits without a word.
  async function call(method, args, seconds = 120) {
    const p = plugin();
    if (!p) throw new Error("This needs the Android app.");
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`The phone did not answer within ${seconds} seconds.`)), seconds * 1000); });
    try { return await Promise.race([p[method](args), late]); } finally { clearTimeout(timer); }
  }

  // The page as it is on screen, without its scripts and templates (the data is already in it). keep(root) can
  // take parts out, e.g. all sheets but one.
  function snapshot(doc, keep = null) {
    const root = doc.documentElement.cloneNode(true);
    // Form fields keep what the page put in them (the ticked CO2 box, the Fill Log's customer
    // fields): HTML text carries only attributes, so the current state is written into them.
    const fields = "input, textarea, select";
    const live = [...doc.documentElement.querySelectorAll(fields)];
    root.querySelectorAll(fields).forEach((el, i) => {
      const src = live[i];
      if (!src) return;
      if (el.tagName === "TEXTAREA") el.textContent = src.value;
      else if (el.tagName === "SELECT") [...el.options].forEach((o, j) => o.toggleAttribute("selected", !!src.options[j]?.selected));
      else if (el.type === "checkbox" || el.type === "radio") el.toggleAttribute("checked", src.checked);
      else el.setAttribute("value", src.value);
    });
    root.querySelectorAll("script, template").forEach((s) => s.remove());
    const style = doc.createElement("style");
    style.textContent = ".toolbar, .no-print, .actions, #status, #batchStatus { display: none !important; } body { background: #fff !important; }";
    root.querySelector("head")?.appendChild(style);
    if (keep) keep(root);
    return `<!doctype html>\n${root.outerHTML}`;
  }

  // A print page loaded out of sight; ready(doc) resolves once its data is in, files(doc) makes
  // the PDFs' HTML and names.
  async function renderPage({ src, prepare, ready, files }) {
    prepare();
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1100px;height:800px;border:0;visibility:hidden";
    document.body.appendChild(frame);
    try {
      await new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = () => reject(new Error("The report did not load.")); frame.src = src; });
      await ready(frame.contentDocument);
      return files(frame.contentDocument);
    } finally {
      frame.remove();
    }
  }

  // files: [{ html, fileName, page }]
  async function savePdfs(files) {
    if (!files.length) return App.showResult(false, "Nothing to save", "There is no report for this selection.", "");
    App.snackbar(files.length === 1 ? "Making the PDF…" : `Making ${files.length} PDFs…`);
    try {
      const r = await call("savePdfs", { files });
      const names = r?.files || files.map((f) => f.fileName);
      App.showResult(true, names.length === 1 ? "PDF saved" : `${names.length} PDFs saved`, "Saved in Download/TDG on this phone.", names.join(" · "));
    } catch (error) {
      App.showResult(false, "PDF not saved", error.message || String(error), "Nothing was saved. Try again.");
    }
  }

  // One email with every PDF attached; to: recipients filled in (Reload Log only, decision 10).
  async function emailPdfs(files, subject, to = []) {
    if (!files.length) return App.showResult(false, "Nothing to send", "There is no report for this selection.", "");
    App.snackbar(files.length === 1 ? "Making the PDF…" : `Making ${files.length} PDFs…`);
    try {
      await call("emailPdfs", { files, subject, to });
    } catch (error) {
      App.showResult(false, "Email not opened", error.message || String(error), "Save the PDF instead, and attach it from Download/TDG.");
    }
  }

  async function printHtml(html, jobName, page) {
    try { await call("printHtml", { html, jobName, page }); } catch (error) { App.showResult(false, "Print not opened", error.message || String(error), ""); }
  }

  // Pictures of a delivery list (ROUTE_PROPOSAL.md 3.2.1): chosen in Android's photo picker →
  // [{ id, name }]; then read on the phone by Google ML Kit, { id } or { image: base64 } →
  // { width, height, words: [{ text, box: [left, top, right, bottom], conf, angle }], image }.
  const pickPictures = async () => (await call("pickPictures", {}, 900)).pictures || [];
  const readText = (args) => call("readText", args, 60);

  // Outside the app: Google Maps for Navigate; on the website a new tab.
  function openExternal(url) {
    if (available()) return call("openExternal", { url }).catch((error) => App.showResult(false, "Not opened", error.message, ""));
    window.open(url, "_blank", "noopener");
  }

  // App updates (ANDROID_APP_PROPOSAL.md 3.7): when the app starts and when it comes back to the
  // screen (at most once an hour) it reads android.json at App.UPDATE_URL, which the build writes
  // beside the APK. A newer version is offered once a day; the driver picks Update or Later, and
  // More → Version offers it any time. Android keeps the app's data when it installs the update.
  let update = null, lastCheck = 0;
  const mb = (bytes) => (bytes ? ` (${Math.round(bytes / 1048576)} MB)` : "");
  async function appVersion() {
    if (!available()) return null;
    App.installed ||= await call("appVersion", {}, 10).catch(() => null);
    return App.installed;
  }
  async function checkUpdate({ asked = false } = {}) {
    if (!available() || !App.UPDATE_URL) return asked && App.snackbar("Updates are not set up for this app.");
    lastCheck = Date.now();
    let latest;
    try {
      const r = await call("appVersion", { url: App.UPDATE_URL }, 30);
      App.installed = { versionCode: r.versionCode, versionName: r.versionName };
      latest = JSON.parse(r.latest);
    } catch (error) {
      console.warn("Update check failed:", error.message);
      return asked && App.snackbar("Could not check for updates. Check the connection.");
    }
    update = latest.versionCode > App.installed.versionCode ? { ...latest, url: new URL(latest.apk, App.UPDATE_URL).href } : null;
    App.render();
    if (!update) return asked && App.snackbar("This is the latest version.");
    const today = `${update.versionCode}|${App.localDate()}`;
    if (asked || (App.device.get("updateAsked") !== today && !App.S.sheet && !App.S.dialog)) {
      App.device.set("updateAsked", today);
      offerUpdate();
    }
  }
  function offerUpdate() {
    App.showConfirm({
      title: "Update available",
      msg: `Version ${update.versionName}${mb(update.size)} is ready. Your records stay on this phone.`,
      okText: "Update", cancelText: "Later", onOk: installUpdate,
    });
  }
  async function installUpdate() {
    if (navigator.onLine === false) return App.showResult(false, "No connection", "Connect to the internet to download the update.", "");
    if (App.outbox.count()) await App.outbox.flush().catch(() => {}); // the update keeps them anyway
    App.snackbar("Downloading the update…");
    try {
      await call("downloadUpdate", { url: update.url, versionCode: update.versionCode, size: update.size || 0 }, 1200);
    } catch (error) {
      App.showResult(false, "Update not installed", error.message || String(error), "Your records are safe. Try again later, on Wi-Fi if you can.");
    }
  }
  if (available()) {
    plugin().addListener?.("updateProgress", (e) => App.snackbar(`Downloading the update… ${e.percent}%`));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && App.S && Date.now() - lastCheck > 3600000) checkUpdate(); });
  }
  App.ACTIONS.appUpdate = () => (update ? offerUpdate() : checkUpdate({ asked: true }));

  App.native = { available, snapshot, renderPage, savePdfs, emailPdfs, printHtml, openExternal, pickPictures, readText, appVersion, checkUpdate, update: () => update };
})();
