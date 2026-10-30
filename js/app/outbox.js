/* Upload queue: every write is saved on the phone first, then sent in order.
 * With no connection the items wait and upload automatically when the connection is back.
 * A refusal from the database stops the queue at that item so nothing is sent out of order,
 * except an edit of a delivery changed somewhere else, or an offline check-in that meets a saved
 * one: these are dropped (see send). */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { store, uuid, nowIso } = App;
  const KEY = "tdg_app_outbox_v1";

  const listeners = new Set();
  let running = null;
  let sending = null; // id of the item on its way to the server right now
  let lastError = null; // { message, transient, at }

  const read = () => {
    const rows = store.get(KEY, []);
    return Array.isArray(rows) ? rows : [];
  };
  const write = (rows) => store.set(KEY, rows);
  const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  const outbox = {
    items: read,
    count: () => read().length,
    lastError: () => lastError,
    onChange(fn) { listeners.add(fn); },

    // Saved on the phone before anything is sent; throws if the phone cannot save it.
    add(kind, payload, meta = {}) {
      const item = { id: uuid(), kind, payload, meta, createdAt: nowIso(), tries: 0 };
      write([...read(), item]);
      notify();
      return item;
    },
    update(id, change) {
      write(read().map((it) => (it.id === id ? change(it) : it)));
      notify();
    },
    remove(id) {
      write(read().filter((it) => it.id !== id));
      notify();
    },
    // Never the item being sent: a change written into it would be dropped once it is accepted.
    find: (pred) => read().find((it) => it.id !== sending && pred(it)) || null,
    sending: () => sending,

    // Send waiting items in order. Resolves to { ok, sent, error }.
    flush() {
      if (!running) running = send().finally(() => { running = null; notify(); });
      return running;
    },
  };

  // dropped: an item refused for good and taken off (error.drop: the server's copy stands, see
  // record.update and shift.checkin), so the queue goes on; App.day.dropped tells the driver.
  async function send() {
    let sent = 0, dropped = null;
    for (;;) {
      const item = read()[0];
      if (!item) { lastError = null; return { ok: true, sent, dropped }; }
      const run = App.data.writes[item.kind];
      let result;
      try {
        if (!run) throw Object.assign(new Error(`Unknown upload item: ${item.kind}`), { transient: false });
        sending = item.id;
        result = await run(item.payload);
      } catch (error) {
        if (error.drop) {
          write(read().filter((it) => it.id !== item.id));
          dropped = error;
          try { App.day.dropped(item, error); } catch (e) { console.error("After a dropped upload:", e); }
          notify();
          continue;
        }
        outbox.update(item.id, (it) => ({ ...it, tries: it.tries + 1, lastError: error.message }));
        lastError = { message: error.message, transient: error.transient !== false, at: nowIso(), kind: item.kind };
        return { ok: false, sent, error, dropped };
      } finally {
        sending = null;
      }
      write(read().filter((it) => it.id !== item.id));
      sent++;
      try { App.day.uploaded(item, result); App.route?.uploaded(item, result); } catch (e) { console.error("After upload:", e); }
      notify();
    }
  }

  // Retry when the connection comes back, when the app returns to the screen, and every minute.
  window.addEventListener("online", () => { if (outbox.count()) outbox.flush(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && outbox.count()) outbox.flush(); });
  setInterval(() => { if (outbox.count() && navigator.onLine !== false) outbox.flush(); }, 60000);

  App.outbox = outbox;
})();
