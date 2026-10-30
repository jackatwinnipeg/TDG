/* Delivery lists from a PDF or from pictures (ROUTE_PROPOSAL.md 3.2.1, decisions 36-38).
 * A PDF's own text is read with pdf.js (js/vendor/pdfjs-6.4.299, loaded only when a PDF is
 * chosen). Pictures (screenshots, photos, the pages of a scanned PDF) are read in the app by
 * Google ML Kit on the phone (TdgNative.readText). Both give words with their place on the page;
 * rowsFrom() puts them into lines and columns, by the heading line (Cust. #, Customer, Address,
 * City) or, on a page without one, by the customer code at the start of each row.
 * Plain script: window.TDG_LIST_READ in the browser, module.exports in Node tests. */
(function (root) {
  "use strict";
  const P = () => root.TDG_ROUTE_PLAN || require("./route_plan.js");

  /* ---------------- words → lines → rows ---------------- */
  const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };

  // A tilted photo: the words are turned level first, by the median angle of the lines.
  function level(words) {
    const deg = median(words.filter((w) => typeof w.angle === "number").map((w) => w.angle));
    if (Math.abs(deg) < 0.5) return words;
    const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    return words.map((w) => {
      const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
      const dx = cx * cos + cy * sin - cx, dy = -cx * sin + cy * cos - cy;
      return { ...w, x0: w.x0 + dx, x1: w.x1 + dx, y0: w.y0 + dy, y1: w.y1 + dy };
    });
  }

  // Words → lines, top to bottom; each line's words left to right. A word: { str, x0, x1, y0, y1 } (y down).
  function toLines(words) {
    const ws = level(words.filter((w) => String(w.str || "").trim()))
      .map((w) => ({ ...w, str: String(w.str).trim(), yc: (w.y0 + w.y1) / 2, h: Math.max(1, w.y1 - w.y0) }))
      .sort((a, b) => a.yc - b.yc);
    const lines = [];
    for (const w of ws) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(w.yc - line.yc) <= 0.5 * Math.min(w.h, line.h) + 0.5) {
        line.words.push(w);
        line.yc += (w.yc - line.yc) / line.words.length;
      } else lines.push({ yc: w.yc, h: w.h, words: [w] });
    }
    for (const l of lines) {
      l.words.sort((a, b) => a.x0 - b.x0);
      l.h = median(l.words.map((w) => w.h));
    }
    return lines;
  }

  // Words joined: no space where the gap is tiny (one word in two pieces).
  function join(words) {
    let out = "";
    words.forEach((w, i) => { out += i && w.x0 - words[i - 1].x1 > 0.12 * w.h ? ` ${w.str}` : w.str; });
    return out.trim();
  }
  const boxOf = (words) => (words.length ? [Math.min(...words.map((w) => w.x0)), Math.min(...words.map((w) => w.y0)), Math.max(...words.map((w) => w.x1)), Math.max(...words.map((w) => w.y1))] : null);

  // Parts of a line split at wide gaps (between columns).
  function segments(words, h) {
    const out = [];
    for (const w of words) {
      const seg = out[out.length - 1];
      if (seg && w.x0 - seg[seg.length - 1].x1 <= 1.0 * h) seg.push(w);
      else out.push([w]);
    }
    return out;
  }

  // The heading line: at least two known column names, one of them the code or the address.
  // Names are matched word by word, the longest first ("Customer Name" before "Customer"), so
  // headings close together ("Stop  Cust. #") are still told apart.
  const headKey = (text) => P().columnOf(text) || (/^(stop|seq|no)$/i.test(text) ? "skip" : "");
  function headerOf(line) {
    const ws = line.words, cols = [];
    for (let i = 0; i < ws.length;) {
      let n = Math.min(3, ws.length - i), key = "";
      for (; n > 1 && !(key = headKey(join(ws.slice(i, i + n)))); n--);
      if (n === 1) key = headKey(ws[i].str);
      cols.push({ key, x0: ws[i].x0, x1: ws[i + n - 1].x1 });
      i += n;
    }
    const keys = new Set(cols.map((c) => c.key).filter((k) => k && k !== "skip"));
    if (keys.size < 2 || !(keys.has("pos") || keys.has("addr"))) return null;
    if (cols.filter((c) => c.key).length < cols.length * 0.6) return null;
    return cols.sort((a, b) => a.x0 - b.x0);
  }

  // A customer code: 6 to 10 digits, "-INST" allowed. In a picture, letters that look like
  // digits in a word that is mostly digits are read as the digits (O → 0, I → 1, S → 5, B → 8).
  function codeOf(text, ocr) {
    let t = String(text || "").trim().replace(/[.,;:]+$/, "");
    const inst = /-INST$/i.test(t);
    if (inst) t = t.slice(0, -5);
    let fixed = false;
    if (ocr && /\d/.test(t) && t.replace(/\D/g, "").length >= t.length * 0.7) {
      const u = t.replace(/[OoDQ]/g, "0").replace(/[Il|!]/g, "1").replace(/S/g, "5").replace(/B/g, "8");
      fixed = u !== t;
      t = u;
    }
    if (!/^\d{6,10}$/.test(t)) return null;
    return { code: t + (inst ? "-INST" : ""), fixed };
  }

  // The route of the whole list from its title: "80208z02, Week 8" → 80208z02 (Z02).
  function routeIn(text) {
    const m = /\b(\d{3,6})\s*z\s*[o0]?\s*([12])\b/i.exec(text);
    return m ? `${m[1]}z0${m[2]}` : "";
  }

  // One page (or picture) → rows. cols: the heading's columns from an earlier page of the same
  // PDF, or null. Returns { rows, cols, other } (other: the lines that are not rows, e.g. the title).
  function pageRows(page, { ocr = false, cols = null } = {}) {
    const rows = [], other = [];
    for (const line of toLines(page.words)) {
      const head = headerOf(line);
      if (head) { cols = head; continue; }
      const row = cols ? byColumns(line, cols, ocr) : byCode(line, ocr);
      if (row) rows.push(row);
      else other.push(join(line.words));
    }
    return { rows, cols, other };
  }

  // Each word into the column it overlaps most (the codes are right-aligned under "Cust. #").
  function byColumns(line, cols, ocr) {
    const parts = {};
    for (const w of line.words) {
      let best = -1, most = -Infinity;
      cols.forEach((c, i) => {
        const from = i ? c.x0 : -Infinity, to = i < cols.length - 1 ? cols[i + 1].x0 : Infinity;
        const overlap = Math.min(w.x1, to) - Math.max(w.x0, from);
        if (overlap > most) { most = overlap; best = i; }
      });
      const key = cols[best].key || "skip";
      (parts[key] ||= []).push(w);
    }
    // A row without a code needs an address and a city; a note running across the columns has neither.
    if (!parts.pos && !(parts.addr && parts.city)) return null;
    const row = makeRow(parts, ocr);
    if (ocr && row.pos) {
      const c = codeOf(row.pos, true);
      if (c) { row.codeFixed = c.fixed; row.pos = c.code; }
    }
    return row;
  }

  // Without a heading: the code is the first word that is a code; after it come the name, the
  // address and the city, split at the wide gaps. A line without a code is a title or a note,
  // unless it has a name, an address and a city "WINNIPEG, MB" (a row whose code was not read).
  function byCode(line, ocr) {
    const ws = line.words;
    let at = -1, code = null;
    for (let i = 0; i < ws.length && at < 0; i++) { code = codeOf(ws[i].str, ocr); if (code) at = i; }
    const rest = at >= 0 ? ws.slice(at + 1) : ws;
    const segs = segments(rest, line.h);
    const cityLike = (seg) => !!seg && !!P().splitCity(join(seg)).prov;
    if (at < 0 && !(segs.length >= 3 && cityLike(segs[segs.length - 1]))) return null;
    const parts = at >= 0 ? { pos: [ws[at]] } : {};
    if (segs.length >= 3) Object.assign(parts, { name: segs[0], addr: segs.slice(1, -1).flat(), city: segs[segs.length - 1] });
    else if (segs.length === 2) Object.assign(parts, cityLike(segs[1]) ? { name: segs[0], city: segs[1] } : { name: segs[0], addr: segs[1] });
    else if (segs.length === 1) parts.name = segs[0];
    const row = makeRow(parts, ocr);
    if (code) { row.pos = code.code; row.codeFixed = code.fixed; }
    return row;
  }

  function makeRow(parts, ocr) {
    const text = (k) => (parts[k] ? join(parts[k]) : "");
    const row = { pos: text("pos"), name: text("name"), addr: text("addr"), city: text("city"), prov: text("prov"), product: text("product"), rte: text("rte") };
    if (!row.prov) Object.assign(row, P().splitCity(row.city));
    // Italic rows in the PDF are carryovers needing fills (decision 38).
    const all = Object.entries(parts).filter(([k]) => k !== "skip").flatMap(([, ws]) => ws);
    const chars = (ws) => ws.reduce((n, w) => n + w.str.length, 0);
    if (!ocr && chars(all.filter((w) => w.italic)) > chars(all) / 2) row.carry = true;
    if (ocr) {
      row.boxes = Object.fromEntries(["pos", "name", "addr", "city"].filter((k) => parts[k]).map((k) => [k, boxOf(parts[k])]));
      const conf = (parts.pos || []).map((w) => w.conf).filter((c) => typeof c === "number");
      if (conf.length) row.conf = Math.min(...conf);
    }
    return row;
  }

  // Pages of one document (or the pictures of one list, ocr: true) → { rows, rte }. A PDF's later
  // pages keep the columns of the heading on its first page; each picture finds its own.
  function rowsFrom(pages, { ocr = false } = {}) {
    let cols = null;
    const rows = [], other = [];
    pages.forEach((page, i) => {
      const r = pageRows(page, { ocr, cols: ocr ? null : cols });
      if (!ocr) cols = r.cols;
      r.rows.forEach((row) => { if (ocr) row.img = i; rows.push(row); });
      other.push(...r.other);
    });
    const rte = other.map(routeIn).find(Boolean) || "";
    if (rte) rows.forEach((r) => { if (!r.rte) r.rte = rte; });
    return { rows, rte };
  }

  // Rows read from several pictures: a customer on two pictures (they overlap) is kept once.
  function dedupe(rows) {
    const seen = new Set(), out = [];
    let twice = 0;
    for (const r of rows) {
      const k = P().normAcc(r.pos);
      if (k && seen.has(k)) { twice++; continue; }
      if (k) seen.add(k);
      out.push(r);
    }
    return { rows: out, twice };
  }

  // How alike two texts are, 0 to 1 (edit distance), for misread names and addresses.
  function likeness(a, b) {
    a = String(a || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
    b = String(b || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
    if (!a || !b) return 0;
    if (a === b) return 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[b.length] / Math.max(a.length, b.length);
  }

  /* ---------------- PDF (browser only) ---------------- */
  const BASE = (() => {
    if (typeof __dirname !== "undefined") return require("url").pathToFileURL(`${__dirname}/vendor/pdfjs-6.4.299/`).href; // Node tests
    try { return new URL("./vendor/pdfjs-6.4.299/", root.document.currentScript.src).href; } catch { return "./js/vendor/pdfjs-6.4.299/"; }
  })();
  let lib = null;
  async function pdfjs() {
    if (!lib) {
      lib = await import(`${BASE}pdf.min.mjs`);
      lib.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.min.mjs`;
    }
    return lib;
  }

  async function openPdf(buffer) {
    const { getDocument } = await pdfjs();
    try {
      return await getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, fontExtraProperties: true, disableFontFace: true, wasmUrl: `${BASE}wasm/`, verbosity: 0 }).promise;
    } catch (error) {
      throw new Error(error?.name === "PasswordException" ? "The PDF is protected with a password." : "The PDF could not be opened. It may be damaged.");
    }
  }

  const close = (doc) => { try { (doc.loadingTask || doc).destroy(); } catch { /* already closed */ } };

  const ITALIC = /italic|oblique|-it$|-boldit$/i;
  // Every page's text as words with their place (y down), and whether the font is italic.
  async function pdfWords(doc) {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const items = (await page.getTextContent()).items.filter((it) => it.str && it.str.trim());
      const fonts = {};
      if (items.length) {
        await page.getOperatorList(); // loads the fonts, for their names
        for (const id of new Set(items.map((it) => it.fontName))) {
          try { fonts[id] = String(page.commonObjs.get(id)?.name || "").replace(/^[A-Z]{6}\+/, ""); } catch { fonts[id] = ""; }
        }
      }
      const words = [];
      for (const it of items) {
        const [, b, , d, e, f] = lib.Util.transform(vp.transform, it.transform);
        const h = Math.hypot(b, d) || 10, italic = ITALIC.test(fonts[it.fontName] || "");
        // An item can hold several words ("MCDONALDS 41363"): each gets its share of the width.
        const cw = it.width / Math.max(1, it.str.length);
        for (const m of it.str.matchAll(/\S+/g)) {
          words.push({ str: m[0], x0: e + m.index * cw, x1: e + (m.index + m[0].length) * cw, y0: f - 0.8 * h, y1: f + 0.2 * h, italic });
        }
      }
      pages.push({ words, width: vp.width, height: vp.height });
    }
    return pages;
  }

  // A PDF list → { rows, rte, pages } or { scanned: true, doc } when it has no text (a scan:
  // the app reads its pages as pictures) or { error }.
  async function readPdf(buffer) {
    const doc = await openPdf(buffer);
    const pages = await pdfWords(doc);
    if (!pages.some((p) => p.words.length)) return { scanned: true, doc };
    const { rows, rte } = rowsFrom(pages);
    const list = rows.filter((r) => r.pos || r.addr);
    close(doc);
    if (!list.length) return { error: "No customers were found in this PDF. It needs the columns Cust. # (or Position) and Address." };
    return { rows: list, rte, pages: pages.length };
  }

  // The pages of a scanned PDF as pictures (JPEG), about 2000 px wide, for text recognition.
  async function pdfPictures(doc, max = 20) {
    const out = [];
    for (let n = 1; n <= Math.min(doc.numPages, max); n++) {
      const page = await doc.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(4, 2000 / vp1.width) });
      const canvas = root.document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const g = canvas.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: g, canvas, viewport: vp }).promise;
      out.push(await new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("A page of the PDF could not be drawn."))), "image/jpeg", 0.92)));
      canvas.width = canvas.height = 0;
    }
    close(doc);
    return out;
  }

  const api = { toLines, headerOf, codeOf, routeIn, pageRows, rowsFrom, dedupe, likeness, readPdf, pdfPictures };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TDG_LIST_READ = api;
})(typeof window !== "undefined" ? window : globalThis);
