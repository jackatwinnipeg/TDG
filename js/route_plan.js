/* Route planning (ROUTE_PROPOSAL.md 3.2, 3.3, 3.5): reading a delivery list's codes, routes and
 * addresses, and splitting stops into days and ordering each day by driving time. The driving
 * times come from openrouteservice's Matrix through the tdg-route Edge Function; the split and
 * the order are ours (3.8.1: its Optimization takes only 3 vehicles and 50 points).
 * Plain script: window.TDG_ROUTE_PLAN in the browser, module.exports in Node tests. */
(function (root) {
  "use strict";

  /* ---------------- list rows ---------------- */
  // Codes match with or without "-INST", in any case (decision 24).
  const normAcc = (v) => String(v || "").trim().toUpperCase().replace(/-INST$/, "").trim();

  // "80208z02" → Z02, "…z01" → Z01; anything else has no route (3.2).
  function routeOf(rte) {
    const m = /z0?([12])\s*$/i.exec(String(rte || "").trim());
    return m ? `Z0${m[1]}` : "";
  }

  // The unit in front of the street address is left out before looking up a position:
  // "160, 1225 St Mary's Road", "Unit 5, 12 Main St", "5-123 Main St" (3.8).
  function stripUnit(addr) {
    let a = String(addr || "").trim();
    a = a.replace(/^\s*(?:(?:unit|suite|ste|apt)\b|#)\s*[\w-]+\s*,?\s*/i, ""); // not the "Ste" of "Sterling"
    a = a.replace(/^\s*[\w-]{1,8}\s*,\s*(?=\d)/, "");
    a = a.replace(/^\s*\d+[a-z]?\s*-\s*(?=\d)/i, "");
    return a.trim();
  }

  // Addresses compared without case, punctuation, units, "Saint"/"St" and street types, so
  // "1124 St Marys Road" and "1124 St. Mary's Rd" are the same and only real differences ask (3.2).
  const WORDS = { saint: "st", street: "", st: "", road: "", rd: "", avenue: "", ave: "", av: "", boulevard: "", blvd: "", drive: "", dr: "",
    crescent: "", cres: "", highway: "hwy", place: "", pl: "", lane: "", ln: "", court: "", ct: "", way: "", trail: "", trl: "", parkway: "", pkwy: "",
    square: "", sq: "", circle: "", cir: "", terrace: "", ter: "",
    east: "e", west: "w", north: "n", south: "s" };
  function normAddr(addr) {
    const words = stripUnit(addr).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
    // "St" right after the house number is "Saint" (St Mary's); elsewhere it is "Street".
    return words.map((w, i) => (w === "st" && i > 0 && /^\d/.test(words[i - 1]) ? "saint" : w))
      .map((w) => (w in WORDS ? WORDS[w] : w)).filter(Boolean).join(" ");
  }
  const sameAddress = (a, b) => normAddr(a) === normAddr(b);

  // One list row from a sheet row: columns by name, in any order (3.2). CO2-CC 1/2 are not read.
  // The PDF list (3.2.1) calls them Cust. #, Customer, Address and City ("WINNIPEG, MB").
  const COLS = {
    pos: ["position", "account number", "accountnumber", "account no", "account", "account #", "cust #", "cust no", "customer #", "customer no", "customer number", "acct #"],
    name: ["customer name", "name", "account name", "customer"],
    addr: ["address", "account address"],
    city: ["city"],
    prov: ["state/prov", "province", "prov"],
    product: ["product"],
    rte: ["co2 rte", "route", "rte"],
    carry: ["carryover"],
  };
  // "Cust. #" and "cust #" are the same heading.
  const headName = (h) => String(h || "").trim().toLowerCase().replace(/[.:]/g, "").replace(/\s*#\s*/g, " #").replace(/\s+/g, " ").trim();
  const columnOf = (h) => { const n = headName(h); return Object.keys(COLS).find((k) => COLS[k].includes(n)) || ""; };
  // "WINNIPEG, MB" → city WINNIPEG, province MB, when the list has no province column.
  const PROVINCES = "AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT";
  function splitCity(text) {
    const m = new RegExp(`^(.*?)(?:\\s*,\\s*|\\s+)(${PROVINCES})\\.?$`, "i").exec(String(text || "").trim());
    return m && m[1] ? { city: m[1].trim(), prov: m[2].toUpperCase() } : { city: String(text || "").trim(), prov: "" };
  }
  function readList(table) {
    if (!table.length) return { error: "The file has no rows." };
    const head = table[0].map(columnOf);
    const at = {};
    for (const k of Object.keys(COLS)) at[k] = head.indexOf(k);
    if (at.pos < 0 || at.addr < 0) return { error: "This is not a delivery list: the Position and Address columns are missing." };
    const rows = [];
    for (const r of table.slice(1)) {
      const get = (k) => (at[k] >= 0 ? String(r[at[k]] ?? "").trim() : "");
      const row = { pos: get("pos"), name: get("name"), addr: get("addr"), city: get("city"), prov: get("prov"), product: get("product"), rte: get("rte") };
      if (!row.pos && !row.addr) continue;
      if (!row.prov) Object.assign(row, splitCity(row.city));
      if (/^(yes|y|true|1)$/i.test(get("carry"))) row.carry = true;
      rows.push(row);
    }
    if (!rows.length) return { error: "The file has no customers." };
    return { rows };
  }

  // Two lists for the same week (one received, one the driver's own): each customer once (decision 34).
  function mergeLists(theirs, mine) {
    const key = (r) => normAcc(r.pos) || `addr:${normAddr(r.addr)}`;
    const seen = new Set(theirs.map(key));
    const own = new Set(mine.map(key));
    return {
      rows: theirs.concat(mine.filter((r) => !seen.has(key(r)))),
      both: mine.filter((r) => seen.has(key(r))).length,
      mine: mine.filter((r) => !seen.has(key(r))).length,
      theirs: theirs.filter((r) => !own.has(key(r))).length,
    };
  }

  /* ---------------- distances ---------------- */
  const RAD = Math.PI / 180;
  // Straight line × road factor at about 30 km/h: only when the real driving time is not known yet.
  function estimate(a, b) {
    const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
    const km = 6371 * 2 * Math.asin(Math.sqrt(h)) * 1.35;
    return { s: (km / 30) * 3600, m: km * 1000 };
  }
  const pointKey = (p) => `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`;

  // Driving time (s) and distance (m) between points, from Matrix results kept by point.
  function costTable(known = {}) {
    const get = (a, b) => {
      if (!a || !b || a.lat == null || b.lat == null) return { s: 0, m: 0 };
      const ka = pointKey(a), kb = pointKey(b);
      if (ka === kb) return { s: 0, m: 0 };
      return known[`${ka}>${kb}`] || estimate(a, b);
    };
    return {
      get,
      s: (a, b) => get(a, b).s,
      // Results of one Matrix call: points in order, durations[i][j] seconds, distances[i][j] metres.
      add(points, durations, distances) {
        points.forEach((a, i) => points.forEach((b, j) => {
          if (i === j || durations?.[i]?.[j] == null) return;
          known[`${pointKey(a)}>${pointKey(b)}`] = { s: durations[i][j], m: distances?.[i]?.[j] ?? estimate(a, b).m };
        }));
      },
      has: (a, b) => `${pointKey(a)}>${pointKey(b)}` in known,
      known,
    };
  }

  /* ---------------- ordering ---------------- */
  function pathCost(cost, start, list, end) {
    let t = 0, p = start;
    for (const q of list) { if (q.lat != null) { t += cost.s(p, q); p = q; } }
    return t + (end ? cost.s(p, end) : 0);
  }

  // Shortest drive from start through every stop to end: nearest neighbour, then 2-opt and
  // or-opt (moving one to three stops) until nothing improves. Start and end stay put.
  function orderStops(cost, start, stops, end) {
    const located = stops.filter((s) => s.lat != null), unknown = stops.filter((s) => s.lat == null);
    const left = located.slice(), out = [];
    let cur = start;
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((p, i) => { const d = cost.s(cur, p); if (d < bd) { bd = d; bi = i; } });
      cur = left.splice(bi, 1)[0];
      out.push(cur);
    }
    let best = pathCost(cost, start, out, end);
    for (let round = 0, improved = true; improved && round < 50; round++) {
      improved = false;
      for (let i = 0; i < out.length - 1; i++) {
        for (let j = i + 1; j < out.length; j++) {
          const cand = out.slice(0, i).concat(out.slice(i, j + 1).reverse(), out.slice(j + 1));
          const c = pathCost(cost, start, cand, end);
          if (c + 1e-6 < best) { out.splice(0, out.length, ...cand); best = c; improved = true; }
        }
      }
      for (let len = 1; len <= 3; len++) {
        for (let i = 0; i + len <= out.length; i++) {
          const seg = out.slice(i, i + len), rest = out.slice(0, i).concat(out.slice(i + len));
          for (let k = 0; k <= rest.length; k++) {
            if (k === i) continue;
            const cand = rest.slice(0, k).concat(seg, rest.slice(k));
            const c = pathCost(cost, start, cand, end);
            if (c + 1e-6 < best) { out.splice(0, out.length, ...cand); best = c; improved = true; }
          }
        }
      }
    }
    return out.concat(unknown); // stops without a position go last until they are found
  }

  // Day sizes as even as possible: 35 stops in 4 days → 9, 9, 9, 8.
  const evenSizes = (n, days) => Array.from({ length: days }, (_, i) => Math.floor(n / days) + (i < n % days ? 1 : 0));

  /* ---------------- same side of the street (decisions 49–52) ---------------- */
  // House number and street of an address: "160, 1225 St Mary's Road" → 1225 on "st marys".
  function streetOf(addr) {
    const m = /^(\d+)[a-z]?\s+(.+)$/.exec(normAddr(addr));
    return m ? { no: Number(m[1]), street: m[2] } : null;
  }
  const sideKey = (s) => { const a = s.lat == null ? null : streetOf(s.addr); return a ? `${a.street}|${a.no % 2}` : null; };
  const unit = (members, free) => ({ members, first: members[0], last: members[members.length - 1], size: members.length, free,
    lat: members.reduce((t, s) => t + s.lat, 0) / members.length, lng: members.reduce((t, s) => t + s.lng, 0) / members.length });

  // Located stops on one street with odd (or even) house numbers are on one side of it: one group,
  // driven in one pass in house-number order, the way that keeps them on the right. curbOf(stop) is
  // the customer's curb bearing (degrees, the way to drive with the customer on the right) when known;
  // most of the group decides, and a group with none is driven whichever way is shorter (free). A
  // group longer than `max` stops is cut into even runs in number order (decision 52).
  function sideGroups(stops, curbOf = () => null, max = Infinity) {
    const by = new Map();
    stops.forEach((s, i) => { const k = sideKey(s) ?? i; by.set(k, (by.get(k) || []).concat(s)); });
    const units = [];
    for (const list of by.values()) {
      const run = list.sort((a, b) => streetOf(a.addr).no - streetOf(b.addr).no || 0);
      const f = run[0], l = run[run.length - 1], dx = (l.lng - f.lng) * Math.cos(f.lat * RAD), dy = l.lat - f.lat;
      let vote = 0; // up the numbers (dx, dy) against each known bearing
      for (const s of run) { const b = curbOf(s); if (b != null) vote += Math.sign(dx * Math.sin(b * RAD) + dy * Math.cos(b * RAD)); }
      if (vote < 0) run.reverse();
      let k = 0;
      for (const n of evenSizes(run.length, Math.max(1, Math.ceil(run.length / max)))) { units.push(unit(run.slice(k, k + n), run.length > 1 && !vote)); k += n; }
    }
    return units;
  }
  // Between groups: from one group's last stop to the next one's first; inside a group the order is fixed.
  const unitCost = (cost) => ({ s: (a, b) => cost.s(a.last || a, b.first || b) });
  const inner = (cost, u) => u.members.reduce((t, s, i) => (i ? t + cost.s(u.members[i - 1], s) : t), 0);
  // Groups with no known side are driven whichever way is shorter there.
  function flipFree(cost, start, units, end) {
    return units.map((u, i, all) => {
      if (!u.free) return u;
      const r = unit(u.members.slice().reverse(), true), a = i ? all[i - 1].last : start, b = all[i + 1]?.first || end;
      const c = (x) => cost.s(a, x.first) + inner(cost, x) + (b ? cost.s(x.last, b) : 0);
      return c(r) < c(u) ? r : u;
    });
  }
  const expand = (units) => units.flatMap((u) => u.members);

  // One day's stops in the shortest order that keeps each same-side group together (decision 49).
  function orderDay(cost, start, stops, end, curbOf) {
    const located = stops.filter((s) => s.lat != null), unknown = stops.filter((s) => s.lat == null);
    return expand(flipFree(cost, start, orderStops(unitCost(cost), start, sideGroups(located, curbOf), end), end)).concat(unknown);
  }

  // Stops split into `days` days of even size, near ones together, each same-side group on one day
  // (3.3, decisions 44, 49): the groups swept around the start point and around the stops' centre,
  // every rotation tried; then groups moved or swapped between days while the total drive gets shorter.
  // `until` (a Date.now() time) stops the search with the best plan found so far, so a long list on a
  // slow phone still finishes (owner's choice 2026-10-28).
  function splitDays(cost, start, end, stops, days, { curbOf, until = Infinity } = {}) {
    if (days <= 1) return [orderDay(cost, start, stops, end, curbOf)];
    const late = () => Date.now() > until;
    const located = stops.filter((s) => s.lat != null), unknown = stops.filter((s) => s.lat == null);
    const sizes = evenSizes(located.length, days), lo = sizes[days - 1], hi = sizes[0], U = unitCost(cost);
    let units;
    const size = (g) => g.reduce((t, u) => t + u.size, 0);
    const order = (g) => orderStops(U, start, g, end);
    // A day off the even sizes costs more than any drive, so the search puts that right first.
    const dayCost = (g) => (g.length ? pathCost(U, start, g, end) + g.reduce((t, u) => t + inner(cost, u), 0) : 0) + 1e7 * Math.max(0, lo - size(g), size(g) - hi);
    function sweep(c) {
      const ang = (p) => Math.atan2(p.lat - c.lat, (p.lng - c.lng) * Math.cos(c.lat * RAD));
      const sorted = units.slice().sort((a, b) => ang(a) - ang(b));
      let best = { gs: sizes.map(() => []), total: Infinity };
      for (let r = 0; r < sorted.length && !(r && late()); r++) {
        const gs = sizes.map(() => []);
        let d = 0;
        for (const u of sorted.slice(r).concat(sorted.slice(0, r))) {
          if (d < days - 1 && size(gs[d]) + u.size > sizes[d] && size(gs[d]) >= sizes[d] - 1) d++;
          gs[d].push(u);
        }
        const ordered = gs.map(order), total = ordered.reduce((t, g) => t + dayCost(g), 0);
        if (total < best.total) best = { gs: ordered, total };
      }
      return best;
    }
    // Quick guess of a day's cost with group i taken out and `add` put in at its cheapest place; only
    // guesses within 2 minutes of a gain are ordered properly (orderStops is the slow part).
    function guess(g, i, add) {
      const rest = i < 0 ? g : g.filter((_, k) => k !== i);
      let c = dayCost(rest) - 1e7 * Math.max(0, lo - size(rest), size(rest) - hi), ins = 0;
      if (add) {
        ins = Infinity;
        for (let k = 0; k <= rest.length; k++) {
          const p = k ? rest[k - 1] : start, q = rest[k] || end;
          ins = Math.min(ins, U.s(p, add) + (q ? U.s(add, q) - U.s(p, q) : 0));
        }
        c += ins + inner(cost, add);
      }
      const n = size(rest) + (add ? add.size : 0);
      return c + 1e7 * Math.max(0, lo - n, n - hi);
    }
    function improve({ gs }) {
      const cs = gs.map(dayCost);
      for (let pass = 0, better = true; better && pass < 30 && !late(); pass++) {
        better = false;
        for (let a = 0; a < days; a++) for (let b = 0; b < days; b++) {
          if (a === b || late()) continue;
          for (let i = 0; i < gs[a].length; i++) {
            // group i moves from day a to day b, or (once per pair of days) swaps with one of b's
            for (let j = -1; j < (a < b ? gs[b].length : 0); j++) {
              const x = gs[a][i], y = gs[b][j];
              if (guess(gs[a], i, y) + guess(gs[b], j, x) > cs[a] + cs[b] + 120) continue;
              const na = order(gs[a].filter((_, k) => k !== i).concat(y ? [y] : [])), nb = order(gs[b].filter((_, k) => k !== j).concat(x));
              const ca = dayCost(na), cb = dayCost(nb);
              if (ca + cb + 1 < cs[a] + cs[b]) { gs[a] = na; gs[b] = nb; cs[a] = ca; cs[b] = cb; better = true; break; }
            }
          }
        }
      }
      return { gs, total: cs.reduce((t, c) => t + c, 0) };
    }
    const centre = located.length ? { lat: located.reduce((t, s) => t + s.lat, 0) / located.length, lng: located.reduce((t, s) => t + s.lng, 0) / located.length } : start;
    // Groups too big for a day are cut (decision 52); when the groups still cannot make even days,
    // they are cut into ever shorter runs, down to single stops, which always fit (at once when late).
    let best;
    for (let max = hi; ; max = late() ? 1 : Math.ceil(max / 2)) {
      units = sideGroups(located, curbOf, max);
      best = [start, centre].map((c) => improve(sweep(c))).reduce((a, b) => (b.total < a.total ? b : a));
      if (best.total < 1e7 || max === 1) break;
    }
    // Each day ordered again, so runs of one group that ended on the same day join up.
    const groups = best.gs.map((g) => orderDay(cost, start, expand(g), end, curbOf));
    // Stops without a position are shared out after the others, smallest day first.
    for (const s of unknown) groups.reduce((a, b) => (b.length < a.length ? b : a)).push(s);
    return groups;
  }

  // Where one more stop adds the least driving between `from` and `end` (Emergency Call, moved stop).
  // With same-side stops already on the day it goes in among them, in house-number order (decision 49).
  function cheapestIndex(cost, from, list, end, s) {
    const k = sideKey(s), mates = k ? list.flatMap((x, i) => (sideKey(x) === k ? [i] : [])) : [];
    const no = (i) => streetOf(list[i].addr).no, up = mates.length > 1 && no(mates[1]) > no(mates[0]);
    const at = mates.length > 1 ? [mates.find((i) => (up ? no(i) > streetOf(s.addr).no : no(i) < streetOf(s.addr).no)) ?? mates[mates.length - 1] + 1]
      : mates.length ? [mates[0], mates[0] + 1] : list.map((_, i) => i).concat(list.length);
    let bi = list.length, bc = Infinity;
    for (const i of at) {
      const a = i === 0 ? from : list[i - 1], b = i === list.length ? end : list[i];
      if (!b) { const c = cost.s(a, s); if (c < bc) { bc = c; bi = i; } continue; }
      const c = cost.s(a, s) + cost.s(s, b) - cost.s(a, b);
      if (c < bc) { bc = c; bi = i; }
    }
    return bi;
  }

  // Each stop's drive from the one before, and the drive back to the end.
  function legs(cost, start, list, end) {
    let prev = start, s = 0, m = 0;
    const rows = list.map((stop) => {
      const g = stop.lat == null ? { s: 0, m: 0 } : cost.get(prev, stop);
      if (stop.lat != null) prev = stop;
      s += g.s; m += g.m;
      return { stop, s: g.s, m: g.m };
    });
    const back = end ? cost.get(prev, end) : { s: 0, m: 0 };
    return { rows, back, s: s + back.s, m: m + back.m };
  }

  // Points whose driving times are not known yet (one Matrix call covers them all).
  function missingPoints(cost, points) {
    const ps = [];
    const seen = new Set();
    for (const p of points) {
      if (!p || p.lat == null) continue;
      const k = pointKey(p);
      if (!seen.has(k)) { seen.add(k); ps.push(p); }
    }
    for (const a of ps) for (const b of ps) if (a !== b && !cost.has(a, b)) return ps;
    return [];
  }

  const api = { normAcc, routeOf, stripUnit, normAddr, sameAddress, columnOf, splitCity, readList, mergeLists, estimate, pointKey, costTable, pathCost,
    orderStops, evenSizes, streetOf, sideGroups, orderDay, splitDays, cheapestIndex, legs, missingPoints };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TDG_ROUTE_PLAN = api;
})(typeof window !== "undefined" ? window : globalThis);
