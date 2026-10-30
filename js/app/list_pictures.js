/* Route → Upload List → Read pictures (ROUTE_PROPOSAL.md 3.2.1, decisions 37, 39). In the app
 * only: screenshots or photos chosen in Android's photo picker (App.native.pickPictures; Android
 * opens the files itself), or the pages of a scanned PDF, are read on the phone by Google ML Kit
 * (App.native.readText); nothing is sent anywhere. Only the customer code of each row is used:
 * name, address, city and route come from Customers (decision 39). Check what was read shows every
 * code next to its picture; the driver fixes misread codes, deletes or adds rows, and saves a code
 * that is not in Customers as a new customer before going on to Check the list. Rows that need a
 * look are yellow: no code, not in Customers, hard to read, or the picture shows another name. */
(() => {
  "use strict";
  const App = window.TDG_APP;
  const { $, esc, icon } = App;
  const L = () => window.TDG_LIST_READ;
  const P = () => window.TDG_ROUTE_PLAN;
  const R = () => App.route.R();
  const up = () => R().up;
  const rd = () => up()?.read;
  const MAX_SIDE = 3000;
  let seq = 0;

  /* ---------------- reading ---------------- */
  const base64 = (blob) => new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => fail(new Error("The picture could not be opened."));
    r.readAsDataURL(blob);
  });
  const toBlob = (canvas, type, q) => new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("The picture could not be prepared."))), type, q));

  const jpegOf = (b64) => new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: "image/jpeg" });

  // A page of a scanned PDF as a JPEG for ML Kit, at most 3000 px on its long side.
  async function prepare(blob) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const jpeg = await toBlob(canvas, "image/jpeg", 0.92);
    canvas.width = canvas.height = 0;
    return jpeg;
  }

  // One field of a row as the picture shows it, drawn by the browser straight from the picture
  // (cutting every field out with a canvas took up to a minute on a phone). At most maxW wide.
  function crop(row, key, h, maxW) {
    const p = rd().items[row.img], box = row.boxes?.[key];
    if (!p || !box) return "";
    const pad = (box[3] - box[1]) * 0.3;
    const x0 = Math.max(0, box[0] - pad), y0 = Math.max(0, box[1] - pad);
    const x1 = Math.min(p.w, box[2] + pad), y1 = Math.min(p.h, box[3] + pad);
    if (x1 <= x0 || y1 <= y0) return "";
    const k = Math.min(h / (y1 - y0), maxW / (x1 - x0)), px = (v) => `${Math.round(v * k)}px`;
    return `<span class="pr-crop" role="img" aria-label="The picture" style="width:${px(x1 - x0)};height:${px(y1 - y0)};background-image:url(${p.url});background-size:${px(p.w)} ${px(p.h)};background-position:${px(-x0)} ${px(-y0)}"></span>`;
  }

  function start(append) {
    const u = up();
    if (!append || !u.read) {
      forget(u.read);
      u.read = { items: [], rows: [], byKey: new Map(), twice: 0, errors: [], busy: "" };
    }
    u.read.errors = [];
    u.read.run = (u.read.run || 0) + 1; // Cancel stops the reading that is going on
    if (App.S.screen !== "readCheck") App.go("readCheck");
    return u.read;
  }
  function forget(read) {
    if (!read) return;
    read.items.forEach((p) => URL.revokeObjectURL(p.url));
  }

  // What the reading screen shows: the step, and the seconds since it began.
  function step(r, text) {
    r.busy = text;
    r.since = Date.now();
    App.devLog("pictures:", text);
    App.render();
  }

  // sources: [{ name, id }] from the photo picker (Android opens and reads them), or
  // [{ name, blob }] (the pages of a scanned PDF, drawn here).
  async function readPictures(sources, append) {
    const r = start(append), run = r.run;
    const stopped = () => r.run !== run || rd() !== r;
    App.devLog("pictures:", sources.map((x) => (x.blob ? `${x.name} ${x.blob.size} bytes` : x.name)).join(", "));
    for (let i = 0; i < sources.length && !stopped(); i++) {
      const src = sources[i], of = sources.length > 1 ? ` ${i + 1} of ${sources.length}` : "";
      try {
        let jpeg, res;
        if (src.id) {
          step(r, `Reading the text in picture${of} on this phone…`);
          res = await App.native.readText({ id: src.id });
          if (stopped()) return;
          jpeg = jpegOf(res.image || "");
        } else {
          step(r, `Opening picture${of}…`);
          jpeg = await prepare(src.blob);
          if (stopped()) return;
          step(r, `Reading the text in picture${of} on this phone…`);
          res = await App.native.readText({ image: await base64(jpeg) });
        }
        if (stopped()) return;
        App.devLog(`pictures: ${res.width}x${res.height}, ${res.words?.length ?? 0} words back`);
        const words = (res.words || []).map((w) => ({ str: w.text, x0: w.box[0], y0: w.box[1], x1: w.box[2], y1: w.box[3], conf: w.conf >= 0 ? w.conf : undefined, angle: w.angle }));
        // The route in the title is not used either: it comes from Customers (decision 39).
        const { rows } = L().rowsFrom([{ words, width: res.width, height: res.height }], { ocr: true });
        const img = r.items.length;
        r.items.push({ name: src.name, url: URL.createObjectURL(jpeg), w: res.width, h: res.height, rows: rows.length });
        App.devLog(`pictures: ${rows.length} rows`);
        rows.forEach((row) => { row.id = ++seq; row.img = img; });
        r.rows.push(...rows);
        if (!rows.length) r.errors.push(`${src.name}: no rows with a customer code were found.`);
      } catch (error) {
        App.devLog(`pictures: ${src.name} failed:`, error);
        r.errors.push(`${src.name}: ${error.message || error}`);
      }
    }
    if (stopped()) return;
    const d = L().dedupe(r.rows);
    r.twice += d.twice;
    r.rows = d.rows;
    step(r, "Looking up the customer codes…");
    try {
      const found = await App.routeUpload.lookupCustomers(r.rows);
      for (const [k, v] of found) r.byKey.set(k, v);
    } catch (error) {
      r.errors.push(`The codes could not be looked up in Customers: ${App.route.reason(error)}`);
    }
    if (stopped()) return;
    App.devLog(`pictures: done, ${r.rows.length} rows, ${r.errors.length} errors`);
    r.busy = "";
    App.render();
  }

  // While reading: the seconds go up on screen, so it is clear the phone is still working.
  setInterval(() => {
    const r = rd(), el = $("#readSecs");
    if (r?.busy && el) el.textContent = `${Math.round((Date.now() - r.since) / 1000)} s`;
  }, 1000);

  // Read pictures (Upload List) and More (Check what was read): Android's photo picker.
  async function pick() {
    if (!App.native.available()) return App.showResult(false, "Pictures not read", "Pictures are read in the Android app.", "On the website, choose the PDF, Excel or CSV list.");
    const append = App.S.screen === "readCheck";
    let chosen;
    try { chosen = await App.native.pickPictures(); } catch (error) {
      return App.showResult(false, "Pictures not opened", error.message || String(error), "");
    }
    if (chosen.length) readPictures(chosen, append);
  }

  // A scanned PDF (no text): its pages are drawn as pictures and read the same way.
  async function fromPdf(doc, name) {
    const r = start(false);
    r.busy = `Drawing the pages of ${name}…`;
    App.render();
    r.since = Date.now();
    let blobs;
    try { blobs = await L().pdfPictures(doc); } catch (error) {
      r.busy = "";
      r.errors.push(`${name}: ${error.message || error}`);
      return App.render();
    }
    await readPictures(blobs.map((blob, i) => ({ blob, name: `${name}, page ${i + 1}` })), true);
  }

  /* ---------------- Check what was read ---------------- */
  const words = (s) => String(s || "").toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4);
  const alike = (a, b) => L().likeness(a, b) >= 0.5 || words(a).some((w) => words(b).includes(w));
  const customerOf = (row) => (rd().byKey.get(P().normAcc(row.pos)) || [])[0] || null;
  const placeOf = (c) => [c.accountAddress, c.city, c.route].filter(Boolean).join(" · ");

  // Why a row needs a look ("" when it does not). A row the driver has saved is not yellow again,
  // except one whose code is not in Customers: it is fixed, added as a new customer, or deleted.
  // The name read from the picture is only compared, to catch a code misread as another customer's.
  function issue(row) {
    const code = row.pos.trim(), c = customerOf(row);
    if (!code) return "No customer code was read. Type it from the picture, or delete the row.";
    if (!c) return `Not in Customers. Check the code against the picture; if it is right, add the customer.${/^\d{8}(-INST)?$/i.test(code) ? "" : " The code is not 8 digits."}`;
    if (row.name && !alike(row.name, c.accountName)) return "The picture shows another name. Check the code.";
    if (row.codeFixed || (typeof row.conf === "number" && row.conf < 0.6)) return "The code was hard to read. Check it against the picture.";
    return "";
  }
  const blocked = (row) => !customerOf(row);

  function rowHtml(row) {
    const why = issue(row), c = customerOf(row), warn = why && (!row.checked || blocked(row));
    const note = warn ? `<span class="small pr-why">${icon("alert", 13)} ${esc(why)}</span>`
      : why ? `<span class="small muted">${esc(why.split(".")[0])} · checked</span>`
      : `<span class="small muted">${icon("check", 12)} From Customers</span>`;
    return `<button class="pr-row ${warn ? "warn" : ""}" data-action="prEdit" data-id="${row.id}">
      <span class="pr-code">${crop(row, "pos", 22, 96)}<b class="num">${esc(row.pos || "No code")}</b></span>
      <span class="pr-t">${c ? `<b>${esc(c.accountName)}</b><span class="small muted">${esc(placeOf(c))}</span>` : "<b>Not in Customers</b>"}${note}</span>
      ${icon("chev", 16)}</button>`;
  }

  function renderReadCheck() {
    const r = rd();
    if (!r) { setTimeout(() => App.go("upload")); return ""; }
    const back = `<button class="back" data-action="picsCancel">${icon("back", 20)} Upload List</button>`;
    if (r.busy) {
      return `${back}<div class="page-h"><h1>Check what was read</h1></div>
        <div class="empty">${esc(r.busy)} <span class="num" id="readSecs">${Math.round((Date.now() - (r.since || Date.now())) / 1000)} s</span>
          <div class="small muted" style="margin-top:6px">The pictures are read on this phone. Nothing is sent.</div></div>
        <button class="btn btn-outline block" data-action="picsCancel">Cancel</button>`;
    }
    const n = r.rows.filter((row) => issue(row) && (!row.checked || blocked(row))).length;
    const missing = r.rows.filter(blocked).length;
    const pl = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
    return `${back}
      <div class="page-h"><h1>Check what was read</h1><span class="sub">${pl(r.items.length, "picture")} · ${pl(r.rows.length, "row")}</span></div>
      <div class="warn-box">${icon("alert", 20)}<span>Only the customer codes are read; name, address, city and route come from Customers. Codes can be misread, for example 8 as 3: compare each code with its picture. ${n ? `<b>${pl(n, "row")}</b> marked yellow need${n === 1 ? "s" : ""} a look.` : "No row needs a look."}</span></div>
      <div class="pic-strip">${r.items.map((p, i) => `<button class="pic-thumb" data-action="picView" data-i="${i}" aria-label="Picture ${i + 1}: ${esc(p.name)}"><img src="${p.url}" alt=""><span>${i + 1}</span></button>`).join("")}
        <button class="pic-thumb add" data-action="picsPick" aria-label="Read more pictures">${icon("plus", 20)}<span>More</span></button></div>
      ${r.errors.length ? `<p class="err">${r.errors.map(esc).join("<br>")}</p>` : ""}
      ${r.twice ? `<p class="small muted" style="margin:0 2px 10px">${pl(r.twice, "row")} on two pictures ${r.twice === 1 ? "is" : "are"} kept once.</p>` : ""}
      <section class="card pr-list" aria-label="Rows read">
        ${r.rows.map(rowHtml).join("") || `<p class="muted small" style="margin:10px 0">No rows were read. Try a sharper picture, or add the rows by hand.</p>`}
      </section>
      <button class="btn btn-outline block" data-action="prAdd">${icon("plus", 16)} Add a row</button>
      ${missing ? `<p class="hint">${pl(missing, "code")} ${missing === 1 ? "is" : "are"} not in Customers. Fix ${missing === 1 ? "it" : "them"}, add ${missing === 1 ? "it as a new customer" : "them as new customers"}, or delete the row${missing === 1 ? "" : "s"}.</p>` : ""}
      <button class="btn btn-primary block" style="margin-top:10px" data-action="prDone" ${r.rows.length && !missing ? "" : "disabled"}>Continue to Check the list</button>`;
  }

  // In the row sheet: the customer this code belongs to, from what this phone has looked up.
  function matchText(code) {
    const k = P().normAcc(code);
    const c = (rd().byKey.get(k) || [])[0];
    if (c) return `${icon("check", 12)} In Customers: <b>${esc(c.accountName)}</b> · ${esc(placeOf(c))}`;
    return k ? "Not found yet. Looked up when you save; a code not in Customers is added as a new customer." : "";
  }

  // What the picture shows for the other fields: only to compare with Customers, never read.
  const shown = (row) => [["name", "Customer"], ["addr", "Address"], ["city", "City"]]
    .map(([k, label]) => { const img = crop(row, k, 30, 320); return img ? `<div class="small muted">${label}</div>${img}` : ""; }).join("");

  function openRow(id) {
    const row = id ? rd().rows.find((x) => x.id === Number(id)) : null;
    const pics = row ? shown(row) : "";
    App.openSheet({
      title: row ? "Check the row" : "Add a row",
      body: `<div class="field"><label class="label" for="pr-pos">Customer code</label>
          ${row ? crop(row, "pos", 30, 320) : ""}
          <input class="input" id="pr-pos" value="${esc(row?.pos || "")}" autocomplete="off" inputmode="numeric" autocapitalize="characters"></div>
        <div id="prMatch" class="small muted" style="margin:-6px 0 12px">${matchText(row?.pos || "")}</div>
        ${pics ? `<div class="field"><div class="label">On the picture</div>${pics}</div>` : ""}
        <p class="hint" style="margin-top:0">Only the code is read. Name, address, city and route come from Customers.</p>`,
      footer: `${row ? `<button class="btn btn-outline" data-action="prDelete" data-id="${row.id}">${icon("trash", 16)} Delete row</button>` : `<button class="btn btn-outline" data-action="sheetCancel">Cancel</button>`}
        <button class="btn btn-primary" data-action="prSave" data-id="${row ? row.id : ""}">Save</button>`,
    });
  }
  App.onInput["pr-pos"] = (t) => { const m = $("#prMatch"); if (m) m.innerHTML = matchText(t.value); };

  async function saveRow(d) {
    const r = rd();
    const pos = ($("#pr-pos")?.value || "").trim().toUpperCase();
    if (!pos) return App.sheetErr("Enter the customer code.");
    const k = P().normAcc(pos);
    if (!r.byKey.has(k)) {
      App.sheetBusy(true);
      try {
        const found = await App.routeUpload.lookupCustomers([{ pos }]);
        for (const [key, v] of found) r.byKey.set(key, v);
      } catch (error) {
        App.sheetBusy(false);
        return App.sheetErr(`The code could not be looked up: ${App.route.reason(error)}`);
      }
      App.sheetBusy(false);
    }
    let row = d.id ? r.rows.find((x) => x.id === Number(d.id)) : null;
    if (!row) {
      row = { id: ++seq, img: null, name: "" };
      r.rows.push(row);
    }
    Object.assign(row, { pos, checked: true, codeFixed: false, conf: null });
    if (r.byKey.has(k)) { App.closeSheet(false); return App.render(); }
    // Not in Customers (decision 39): the driver types the details and saves a new customer.
    App.customers.openNew({ accountNumber: pos, accountName: "", accountAddress: "", city: "", route: "",
      note: `${pos} is not in Customers. Type the customer's details from the list, then save it as a new customer.`,
      pics: row.img == null ? null : { accountName: crop(row, "name", 30, 320), accountAddress: crop(row, "addr", 30, 320), city: crop(row, "city", 30, 320) },
    }, (c) => {
      row.pos = c.accountNumber;
      r.byKey.set(P().normAcc(c.accountNumber), [c]);
      App.render();
    });
    App.render();
  }

  function deleteRow(d) {
    const r = rd(), row = r.rows.find((x) => x.id === Number(d.id));
    if (!row) return;
    r.rows = r.rows.filter((x) => x !== row);
    App.closeSheet(false);
    App.snackbar(`Row ${row.pos || row.name || ""} deleted`);
    App.render();
  }

  function viewPicture(d) {
    const i = Number(d.i), p = rd().items[i];
    if (!p) return;
    App.openSheet({
      title: `Picture ${i + 1}`,
      tall: true,
      body: `<div class="small muted" style="margin:-4px 0 8px;overflow-wrap:anywhere">${esc(p.name)} · ${p.rows} row${p.rows === 1 ? "" : "s"} read</div>
        <div class="pic-view" id="picView"><img src="${p.url}" alt="Picture ${i + 1}"></div>`,
      footer: `<button class="btn btn-outline" data-action="picRemove" data-i="${i}">${icon("trash", 16)} Remove picture</button>
        <button class="btn btn-outline" data-action="picZoom">${icon("zoom", 16)} Zoom</button>`,
    });
  }

  // A wrong picture: it and the rows read from it go.
  function removePicture(d) {
    const r = rd(), i = Number(d.i);
    App.closeSheet(false);
    App.showConfirm({
      title: `Remove picture ${i + 1}?`, okText: "Remove", danger: true,
      msg: `The rows read from it go too (${r.rows.filter((x) => x.img === i).length}). Rows you added by hand stay.`,
      onOk: () => {
        URL.revokeObjectURL(r.items[i].url);
        r.rows = r.rows.filter((x) => x.img !== i).map((x) => (x.img != null && x.img > i ? { ...x, img: x.img - 1 } : x));
        r.items.splice(i, 1);
        App.render();
      },
    });
  }

  // Every row's details from Customers; no route from the list, so Customers' Route is used (decision 39).
  function done() {
    const r = rd();
    if (r.rows.some(blocked)) return;
    const rows = r.rows.map((x) => { const c = customerOf(x); return { pos: c.accountNumber, name: c.accountName, addr: c.accountAddress, city: c.city, prov: c.province, product: "", rte: "" }; });
    if (!rows.length) return;
    const n = r.items.length;
    App.routeUpload.useRows(rows, { file: n ? `${n} picture${n === 1 ? "" : "s"}` : "Rows typed in", kind: "pics", pics: { count: n } });
  }

  function cancel() {
    const u = up();
    forget(u.read);
    u.read = null;
    if (u.kind === "pics") Object.assign(u, { rows: null, an: null, kind: "", pics: null, file: null });
    App.go("upload");
  }

  App.SCREENS.readCheck = renderReadCheck;
  Object.assign(App.ACTIONS, {
    prEdit: (d) => openRow(d.id),
    prAdd: () => openRow(null),
    prSave: saveRow,
    prDelete: deleteRow,
    prDone: done,
    picView: viewPicture,
    picZoom: () => $("#picView")?.classList.toggle("zoom"),
    picRemove: removePicture,
    picsCancel: cancel,
    picsBack: () => App.go("readCheck"),
    picsPick: pick,
  });
  App.listPictures = { fromPdf };
})();
