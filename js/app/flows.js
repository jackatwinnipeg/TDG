/* What the driver does on the Today and Deliveries screens: check-in, check-out, Off-Duty,
 * Reload, TDG Adjustment, Add/Edit/Delete Delivery. Every write is saved on the phone first
 * and then uploaded; the result is shown in a green or red dialog that stays until OK. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { $, esc, fmtN, icon, numVal, nowHHMM, nowIso, kgToLbs, uuid, normVeh } = App;
  const S = () => App.S;
  const KEPT = "Your data is kept on this phone and will upload automatically when the connection is back.";
  const ADJUSTMENT_REASONS = ["Maintenance Venting", "DOT Using"];

  function reasonText(error) {
    if (!navigator.onLine) return "No internet connection.";
    if (error?.transient) return "The server could not be reached.";
    return error?.message || "The upload failed.";
  }

  // Upload what was just queued and report it like the mockup: green when saved, red when kept.
  async function upload(okTitle, detail, failTitle, onClose = null) {
    App.render();
    const r = await App.outbox.flush();
    App.render();
    if (r.dropped) return; // App.day.dropped has told the driver which change was not saved
    if (r.ok) return App.showResult(true, okTitle, "Saved to Supabase.", detail, onClose);
    const kept = r.error?.transient === false
      ? "It is kept on this phone. The upload is stopped until this is fixed; tap Retry after fixing it."
      : KEPT;
    App.showResult(false, failTitle, reasonText(r.error), kept, onClose);
  }

  function saveFailed(error) {
    App.showResult(false, "Not saved", `This phone could not save it: ${error.message}`, "Free some space on the phone and try again.");
  }

  // Deliveries, Reload and Adjustment need a verified opening balance, as on the current site.
  function needBalance() {
    if (App.day.balance()) return true;
    const o = S().openings[S().day.vehicle];
    App.showResult(false, "TDG balance not loaded", o?.loading ? "The TDG balance is still loading." : o?.error || "The TDG balance is not loaded.",
      "A verified starting balance for this vehicle is needed before saving. Check the vehicle number or try again when connected.");
    return false;
  }

  /* ---------------- check-in / check-out ---------------- */
  const shiftRow = (vehicle, km, time, at, product) => ({
    owner_id: S().session.userId, work_date: S().day.date, driver_number: S().session.driverNumber || S().session.username || "",
    driver_name: S().session.displayName || S().session.username || "", vehicle_no: vehicle, start_km: km,
    check_in_at: at, check_in_time: time, check_out_at: null, check_out_time: null, updated_at: at, product,
  });

  // PRODUCTS_PROPOSAL.md decisions 1-2: exactly one product, nothing ticked beforehand.
  const productPicker = (current = "") => `
    <div class="field" role="radiogroup" aria-labelledby="productH"><div class="label" id="productH">Product loaded today *</div>
      ${App.PRODUCTS.map((p) => `<label class="toggle-row"><input type="radio" name="product" value="${p.code}" ${p.code === current ? "checked" : ""}> ${esc(p.text)}</label>`).join("")}</div>`;
  const pickedProduct = () => $("input[name=product]:checked")?.value || "";
  const NO_PRODUCT = "Choose the product loaded today.";

  function openCheckIn() {
    const d = S().day;
    if (!d.vehicle) return App.snackbar("Enter the vehicle number first.");
    App.openSheet({
      title: "Check-in",
      body: `
        <div class="note-box">Starts your work day and the shift on <b>${esc(d.vehicle)}</b>.</div>
        <div class="field"><label class="label" for="ciKm">Start KM for ${esc(d.vehicle)} *</label>
          <input class="input num" id="ciKm" type="text" inputmode="numeric" data-num="int" autocomplete="off" placeholder="e.g. 48210"></div>
        ${productPicker()}
        <p class="hint">Week Cycle ${esc(d.weekCycle)}. To use a different vehicle, change Vehicle No on the Today screen first.</p>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-ok" data-action="confirmCheckIn">Check-in</button>`,
    });
  }

  async function confirmCheckIn() {
    const d = S().day;
    const km = numVal("#ciKm");
    if (!(km >= 0)) return App.sheetErr("Enter the Start KM.");
    const product = pickedProduct();
    if (!product) return App.sheetErr(NO_PRODUCT);
    App.sheetBusy(true);
    let rows = [], seen = true;
    try {
      rows = await App.data.fetchShifts(S().session.userId, d.date);
    } catch (error) {
      if (!error.transient) { App.sheetBusy(false); return App.sheetErr(error.message); }
      seen = false;
    }
    // Another vehicle still checked in today (e.g. on another phone): switch instead (section 3.5).
    const open = rows.find((r) => !r.check_out_time && normVeh(r.vehicle_no) !== d.vehicle);
    if (open) {
      App.sheetBusy(false);
      return App.sheetErr(`${open.vehicle_no} is still checked in today. Use that vehicle number first; changing Vehicle No then switches vehicles.`);
    }
    App.closeSheet(false);
    const existing = rows.find((r) => normVeh(r.vehicle_no) === d.vehicle);
    if (existing) return askReplace(existing, `${nowHHMM()} · ${d.vehicle} · Start KM ${fmtN(km)}`, () => doCheckIn(km, product));
    // unseen: today's check-ins could not be read, so the upload must not replace one unasked.
    return doCheckIn(km, product, !seen);
  }

  // A check-in already saved today for this vehicle: replace it, or keep it and go on from it.
  function askReplace(existing, mine, replace) {
    App.showConfirm({
      title: "Already checked in today",
      msg: `Saved check-in: ${existing.check_in_time} · ${existing.vehicle_no} · Start KM ${fmtN(existing.start_km)}${existing.check_out_time ? ` · Checked out ${existing.check_out_time}` : ""}. Replace it with ${mine}?`,
      okText: "Replace", cancelText: "Keep saved",
      onOk: replace,
      onCancel: async () => {
        try { await App.day.syncSegments(); } catch (error) { return App.showResult(false, "Check-in not restored", reasonText(error)); }
        App.day.saveLocal(); App.render(); App.snackbar(`Check-in ${existing.check_in_time} restored.`);
      },
    });
  }
  // A check-in saved without a connection reached a server that has one for this vehicle today
  // (RESUME_WORK_PROPOSAL.md decision 10): the driver chooses; it is never replaced unasked.
  const checkInConflict = (row, existing) => askReplace(existing, `${row.check_in_time} · ${row.vehicle_no} · Start KM ${fmtN(row.start_km)}`, async () => {
    try { App.outbox.add("shift.checkin", { row }); } catch (error) { return saveFailed(error); }
    await upload("Checked in", `${row.vehicle_no} at ${row.check_in_time} · Start KM ${fmtN(row.start_km)}`, "Check-in not uploaded");
  });

  async function doCheckIn(km, product, unseen = false) {
    const d = S().day, time = nowHHMM(), at = nowIso();
    try {
      App.outbox.add("shift.checkin", { row: shiftRow(d.vehicle, km, time, at, product), unseen });
      d.segments = d.segments.filter((g) => g.vehicle !== d.vehicle);
      d.segments.push(App.day.newSegment(d.vehicle, { checkInTime: time, checkInAt: at, startKm: km, product }));
      App.day.saveLocal();
    } catch (error) { return saveFailed(error); }
    await upload("Checked in", `${d.vehicle} at ${time} · Start KM ${fmtN(km)}`, "Check-in not uploaded");
  }

  // Decision 4: the product can be changed (or chosen, for a check-in from before this version) until Check-out.
  function openProduct() {
    const g = App.day.segment();
    App.openSheet({
      title: `Product on ${esc(g.vehicle)}`,
      body: productPicker(g.product),
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="confirmProduct">Save</button>`,
    });
  }

  async function confirmProduct() {
    const s = S(), g = App.day.segment(), product = pickedProduct();
    if (!product) return App.sheetErr(NO_PRODUCT);
    App.closeSheet(false);
    if (product === g.product) return App.render();
    try {
      App.outbox.add("shift.product", { ownerId: s.session.userId, workDate: s.day.date, vehicleNo: g.vehicle, product });
      g.product = product;
      App.day.saveLocal();
    } catch (error) { return saveFailed(error); }
    await upload("Product saved", `${g.vehicle}: ${App.productName(product)}`, "Product not uploaded");
  }

  function openCheckOut() {
    const g = App.day.segment();
    App.openSheet({
      title: "Check-out",
      body: `
        <div class="note-box">Ends your work day. Shift ${esc(App.day.dayStart())}–${nowHHMM()}.</div>
        <div class="field"><label class="label" for="coKm">End KM for ${esc(g.vehicle)} *</label>
          <input class="input num" id="coKm" type="text" inputmode="numeric" data-num="int" autocomplete="off" placeholder="Start was ${fmtN(App.day.stretchStartKm(g))}"></div>
        <p class="hint num" id="coTotal">Total KM: —</p>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="confirmCheckOut">Check-out</button>`,
    });
  }
  App.onInput.coKm = (t) => {
    const start = Number(App.day.stretchStartKm(App.day.segment())), km = Number(t.value);
    $("#coTotal").textContent = t.value !== "" && km >= start ? `Total KM: ${fmtN(km - start)}` : "Total KM: —";
  };

  async function confirmCheckOut() {
    const s = S(), g = App.day.segment();
    const km = numVal("#coKm");
    const from = Number(App.day.stretchStartKm(g));
    if (!(km >= from)) return App.sheetErr(`End KM must be at least ${fmtN(from)}.`);
    const time = nowHHMM(), at = nowIso();
    try {
      App.outbox.add("shift.checkout", { ownerId: s.session.userId, workDate: s.day.date, vehicleNo: g.vehicle, checkOutAt: at, checkOutTime: time });
      Object.assign(g, { checkOutTime: time, checkOutAt: at, endKm: km, reportUploaded: false });
      App.day.saveLocal();
    } catch (error) { App.closeSheet(false); return saveFailed(error); }
    App.closeSheet(false);
    await upload("Checked out", `Shift ${App.day.dayStart()}–${time} · ${g.vehicle} ${fmtN(km - from)} km`, "Check-out not uploaded");
  }

  /* ---------------- vehicle switch (MULTI_VEHICLE_PROPOSAL.md 3.3, 3.5) ---------------- */
  // Uploads everything waiting and pulls today's records, so a vehicle's report is complete.
  async function syncBeforeReport() {
    if (!navigator.onLine) throw Object.assign(new Error("No internet connection."), { transient: true });
    const flushed = await App.outbox.flush();
    App.render();
    const p = App.outbox.count();
    if (!flushed.ok || p) throw Object.assign(new Error(`${p} item${p > 1 ? "s are" : " is"} not uploaded yet. ${reasonText(flushed.error)}`), { transient: flushed.error?.transient });
    App.day.mergeRecords(await App.data.pullRecords(S().session.userId, S().day.date));
  }

  async function uploadReport(vehicle, reason) {
    await App.data.writes["daily.insert"]({ row: App.day.reportRow(vehicle, reason) });
    App.day.segment(vehicle).reportUploaded = true;
    App.day.saveLocal();
  }

  function openSwitch(from, to) {
    const cur = App.day.segment(from);
    const ret = App.day.segment(to);
    App.openSheet({
      title: ret ? `Return to vehicle ${esc(to)}?` : "Switch vehicle?",
      body: `
        <div class="switch-visual"><span class="veh-badge">${esc(from)}</span>${icon("chev", 22)}<span class="veh-badge to">${esc(to)}</span></div>
        <div class="field"><label class="label" for="swEnd">End KM for ${esc(from)} *</label>
          <input class="input num" id="swEnd" type="text" inputmode="numeric" data-num="int" autocomplete="off" placeholder="Start was ${fmtN(App.day.stretchStartKm(cur))}"></div>
        ${ret
          ? `<div class="note-box">You drove ${esc(to)} earlier today. Its Start KM is where you left it: <b>${fmtN(ret.endKm ?? App.day.stretchStartKm(ret))}</b>. New deliveries go into the same ${esc(to)} report.</div>`
          : `<div class="field"><label class="label" for="swStart">Start KM for ${esc(to)} *</label>
              <input class="input num" id="swStart" type="text" inputmode="numeric" data-num="int" autocomplete="off" placeholder="e.g. 61005"></div>
            ${productPicker()}`}
        <div class="steps"><b>What happens</b><ol>
          <li>${esc(from)} is checked out now.</li>
          <li>${esc(from)}'s daily report is uploaded.</li>
          <li>You stay signed in and continue on ${esc(to)}.</li>
        </ol></div>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="confirmSwitch">${ret ? "Return" : "Switch Vehicle"}</button>`,
      onCancel: () => { const i = $("#vehicleInput"); if (i) i.value = S().day.vehicle; },
      data: { from, to, ret: !!ret },
    });
  }

  async function confirmSwitch() {
    const s = S(), d = s.day, { from, to, ret } = s.sheet.data;
    const cur = App.day.segment(from);
    const endKm = numVal("#swEnd");
    const curStart = Number(App.day.stretchStartKm(cur));
    if (!(endKm >= curStart)) return App.sheetErr(`End KM for ${from} must be at least ${fmtN(curStart)}.`);
    let startKm = null, product = "";
    if (!ret) {
      startKm = numVal("#swStart"); if (!(startKm >= 0)) return App.sheetErr(`Enter the Start KM for ${to}.`);
      product = pickedProduct(); if (!product) return App.sheetErr(NO_PRODUCT);
    }
    App.sheetBusy(true);
    // Every step must succeed before leaving the vehicle; otherwise the driver stays on it.
    const time = nowHHMM(), at = nowIso();
    const before = { checkOutTime: cur.checkOutTime, checkOutAt: cur.checkOutAt, endKm: cur.endKm };
    try {
      await syncBeforeReport();
      Object.assign(cur, { checkOutTime: time, checkOutAt: at, endKm });
      await App.data.writes["shift.checkout"]({ ownerId: s.session.userId, workDate: d.date, vehicleNo: from, checkOutAt: at, checkOutTime: time });
      await uploadReport(from, "vehicle_switch");
    } catch (error) {
      Object.assign(cur, before);
      App.day.saveLocal();
      App.closeSheet(true);
      App.render();
      return App.showResult(false, "Vehicle switch failed", `${from}'s report could not be uploaded. ${reasonText(error)}`, `You are still on ${from}. Nothing was lost. Try again when the connection is back.`);
    }
    try {
      if (ret) {
        App.outbox.add("shift.reopen", { ownerId: s.session.userId, workDate: d.date, vehicleNo: to });
        const back = App.day.segment(to);
        // The new stretch starts where the driver left this vehicle.
        Object.assign(back, { resumeKm: back.endKm ?? App.day.stretchStartKm(back), checkOutTime: "", checkOutAt: "", endKm: null, reportUploaded: false });
      } else {
        const t2 = nowHHMM(), at2 = nowIso();
        App.outbox.add("shift.checkin", { row: shiftRow(to, startKm, t2, at2, product) });
        d.segments.push(App.day.newSegment(to, { checkInTime: t2, checkInAt: at2, startKm, product }));
      }
      d.vehicle = to;
      App.day.saveLocal();
    } catch (error) { App.closeSheet(false); return saveFailed(error); }
    App.closeSheet(false);
    App.render();
    App.day.loadOpening(to);
    await App.outbox.flush();
    App.render();
    App.showResult(true, ret ? `Back on ${to}` : "Vehicle switched", `${from}'s report saved to Supabase.`,
      ret ? `Back on ${to} from ${fmtN(App.day.stretchStartKm(App.day.segment(to)))} km. New deliveries are added to today's ${to} report.` : `Now on ${to}. TDG balance loaded for ${to}.`);
  }

  /* ---------------- Off-Duty ---------------- */
  function openOffDuty() {
    const p = App.outbox.count();
    const segs = App.day.segments();
    const allOut = App.day.status() === "out";
    App.openSheet({
      title: "Off-Duty",
      body: `
        <ul class="check-list">
          <li><span class="ck ${allOut ? "ok" : "bad"}">${icon(allOut ? "check" : "x", 14)}</span>${segs.length > 1 ? "All vehicles checked out" : "Checked out"}</li>
          <li><span class="ck ${p ? "bad" : "ok"}">${icon(p ? "x" : "check", 14)}</span>${p ? `${p} item${p > 1 ? "s" : ""} not uploaded yet` : "All records uploaded"}</li>
          <li><span class="ck ok">${icon("check", 14)}</span>Final daily report for ${esc(segs.map((g) => g.vehicle).join(", "))}</li>
          ${App.route.offDutyLine()}
        </ul>
        <p class="hint">Off-Duty uploads the final reports, clears this phone's day data and signs you out.</p>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="confirmOffDuty">Off-Duty</button>`,
    });
  }

  async function confirmOffDuty() {
    App.closeSheet(false);
    if (App.day.status() !== "out") return App.showResult(false, "Off-Duty blocked", "Check out first.", "Off-Duty needs the End KM from Check-out.");
    const sent = [];
    try {
      await syncBeforeReport();
      // The last vehicle, and any vehicle whose report changed since it was uploaded.
      for (const g of App.day.segments()) {
        if (g.vehicle === S().day.vehicle || !g.reportUploaded) {
          if (!App.day.openingFor(g.vehicle)) await App.day.loadOpening(g.vehicle);
          await uploadReport(g.vehicle, "off_duty");
          sent.push(g.vehicle);
        }
      }
    } catch (error) {
      App.render();
      return App.showResult(false, "Off-Duty failed", reasonText(error), "You are still signed in. Nothing was deleted. Try again when the connection is back.");
    }
    // After Resume Work the day's earlier Off-Duty report goes; the new one is already saved.
    for (const v of sent) {
      try { await App.data.dropEarlierOffDuty(S().session.userId, S().day.date, v, App.day.segment(v).snapshot.id); } catch (error) { console.warn("Earlier Off-Duty report not removed:", error.message); }
    }
    // Today's undelivered route stops move on, or are deleted on Friday (ROUTE_PROPOSAL.md 3.6).
    let routeLine = "";
    try { routeLine = await App.route.offDuty(); } catch (error) { console.warn("Route not updated at Off-Duty:", error.message); }
    App.showResult(true, "Off-Duty complete", "Final reports saved to Supabase.", `You are now signed out.${routeLine ? ` ${routeLine}` : ""}`, () => {
      App.day.clearLocal();
      window.TDG_AUTH.logout();
    });
  }

  /* ---------------- Resume Work (RESUME_WORK_PROPOSAL.md, owner's decisions 2026-10-29; app only) ---------------- */
  // Reopens the day after a mistaken Check-out or Off-Duty, on the vehicle checked out last. The new stretch
  // starts at the End KM entered at Check-out, which the driver may correct (decision 5).
  function openResume() {
    const g = App.day.lastOut(), done = App.day.offDutyDone();
    App.openSheet({
      title: "Resume Work",
      body: `
        <div class="note-box">Reopens today's shift on ${esc(g.vehicle)}. Your shift stays ${esc(App.day.dayStart())}–now.</div>
        <div class="field"><label class="label" for="rsKm">Start KM for ${esc(g.vehicle)} *</label>
          <input class="input num" id="rsKm" type="text" inputmode="numeric" data-num="int" autocomplete="off" value="${g.endKm ?? ""}" placeholder="At least ${fmtN(App.day.stretchStartKm(g))}"></div>
        <p class="hint">${g.endKm != null ? `End KM entered at Check-out (${esc(g.checkOutTime)}). Change it if it was wrong.` : "Enter the truck's KM now."}</p>
        <div class="steps"><b>What happens</b><ol>
          <li>${esc(g.vehicle)} is checked in again.</li>
          ${done ? "<li>Route stops moved or deleted at Off-Duty stay that way.</li>" : ""}
          <li>${done ? "Check-out and Off-Duty again at the end of the day. The new daily report replaces today's earlier one." : "Check-out and Off-Duty as usual at the end of the day."}</li>
        </ol></div>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="confirmResume">Resume Work</button>`,
    });
  }

  async function confirmResume() {
    const s = S(), d = s.day, g = App.day.lastOut();
    const km = numVal("#rsKm"), from = Number(App.day.stretchStartKm(g));
    if (!(km >= from)) return App.sheetErr(`Start KM must be at least ${fmtN(from)}.`);
    try {
      App.outbox.add("shift.reopen", { ownerId: s.session.userId, workDate: d.date, vehicleNo: g.vehicle });
      Object.assign(g, { resumeKm: km, checkOutTime: "", checkOutAt: "", endKm: null, reportUploaded: false });
      Object.assign(d, { vehicle: g.vehicle, offDutyAt: "" });
      App.day.saveLocal();
    } catch (error) { App.closeSheet(false); return saveFailed(error); }
    App.closeSheet(false);
    App.day.loadOpening(g.vehicle);
    await upload("Back on shift", `${g.vehicle} from ${fmtN(km)} km.`, "Resume Work not uploaded");
  }

  /* ---------------- vehicle and week cycle ---------------- */
  // Changing Vehicle No while checked in switches vehicles (decision 4).
  App.onChange.vehicleInput = (input) => {
    const d = S().day;
    const v = normVeh(input.value);
    if (!v) { input.value = d.vehicle; return App.snackbar("Vehicle No is required."); }
    input.value = v;
    if (v === d.vehicle) return;
    const st = App.day.status();
    if (st === "on") return openSwitch(d.vehicle, v);
    if (st === "out") { input.value = d.vehicle; return App.snackbar("The day is checked out. Go Off-Duty to finish it."); }
    d.vehicle = v;
    App.day.saveLocal();
    App.day.loadOpening(v);
    App.snackbar(`Loading the TDG balance for ${v}.`);
  };

  App.onChange.weekCycle = async (select) => {
    const s = S(), n = Number(select.value);
    try {
      App.outbox.add("settings.weekCycle", { row: App.data.weekCycleRow(s.session.userId, n) });
      s.day.weekCycle = n;
      App.day.saveLocal();
    } catch (error) { return saveFailed(error); }
    await upload("Week Cycle saved", `Week Cycle ${n} from this week on.`, "Week Cycle not uploaded");
  };

  /* ---------------- Reload / TDG Adjustment ---------------- */
  // resume: an Add Delivery that was more than the balance; it opens again after the Reload.
  // The plants are the current province's (REGION_PROPOSAL.md 3.6): one is used as it is; with
  // several, nothing is chosen in advance and the driver picks one every time (decision 17).
  async function openReload(resume = null) {
    if (!needBalance()) return;
    const prov = S().loc?.prov || "";
    const pName = App.location.provName(prov);
    if (!prov) return App.showResult(false, "Choose your province", "Reload uses the plants of the province you are in.", "Tap the location at the top left and choose your province.", () => { if (resume) openAdd(resume); });
    let list = App.data.plantsIn(prov);
    // Right after signing in the plants may still be on their way.
    if (!list.length) { await App.regionSettled(); list = App.data.plantsIn(prov); }
    if (!list.length) {
      return App.showResult(false, "No reload plant", `No reload plant set for ${pName}.`,
        App.canEditCustomer() ? "Add one in Customers → Reload plants, then try again." : "Ask a supervisor to set it. Supervisors, managers and admins can add plants in Customers.",
        () => { if (resume) openAdd(resume); });
    }
    S().resumeAdd = resume;
    const info = (p) => `<b>${esc(p.name)}</b><div class="small muted">Code ${esc(p.code)}${p.address ? ` · ${esc(p.address)}` : ""}${p.city ? `, ${esc(p.city)}` : ""}</div>`;
    App.openSheet({
      title: "Add Reload",
      body: `
        <div class="field"><label class="label" for="rlKg">Reload amount (kg) *</label>
          <input class="input num" id="rlKg" type="text" inputmode="numeric" data-num="int" autocomplete="off" placeholder="e.g. 6000"></div>
        <span class="label">Location${list.length > 1 ? ` · ${list.length} plants in ${esc(pName)}` : ""}</span>
        ${list.length === 1 ? `<div class="kmbox" style="margin-bottom:6px">${info(list[0])}</div>`
          : `<div class="radio-list" id="plantPick" style="margin-bottom:6px">${list.map((p) => `<button data-action="pickPlant" data-id="${esc(p.id)}"><span class="grow">${info(p)}</span></button>`).join("")}</div>
            <p class="hint" style="margin:0">Choose the plant where you reloaded.</p>`}
        <p class="hint">Added to the TDG balance of ${esc(S().day.vehicle)}.</p>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-ok" data-action="confirmReload">Confirm Reload</button>`,
      onCancel: () => resumeAdd(),
      data: { plantId: list.length === 1 ? list[0].id : null },
    });
  }
  function pickPlant(id) {
    S().sheet.data.plantId = id;
    document.querySelectorAll("#plantPick button").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
    App.sheetErr("");
  }
  function resumeAdd() {
    const draft = S().resumeAdd;
    S().resumeAdd = null;
    if (draft) openAdd(draft);
  }

  // The plant's code goes where the customer number was (003 on the current site); the record keeps
  // the name, address and city as they were at the time.
  async function confirmReload() {
    const kg = App.data.integerPart(numVal("#rlKg"));
    if (!(kg > 0)) return App.sheetErr("Enter the reload amount in whole kg.");
    const plant = App.data.cachedPlants().find((p) => p.id === S().sheet.data.plantId);
    if (!plant) return App.sheetErr("Choose the plant where you reloaded.");
    const event = App.day.buildEvent({
      eventType: "reload", reloadAmountKg: kg,
      accountNumber: plant.code, accountName: plant.name,
      accountAddress: plant.address || "", accountCity: plant.city || "", accountRoute: "",
      notes: `TDG Reload: +${kg} kg`,
    });
    try { App.day.addRecord(event); } catch (error) { App.closeSheet(false); return saveFailed(error); }
    App.closeSheet(false);
    const bal = App.day.balance();
    await upload("Reload saved", `+${fmtN(kg)} kg to ${S().day.vehicle} at ${event.accountName}. New balance ${fmtN(bal.remainingKg)} kg.`, "Reload not uploaded", resumeAdd);
  }

  const fmtLbs = (v) => Number(v).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");

  function openAdjust() {
    if (!needBalance()) return;
    const bal = App.day.balance();
    const lbs = Math.max(0, Math.trunc(bal.remainingLbs));
    if (!(lbs > 0)) return App.showResult(false, "No TDG to adjust", "The current TDG balance is already 0.");
    App.openSheet({
      title: "TDG Adjustment",
      body: `
        <span class="label">Current balance · ${esc(S().day.vehicle)}</span>
        <div class="kmbox num" style="margin-bottom:14px"><b>${fmtN(bal.remainingLbs)} lbs</b> <span class="muted">(${fmtN(bal.remainingExactKg)} kg)</span></div>
        <div class="field"><label class="label" for="adjLbs">Amount to reduce (lbs) *</label>
          <input class="input num" id="adjLbs" type="text" inputmode="decimal" data-num="dec" autocomplete="off" placeholder="e.g. 50"></div>
        <div class="field"><label class="label" for="adjReason">Reason</label>
          <select class="select" id="adjReason">${ADJUSTMENT_REASONS.map((r) => `<option>${r}</option>`).join("")}</select></div>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="confirmAdjust">Confirm Adjustment</button>`,
    });
  }

  // Same limits as the current site's saveTdgAdjustmentEvent.
  async function confirmAdjust() {
    const requested = numVal("#adjLbs");
    const reason = $("#adjReason").value;
    const current = Math.max(0, Number(App.day.balance().remainingLbs) || 0);
    const tolerance = 0.02;
    if (!(requested > 0)) return App.sheetErr("Enter the amount to reduce.");
    if (!ADJUSTMENT_REASONS.includes(reason)) return App.sheetErr("Choose a reason.");
    if (requested > current + tolerance) return App.sheetErr(`Amount cannot be more than the balance (${fmtLbs(current)} lbs).`);
    const amount = Math.abs(requested - current) <= tolerance ? current : requested;
    const event = App.day.buildEvent({
      eventType: "tdg_adjustment", adjustmentAmountLbs: amount, adjustmentReason: reason,
      accountNumber: "TDG-ADJ", accountName: "TDG Adjustment", accountAddress: "", accountCity: "", accountRoute: "",
      notes: `TDG Adjustment: -${fmtLbs(amount)} lbs (${reason})`,
    });
    try { App.day.addRecord(event); } catch (error) { App.closeSheet(false); return saveFailed(error); }
    App.closeSheet(false);
    await upload("Adjustment saved", `−${fmtLbs(amount)} lbs on ${S().day.vehicle} (${reason}).`, "Adjustment not uploaded");
  }

  /* ---------------- Add / Edit / Delete Delivery ---------------- */
  function emgToggleHtml(on) {
    return `<button type="button" class="emg-toggle ${on ? "on" : ""}" id="emgToggle" data-action="toggleEmg" aria-pressed="${on}">
      <span class="ic">${icon("siren", 22)}</span>
      <span class="grow"><b>Emergency Charge</b><span class="small muted" style="display:block">Marks this as an emergency delivery. Shown in Deliveries and on the TDG report.</span></span>
      <span class="sw" aria-hidden="true"></span></button>`;
  }
  function setEmg(on) {
    S().addEmg = on;
    const b = $("#emgToggle");
    if (b) { b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
  }

  // draft: what was typed before, when the sheet opens again after a Reload.
  function openAdd(draft = null) {
    const d = S().day;
    if (App.day.status() !== "on") return App.showResult(false, "Check in first", "Add Delivery needs a check-in.", "Tap Check-in on the Today screen and enter the Start KM.");
    if (!needBalance()) return;
    S().addArrival = draft?.arrival || null;
    S().addEmg = !!draft?.emergency;
    S().addStop = draft?.stopId || null; // started from a route stop: it is ticked when saved
    App.openSheet({
      title: "Add Delivery",
      tall: true,
      body: `
        <div class="row" style="margin-bottom:12px"><span class="muted small">Vehicle</span><span class="chip brand">${esc(d.vehicle)}</span></div>
        <label class="label" for="custSearch">Find customer</label>
        <div class="search-wrap">${icon("search", 18)}<input class="input" id="custSearch" placeholder="Account no., name, address, city or route" autocomplete="off"></div>
        <div class="cust-results" id="custResults"></div>
        <div class="divider"></div>
        <div class="grid2">
          <div class="field"><label class="label" for="fAcc">Account Number</label><input class="input" id="fAcc" autocomplete="off"></div>
          <div class="field"><label class="label" for="fRoute">Route</label><input class="input" id="fRoute" autocomplete="off"></div>
        </div>
        <div class="field"><label class="label" for="fName">Account Name *</label><input class="input" id="fName" autocomplete="off"></div>
        <div class="field"><label class="label" for="fAddr">Address</label><input class="input" id="fAddr" autocomplete="off"></div>
        <div class="field"><label class="label" for="fCity">City</label><input class="input" id="fCity" autocomplete="off"></div>
        <div class="divider"></div>
        <div class="arrive-row">
          <button class="btn btn-ok" id="btnArrive" data-action="confirmArrive">Confirm Arrive</button>
          <span class="num" id="arriveText"><span class="muted">Arrival time: —</span></span>
        </div>
        ${emgToggleHtml(false)}
        <div class="field"><label class="label" for="fLbs">Delivered (lbs) *</label><input class="input num" id="fLbs" type="text" inputmode="numeric" data-num="int" autocomplete="off" placeholder="e.g. 2400"><p class="hint">Could not deliver? Enter 0 and write the reason in Notes.</p></div>
        <div class="field"><label class="label" for="fNote">Notes (optional)</label><textarea class="textarea" id="fNote" placeholder="e.g. unsafe working conditions, customer complaints"></textarea></div>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="confirmAdd">Add Record</button>`,
    });
    if (draft) {
      for (const [id, key] of [["fAcc", "acc"], ["fRoute", "route"], ["fName", "name"], ["fAddr", "addr"], ["fCity", "city"], ["fLbs", "lbs"], ["fNote", "note"]]) $("#" + id).value = draft[key] ?? "";
      $("#custSearch").value = draft.name || "";
      setEmg(!!draft.emergency);
      if (draft.arrival) $("#arriveText").innerHTML = `<b>Arrived ${esc(draft.arrival)}</b>`;
      if (draft.name) showArrive();
    }
  }

  // With the customer filled in, Confirm Arrive is next: close the keyboard and scroll the sheet to it.
  function showArrive() {
    document.activeElement?.blur();
    const btn = $("#btnArrive"), box = btn.closest(".sheet-b");
    box.scrollTop += btn.getBoundingClientRect().top - box.getBoundingClientRect().top - 16;
  }

  const readAddDraft = () => ({
    acc: $("#fAcc").value.trim(), route: $("#fRoute").value.trim(), name: $("#fName").value.trim(), addr: $("#fAddr").value.trim(),
    city: $("#fCity").value.trim(), lbs: $("#fLbs").value.trim(), note: $("#fNote").value.trim(), emergency: S().addEmg, arrival: S().addArrival,
    stopId: S().addStop,
  });

  App.onInput.custSearch = (t) => { const box = $("#custResults"); if (box) box.innerHTML = App.customers.resultsHtml(t.value, "custResults", "pickCust", "Fill in the fields below."); };

  function pickCust(i) {
    const c = App.customers.hit("custResults", i);
    if (!c) return;
    $("#fAcc").value = c.accountNumber; $("#fName").value = c.accountName; $("#fAddr").value = c.accountAddress;
    $("#fCity").value = c.city; $("#fRoute").value = c.route;
    $("#custSearch").value = c.accountName;
    $("#custResults").innerHTML = "";
    // A customer who is today's Emergency Call stop turns Emergency Charge on (decision 28).
    if (App.route.isPendingEmergency(c.accountNumber)) setEmg(true);
    showArrive();
  }

  function confirmArrive() {
    S().addArrival = nowHHMM();
    $("#arriveText").innerHTML = `<b>Arrived ${S().addArrival}</b>`;
  }

  async function confirmAdd() {
    const draft = readAddDraft();
    const lbs = numVal("#fLbs");
    if (!draft.name) return App.sheetErr("Choose a customer or enter the Account Name.");
    if (!(lbs >= 0) || !Number.isInteger(lbs)) return App.sheetErr("Enter the delivered volume (0 if nothing was delivered).");
    // More than the TDG balance on the truck: Reload first, or ignore (ANDROID_APP_PROPOSAL.md decision 29).
    const bal = App.day.balance();
    const balLbs = Math.round(bal.remainingLbs);
    if (lbs > balLbs) {
      return App.showConfirm({
        title: "More than the TDG balance",
        msg: `Delivered ${fmtN(lbs)} lbs is more than the TDG balance of ${S().day.vehicle}: ${fmtN(balLbs)} lbs (${fmtN(bal.remainingKg)} kg). Add a Reload first, or ignore this and save the delivery.`,
        okText: "Reload first", cancelText: "Ignore and save",
        onOk: () => { App.closeSheet(false); openReload(draft); },
        onCancel: () => saveDelivery(draft, lbs),
      });
    }
    return saveDelivery(draft, lbs);
  }

  async function saveDelivery(draft, lbs) {
    const rec = App.day.buildDelivery({
      customer: { accountNumber: draft.acc, accountName: draft.name, accountAddress: draft.addr, city: draft.city, route: draft.route },
      arrivalTime: draft.arrival || nowHHMM(), lbs, notes: draft.note, emergency: draft.emergency,
    });
    try { App.day.addRecord(rec); } catch (error) { App.closeSheet(false); return saveFailed(error); }
    App.closeSheet(false);
    const tick = App.route.afterDelivery(rec, draft.stopId);
    await upload("Delivery saved", `${draft.name} · ${fmtN(lbs)} lbs${tick ? `. ${tick}` : ""}`, "Delivery not uploaded");
  }

  const findRecord = (id) => S().records.find((r) => r.clientRecordId === id) || null;

  function openEdit(id) {
    const r = findRecord(id);
    if (!r) return;
    S().addEmg = !!r.emergency;
    App.openSheet({
      title: "Edit Delivery",
      body: `
        <div class="kmbox" style="margin-bottom:14px">
          <b style="display:block">${esc(r.accountName)}</b><div class="small muted">${esc([r.accountAddress, r.accountCity].filter(Boolean).join(", "))}</div>
          <div class="small muted num">Arrived ${esc(r.arrivalTime)} · ${esc(r.vehicleNo)}${r.accountNumber ? ` · Acc ${esc(r.accountNumber)}` : ""}</div>
        </div>
        ${emgToggleHtml(!!r.emergency)}
        <div class="field"><label class="label" for="eLbs">Delivered (lbs) *</label><input class="input num" id="eLbs" type="text" inputmode="numeric" data-num="int" autocomplete="off" value="${esc(r.deliveredVolume)}"></div>
        <div class="field"><label class="label" for="eNote">Notes</label><textarea class="textarea" id="eNote">${esc(r.notes)}</textarea></div>`,
      footer: `<button class="btn btn-danger-outline" data-action="deleteRecord" style="flex:0 0 auto">Delete</button><button class="btn btn-primary" data-action="saveEdit">Save Change</button>`,
      data: { id },
    });
  }

  async function saveEdit() {
    const r = findRecord(S().sheet.data.id);
    const lbs = numVal("#eLbs");
    if (!(lbs >= 0) || !Number.isInteger(lbs)) return App.sheetErr("Enter the delivered volume (0 if nothing was delivered).");
    if (r.synced && !r.serverUpdatedAt) return App.sheetErr("Refresh before editing this record.");
    try {
      App.day.changeRecord(r, { deliveredVolume: lbs, notes: $("#eNote").value.trim(), emergency: S().addEmg });
      if (lbs === 0) App.route.untick(r);
    } catch (error) { App.closeSheet(false); return saveFailed(error); }
    App.closeSheet(false);
    await upload("Delivery updated", `${r.accountName} · ${fmtN(lbs)} lbs`, "Change not uploaded");
  }

  function deleteRecord() {
    const r = findRecord(S().sheet.data.id);
    App.showConfirm({
      title: "Delete this delivery?", msg: `${r.accountName} · ${fmtN(r.deliveredVolume)} lbs. This cannot be undone.`, okText: "Delete", danger: true,
      onOk: () => doDelete(r),
    });
  }

  async function doDelete(r) {
    const s = S();
    const queued = App.outbox.items().filter((it) => it.meta?.clientRecordId === r.clientRecordId);
    // On its way to the server now: dropping it from the phone would leave it on the server.
    if (queued.some((it) => it.id === App.outbox.sending())) return App.showResult(false, "Delete failed", "This delivery is uploading right now.", "Try again in a moment.");
    // Never uploaded: drop it from the phone and from the queue.
    if (queued.some((it) => it.kind === "record.insert")) {
      queued.forEach((it) => App.outbox.remove(it.id));
      s.records = s.records.filter((x) => x !== r);
      App.day.saveLocal();
      App.route.untick(r);
      App.closeSheet(false);
      App.render();
      return App.showResult(true, "Delivery deleted", "It had not been uploaded yet.", `${r.accountName} · ${fmtN(r.deliveredVolume)} lbs`);
    }
    if (queued.length) return App.showResult(false, "Delete failed", "A change to this delivery is still waiting to upload.", "Upload it first, then delete.");
    try {
      await App.data.writes["record.delete"]({ ownerId: s.session.userId, clientRecordId: r.clientRecordId, expectedUpdatedAt: r.serverUpdatedAt });
    } catch (error) {
      return App.showResult(false, "Delete failed", reasonText(error), "The delivery was not deleted.");
    }
    s.records = s.records.filter((x) => x !== r);
    App.day.saveLocal();
    App.route.untick(r);
    App.closeSheet(false);
    App.render();
    App.showResult(true, "Delivery deleted", "Saved to Supabase.", `${r.accountName} · ${fmtN(r.deliveredVolume)} lbs`);
  }

  /* ---------------- upload, account ---------------- */
  async function syncNow() {
    const p = App.outbox.count();
    if (!navigator.onLine) return App.snackbar("No connection. Items will upload automatically.");
    if (!p) return App.snackbar("Everything is uploaded.");
    const r = await App.outbox.flush();
    App.render();
    if (r.dropped) return;
    if (r.ok) return App.showResult(true, "Waiting items uploaded", "Saved to Supabase.", `${p} item${p > 1 ? "s" : ""} uploaded.`);
    App.showResult(false, "Upload failed", reasonText(r.error), r.error?.transient === false ? r.error.message : KEPT);
  }

  function signOut() {
    const p = App.outbox.count();
    App.showConfirm({
      title: "Sign out?",
      msg: p ? `${p} item${p > 1 ? "s are" : " is"} still waiting to upload. They stay on this phone and upload after you sign in again.` : "Your day stays on this phone until Off-Duty.",
      okText: "Sign Out",
      onOk: () => window.TDG_AUTH.logout(),
    });
  }

  function openChangePassword() {
    App.openSheet({
      title: "Change Password",
      body: `
        <div class="field"><label class="label" for="pwOld">Current password</label><input class="input" id="pwOld" type="password" autocomplete="current-password"></div>
        <div class="field"><label class="label" for="pwNew">New password</label><input class="input" id="pwNew" type="password" autocomplete="new-password"><p class="hint">12 to 128 characters.</p></div>
        <div class="field"><label class="label" for="pwNew2">New password again</label><input class="input" id="pwNew2" type="password" autocomplete="new-password"></div>`,
      footer: `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button><button class="btn btn-primary" data-action="confirmPassword">Change Password</button>`,
    });
  }

  async function confirmPassword() {
    const current = $("#pwOld").value, next = $("#pwNew").value;
    if (!current) return App.sheetErr("Enter your current password.");
    if (next.length < 12 || next.length > 128) return App.sheetErr("The new password needs 12 to 128 characters.");
    if (next !== $("#pwNew2").value) return App.sheetErr("The two new passwords are different.");
    if (next === current) return App.sheetErr("The new password must be different.");
    App.sheetBusy(true);
    let r;
    try {
      r = await window.supabaseClient.functions.invoke("tdg-change-password", { body: { currentPassword: current, newPassword: next } });
    } catch (error) {
      r = { error };
    }
    App.sheetBusy(false);
    if (r.error) {
      let message = r.error.message;
      try { message = (await r.error.context.json()).error || message; } catch {}
      return App.sheetErr(navigator.onLine ? message : "No internet connection.");
    }
    // A remembered sign-in (login.html) keeps working with the new password.
    try { const saved = JSON.parse(App.device.get("remember")); if (saved) App.device.set("remember", JSON.stringify({ ...saved, p: next })); } catch {}
    App.closeSheet(false);
    App.showResult(true, "Password changed", "Saved to Supabase.", "Use the new password next time you sign in.");
  }

  // A Daily Log snapshot of today so far (the current site's Remote Backup).
  async function backup() {
    const payload = App.day.dailyPayload("manual");
    try { App.outbox.add("daily.insert", { row: App.day.dailyRow(uuid(), payload) }); } catch (error) { return saveFailed(error); }
    await upload("Backup saved", `Today's ${App.day.deliveries().length} deliveries and shift are saved on the server.`, "Backup not uploaded");
  }

  App.flows = { openAdd, checkInConflict };

  Object.assign(App.ACTIONS, {
    checkin: openCheckIn, confirmCheckIn, confirmSwitch, changeProduct: openProduct, confirmProduct,
    checkout: openCheckOut, confirmCheckOut,
    offduty: openOffDuty, confirmOffDuty, resumeWork: openResume, confirmResume,
    reload: () => openReload(), confirmReload, pickPlant: (d) => pickPlant(d.id),
    adjust: openAdjust, confirmAdjust,
    addDelivery: () => openAdd(), confirmAdd, confirmArrive,
    toggleEmg: () => setEmg(!S().addEmg),
    pickCust: (d) => pickCust(Number(d.i)),
    editRecord: (d) => openEdit(d.id), saveEdit, deleteRecord,
    syncNow, signOut,
    changePassword: openChangePassword, confirmPassword,
    backup,
  });
})();
