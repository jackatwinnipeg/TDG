/* CSV reading shared by the Customers import (js/app/customers.js). The current site's parser
 * (js/admin.js parseCsv): quoted commas, quotes and new lines; a bad quote, an empty or repeated
 * header, or a row with a different number of cells is refused instead of guessed. */
(() => {
  "use strict";
  // Rows as objects keyed by the header row's names (cells trimmed).
  function parse(text) {
    const source = String(text ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    let field = "", row = [], quoted = false, closed = false;
    const rows = [];
    const pushField = () => { row.push(field.trim()); field = ""; closed = false; };
    const pushRow = () => { pushField(); if (row.some(Boolean)) rows.push(row); row = []; };
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"') {
          if (source[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; }
        } else field += ch;
      } else if (ch === ",") pushField();
      else if (ch === "\n") pushRow();
      else if (ch === '"' && !field && !closed) quoted = true;
      else {
        if ((closed && ch.trim()) || ch === '"') throw new Error("Invalid CSV quote");
        field += ch;
      }
    }
    if (quoted) throw new Error("Unclosed CSV quote");
    if (field || row.length || closed) pushRow();
    if (!rows.length) return [];
    const header = rows.shift();
    if (header.some((h) => !h) || new Set(header).size !== header.length) throw new Error("Invalid CSV headers");
    return rows.map((cells, i) => {
      if (cells.length !== header.length) throw new Error(`CSV row ${i + 2}: wrong column count`);
      return Object.fromEntries(header.map((h, j) => [h, cells[j]]));
    });
  }
  window.TDG_CSV = { parse };
})();
