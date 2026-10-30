/* Start-up: sign-in check, the day saved on this phone first (works offline), then the
 * server: check-in, week cycle, TDG opening balance, today's records, and the current
 * province's customers and reload plants. */
(() => {
  "use strict";
  const App = window.TDG_APP;

  // Customers and reload plants of the current province, one download at a time, so a quick
  // change of province never leaves the previous province's list on the phone.
  let regionQueue = Promise.resolve();
  App.syncRegion = ({ full = false } = {}) => {
    regionQueue = regionQueue.then(async () => {
      const prov = App.S.loc?.prov || "";
      const results = await Promise.allSettled([App.data.syncCustomers(prov, { full }), App.data.syncPlants()]);
      for (const r of results) if (r.status === "rejected") console.warn("Download failed; using the copy on this phone:", r.reason?.message);
      App.render();
    });
    return regionQueue;
  };
  App.regionSettled = () => regionQueue;

  async function boot() {
    App.applyTheme();
    const session = await window.TDG_AUTH.requireAuthAsync();
    if (!session) return; // sent to the sign-in page

    App.S = {
      session,
      role: session.role || "driver",
      screen: "today",
      theme: App.device.get("theme", "system"),
      day: null,
      records: [],
      opening: null,
      sheet: null,
      dialog: null,
      dQuery: "",
      dFilter: "all",
    };
    App.day.loadLocal(App.localDate());
    App.outbox.onChange(() => App.renderChrome());

    document.getElementById("boot").hidden = true;
    App.render();

    // In the app: the installed version for More, then a newer one offered if there is one.
    if (App.inApp) App.native.appVersion().then(() => App.native.checkUpdate());
    // The location decides which customers and reload plants are downloaded (App.syncRegion).
    App.location.init().catch((error) => console.warn("Location failed:", error.message));
    // Viewer and Manager do not record, so they have no day of their own to load.
    if (!App.canRecord()) { await App.viewing.people().catch(() => {}); App.render(); return; }
    try {
      await App.day.refreshFromServer();
    } catch (error) {
      console.warn("Server refresh failed; showing the day saved on this phone:", error.message);
    }
    await App.outbox.flush();
    await App.route.refresh();
    App.route.replanWaiting();
    App.render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    boot().catch((error) => {
      console.error(error);
      const el = document.getElementById("boot");
      el.hidden = false;
      el.textContent = "The app could not start: " + error.message;
    });
  });
})();
