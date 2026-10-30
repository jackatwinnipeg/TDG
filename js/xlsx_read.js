/* Reads the first worksheet of an Excel .xlsx file into rows of cell text (delivery lists,
 * ROUTE_PROPOSAL.md 3.2). An .xlsx file is a zip of XML files: the zip is read here and its
 * parts unpacked with the browser's DecompressionStream; no library is needed.
 * window.TDG_XLSX.readXlsx(arrayBuffer) → Promise<string[][]> */
(function (root) {
  "use strict";

  // Zip entries from the central directory: name → { method, offset, size }.
  function entries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error("This is not an Excel (.xlsx) file.");
    const count = view.getUint16(end + 10, true);
    let p = view.getUint32(end + 16, true);
    const out = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error("The Excel file is damaged.");
      const method = view.getUint16(p + 10, true);
      const size = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      out[name] = { method, local, size };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  async function read(bytes, entry) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
    const data = bytes.subarray(start, start + entry.size);
    if (entry.method === 0) return new TextDecoder().decode(data);
    if (entry.method !== 8) throw new Error("The Excel file uses a packing this app cannot read.");
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  }

  const xml = (text) => new DOMParser().parseFromString(text, "application/xml");
  const kids = (el, name) => Array.from(el.getElementsByTagNameNS("*", name));
  // Text of an <si> or <is>: plain <t>, or the <t> of each rich-text run.
  const textOf = (el) => kids(el, "t").filter((t) => !t.closest || !t.parentElement || t.parentElement.localName !== "rPh").map((t) => t.textContent).join("");
  // "BC12" → 54 (0-based column).
  function colIndex(ref) {
    const letters = /^[A-Z]+/i.exec(ref || "")?.[0].toUpperCase() || "A";
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  async function readXlsx(buffer) {
    const bytes = new Uint8Array(buffer);
    const zip = entries(bytes);
    const part = async (name) => (zip[name] ? read(bytes, zip[name]) : null);
    if (!zip["xl/workbook.xml"]) throw new Error("This is not an Excel (.xlsx) file.");
    // The first sheet in the workbook, through its relationship.
    const book = xml(await part("xl/workbook.xml"));
    const first = kids(book, "sheet")[0];
    let path = "xl/worksheets/sheet1.xml";
    const rid = first?.getAttribute("r:id") || first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const relsText = await part("xl/_rels/workbook.xml.rels");
    if (rid && relsText) {
      const rel = kids(xml(relsText), "Relationship").find((r) => r.getAttribute("Id") === rid);
      const target = rel?.getAttribute("Target");
      if (target) path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    }
    const sstText = await part("xl/sharedStrings.xml");
    const shared = sstText ? kids(xml(sstText), "si").map(textOf) : [];
    const sheetText = await part(path);
    if (!sheetText) throw new Error("The Excel file has no worksheet.");
    const rows = [];
    for (const row of kids(xml(sheetText), "row")) {
      const r = Number(row.getAttribute("r") || rows.length + 1) - 1;
      const cells = [];
      for (const c of kids(row, "c")) {
        const t = c.getAttribute("t") || "n";
        const v = kids(c, "v")[0]?.textContent ?? "";
        let value;
        if (t === "s") value = shared[Number(v)] ?? "";
        else if (t === "inlineStr") value = textOf(kids(c, "is")[0] || c);
        else if (t === "b") value = v === "1" ? "TRUE" : "FALSE";
        else value = v;
        cells[colIndex(c.getAttribute("r"))] = String(value);
      }
      rows[r] = Array.from(cells, (x) => x ?? "");
    }
    return Array.from(rows, (x) => x || []);
  }

  root.TDG_XLSX = { readXlsx };
})(typeof window !== "undefined" ? window : globalThis);
