// ---------------------------
// Utilities
// ---------------------------
const $ = window.$ || ((id) => document.getElementById(id));
window.$ = $;

// Clear customer/account fields for the next delivery record
function resetAccountFieldsForNextRecord() {
  const ids = [
    "accountNumber",
    "accountName",
    "accountAddress",
    "accountCity",
    "accountRoute",
    "deliveredVolume",
    "notes",
  ];
  ids.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.value = id === "deliveredVolume" ? 0 : "";
  });

  const q = $("searchBox");
  if (q) q.value = "";
  const res = $("resultBox");
  if (res) {
    res.innerHTML = `
      <h3 style="margin: 0 0 8px 0;">Search result shows here</h3>
      <div class="muted">请搜索/填写下一个客户。</div>
    `;
  }

  $("accountNumber")?.focus();
}

function toast(title, msg) {
  const toastEl = $("toast");
  const titleEl = $("toastTitle");
  const msgEl = $("toastMsg");

  if (!toastEl || !titleEl || !msgEl) return;

  titleEl.textContent = title;
  msgEl.textContent = msg;
  toastEl.style.display = "block";

  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    toastEl.style.display = "none";
  }, 2200);
}

function setStatus(text) {
  const statusEl = $("statusTag");
  if (statusEl) statusEl.textContent = "Status：" + text;
}

function setPill(pillId, on) {
  const el = $(pillId);
  if (!el) return;
  if (on) {
    el.classList.remove("off");
  } else {
    el.classList.add("off");
  }
}

document.addEventListener(
  "dblclick",
  (e) => {
    if (e.target.closest("button")) e.preventDefault();
  },
  { passive: false },
);

// ---------------------------
// Local date helpers
// ---------------------------
function tdgLocalDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tdgLocalDateTimeISO() {
  return new Date().toISOString();
}

// ---------------------------
// State: Arrive + Shift time
// ---------------------------
let isArrived = false;
let arrivalTime = "";

let shiftStart = "";
let shiftFinish = "";

function nowHHMM() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function renderArrivalUI() {
  setPill("arrivePill", isArrived);

  const deliveredVolume = $("deliveredVolume");
  const btnArrive = $("btnArrive");
  const arrivalTimeText = $("arrivalTimeText");

  if (deliveredVolume) deliveredVolume.disabled = !isArrived;
  if (btnArrive) btnArrive.disabled = isArrived;
  if (arrivalTimeText) {
    arrivalTimeText.textContent = `Arrival Time：${arrivalTime || "—"}`;
  }

  setStatus(isArrived ? "Arrived" : "Driving");
}

function renderShiftTime() {
  const s = shiftStart || "—";
  const f = shiftFinish || "—";
  const shiftTimeText = $("shiftTimeText");
  if (shiftTimeText) {
    shiftTimeText.textContent = `Shift Time：${s} → ${f}`;
  }
}

// ---------------------------
// LocalStorage keys
// ---------------------------
const LS_CUSTOMERS = "tdg_customers_demo_v2";
const LS_CUSTOMERS_FALLBACK = "tdg_customers_demo_v3";
const LS_PROFILE = "tdg_user_profile_v3";
const LS_YESTERDAY_BASE = "tdg_yesterday_v3";
const LS_YESTERDAY_LEGACY = "tdg_yesterday_v3";
const LS_DRAFT = "tdg_draft_v3";
const LS_CYCLE = "tdg_week_cycle_v3";
const LS_RECORDS = "tdg_records_v3";
const LS_PENDING_SYNC = "tdg_pending_sync_v1";

// ---------------------------
// Per-driver Yesterday
// ---------------------------
function getDriverKeySafe() {
  const s = getAuthSessionSafe();
  return (s?.driverNumber || s?.username || "").trim() || "unknown";
}

function getYesterdayKey(driverKey) {
  const k = String(driverKey || "unknown").trim() || "unknown";
  return `${LS_YESTERDAY_BASE}__${k}`;
}

function migrateLegacyYesterdayIfAny(driverKey) {
  try {
    const perKey = getYesterdayKey(driverKey);
    if (localStorage.getItem(perKey)) return;
    const legacy = localStorage.getItem(LS_YESTERDAY_LEGACY);
    if (!legacy) return;
    localStorage.setItem(perKey, legacy);
  } catch {}
}

function loadYesterdayForDriver(driverKey) {
  try {
    const k = getYesterdayKey(driverKey);
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveYesterdayForDriver(driverKey, data) {
  try {
    const k = getYesterdayKey(driverKey);
    localStorage.setItem(k, JSON.stringify(data));
  } catch {}
}

// ---------------------------
// Helper functions
// ---------------------------
function getCustomers() {
  try {
    const raw = localStorage.getItem(LS_CUSTOMERS);
    if (raw) return JSON.parse(raw);

    const old = localStorage.getItem(LS_CUSTOMERS_FALLBACK);
    if (old) {
      const list = JSON.parse(old);
      localStorage.setItem(LS_CUSTOMERS, JSON.stringify(list));
      return list;
    }
    return [];
  } catch {
    return [];
  }
}

// ---------------------------
// Customer sync (Supabase -> localStorage)
// ---------------------------
async function syncCustomersFromServer({ silent = true } = {}) {
  const sb = window.supabaseClient;

  if (!sb?.auth || !sb?.from) {
    if (!silent) toast("同步失败", "Supabase client 未初始化。");
    return { ok: false, reason: "supabase_not_ready" };
  }

  try {
    const { data: userData, error: userErr } = await sb.auth.getUser();

    if (userErr) {
      console.warn("syncCustomersFromServer:getUser failed:", userErr);
      if (!silent) toast("同步失败", "读取登录状态失败：" + userErr.message);
      return { ok: false, reason: "auth_error", message: userErr.message };
    }

    if (!userData?.user) {
      if (!silent) toast("未登录", "无法从 Supabase 同步客户（需要先登录）。");
      return { ok: false, reason: "no_session" };
    }

    const { data, error } = await sb
      .from("tdg_customers")
      .select(`
        account_number,
        account_name,
        account_address,
        city,
        route,
        created_at,
        updated_at
      `)
      .order("account_number", { ascending: true });

    if (error) {
      console.warn("syncCustomersFromServer:select failed:", error);
      if (!silent) toast("同步失败", "Supabase 返回错误：" + error.message);
      return { ok: false, reason: "supabase_error", message: error.message };
    }

    const list = (data || []).map((row) => ({
      accountNumber: row.account_number || "",
      accountName: row.account_name || "",
      accountAddress: row.account_address || "",
      city: row.city || "",
      route: row.route || "",
      routeType: row.route || "",
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    }));

    if (list.length) {
      localStorage.setItem(LS_CUSTOMERS, JSON.stringify(list));
    }

    console.log("TDG customers synced from Supabase:", list.length, list.slice(0, 5));

    if (!silent) {
      toast("已同步", `已从 Supabase 同步 ${list.length} 条客户。`);
    }

    return { ok: true, count: list.length };
  } catch (e) {
    const msg = String(e?.message || e || "unknown");
    console.warn("syncCustomersFromServer:unexpected error:", msg);

    if (!silent) {
      toast("同步失败", "网络或 Supabase 不可用，已继续使用本地客户库。");
    }

    return { ok: false, reason: "network", message: msg };
  }
}

function getRecords() {
  try {
    return JSON.parse(localStorage.getItem(LS_RECORDS) || "[]");
  } catch {
    return [];
  }
}

function setRecords(list) {
  try {
    localStorage.setItem(LS_RECORDS, JSON.stringify(Array.isArray(list) ? list : []));
  } catch {}
}

function computeRemainingTDG(base, records) {
  const totalDelivered = records.reduce(
    (sum, r) => sum + (Number(r.deliveredVolume) || 0),
    0,
  );
  return {
    base: base || 0,
    totalDelivered,
    remaining: (base || 0) - totalDelivered,
  };
}

// ---------------------------
// Demo data
// ---------------------------
function seedDemoCustomers(force = false) {
  const existing = getCustomers();
  if (existing.length && !force) {
    toast("已存在数据", "本地客户库已有数据，未覆盖。");
    return;
  }

  const customers = [
    {
      accountNumber: "1001",
      accountName: "Manitoba Hydro - South Station",
      accountAddress: "123 Example St, Winnipeg, MB",
      city: "Winnipeg",
      route: "R-01",
      routeType: "Local",
      createdAt: tdgLocalDateTimeISO(),
      updatedAt: tdgLocalDateTimeISO(),
    },
    {
      accountNumber: "1002",
      accountName: "EZ-Lazy Foods",
      accountAddress: "88 Market Rd, Winnipeg, MB",
      city: "Winnipeg",
      route: "R-01",
      routeType: "Local",
      createdAt: tdgLocalDateTimeISO(),
      updatedAt: tdgLocalDateTimeISO(),
    },
    {
      accountNumber: "2001",
      accountName: "North Plant",
      accountAddress: "5 Industrial Ave, Brandon, MB",
      city: "Brandon",
      route: "R-02",
      routeType: "Highway",
      createdAt: tdgLocalDateTimeISO(),
      updatedAt: tdgLocalDateTimeISO(),
    },
    {
      accountNumber: "3007",
      accountName: "TDG Customer Demo",
      accountAddress: "77 Demo Blvd, Dauphin, MB",
      city: "Dauphin",
      route: "R-03",
      routeType: "Remote",
      createdAt: tdgLocalDateTimeISO(),
      updatedAt: tdgLocalDateTimeISO(),
    },
  ];

  localStorage.setItem(LS_CUSTOMERS, JSON.stringify(customers));
  toast("已加载", "演示客户库已写入本地。");
  renderResults([]);
}

function searchCustomers(q) {
  q = (q || "").trim().toLowerCase();
  if (!q) return [];
  const list = getCustomers();
  return list.filter(
    (c) =>
      (c.accountNumber || "").toLowerCase().includes(q) ||
      (c.accountName || "").toLowerCase().includes(q) ||
      (c.accountAddress || "").toLowerCase().includes(q) ||
      (c.city || "").toLowerCase().includes(q) ||
      (c.route || c.routeType || "").toLowerCase().includes(q),
  );
}

// ---------------------------
// Form model
// ---------------------------
function getFormData() {
  const sess = getAuthSessionSafe();
  return {
    driverNumber: sess?.driverNumber || sess?.username || $("driverNumber")?.value.trim() || "",
    driverName: sess?.displayName || sess?.username || $("driverName")?.value.trim() || "",
    date: $("date")?.value || "",
    vehicleNo: $("vehicleNo")?.value.trim() || "",
    startKm: Number($("startKm")?.value || 0),
    endKm: Number($("endKm")?.value || 0),
    totalKm: Number($("totalKm")?.value || 0),
    tdgVolume: Number($("tdgVolume")?.value || 0),
    weekCycle: Number($("weekCycle")?.value || 1),
    shiftTimeStart: shiftStart,
    shiftTimeFinish: shiftFinish,
    arrived: isArrived,
    arrivalTime: arrivalTime,
    accountNumber: $("accountNumber")?.value.trim() || "",
    accountName: $("accountName")?.value.trim() || "",
    accountAddress: $("accountAddress")?.value.trim() || "",
    accountCity: $("accountCity")?.value.trim() || "",
    accountRoute: $("accountRoute")?.value.trim() || "",
    deliveredVolume: Number($("deliveredVolume")?.value || 0),
    notes: $("notes")?.value.trim() || "",
    done: !$("donePill")?.classList.contains("off"),
    updatedAt: tdgLocalDateTimeISO(),
  };
}

function setFormData(d) {
  if ($("driverNumber")) $("driverNumber").value = d.driverNumber || "";
  if ($("driverName")) $("driverName").value = d.driverName || "";
  if ($("date")) $("date").value = d.date || "";
  if ($("vehicleNo")) $("vehicleNo").value = d.vehicleNo || "";
  if ($("startKm")) $("startKm").value = d.startKm ?? "";
  if ($("endKm")) $("endKm").value = d.endKm ?? "";
  if ($("totalKm")) $("totalKm").value = d.totalKm ?? "";
  if ($("tdgVolume")) $("tdgVolume").value = d.tdgVolume ?? "";
  if ($("weekCycle")) $("weekCycle").value = String(d.weekCycle || 1);
  if ($("accountNumber")) $("accountNumber").value = d.accountNumber || "";
  if ($("accountName")) $("accountName").value = d.accountName || "";
  if ($("accountAddress")) $("accountAddress").value = d.accountAddress || "";
  if ($("accountCity")) $("accountCity").value = d.accountCity || "";
  if ($("accountRoute")) $("accountRoute").value = d.accountRoute || "";
  if ($("deliveredVolume")) $("deliveredVolume").value = d.deliveredVolume ?? "";
  if ($("notes")) $("notes").value = d.notes || "";

  shiftStart = d.shiftTimeStart || d.shiftStart || "";
  shiftFinish = d.shiftTimeFinish || d.shiftFinish || "";
  renderShiftTime();

  isArrived = !!d.arrived;
  arrivalTime = d.arrivalTime || "";
  renderArrivalUI();

  setPill("donePill", !!d.done);
  saveIndexState();
}

// ---------------------------
// Week cycle rotation 1-8
// ---------------------------
const LS_CYCLE_CACHE = "tdg_week_cycle_anchor_cache_v1";

function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalDate(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const [y, m, d] = String(yyyyMmDd).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function getWeekStartMonday(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function diffWeeks(fromDate, toDate) {
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.floor((toDate - fromDate) / msPerWeek);
}

function getCachedWeekCycleAnchor() {
  try {
    const raw = localStorage.getItem(LS_CYCLE_CACHE);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const cycle = Number(data?.cycle);
    const weekStart = parseLocalDate(data?.weekStart);
    if (!(cycle >= 1 && cycle <= 8) || !weekStart) return null;
    return { cycle, weekStart };
  } catch {
    return null;
  }
}

function setCachedWeekCycleAnchor(cycle, weekStart) {
  localStorage.setItem(
    LS_CYCLE_CACHE,
    JSON.stringify({
      cycle: Number(cycle),
      weekStart: typeof weekStart === "string" ? weekStart : formatLocalDate(weekStart),
      cachedAt: tdgLocalDateTimeISO(),
    }),
  );
}

function computeWeekCycleFromAnchor(anchor, now = new Date()) {
  if (!anchor?.weekStart || !(anchor?.cycle >= 1 && anchor?.cycle <= 8)) return 1;
  const currentWeekStart = getWeekStartMonday(now);
  const weeks = diffWeeks(anchor.weekStart, currentWeekStart);
  const normalizedWeeks = Math.max(0, weeks);
  return ((anchor.cycle - 1 + normalizedWeeks) % 8) + 1;
}

async function fetchWeekCycleAnchorFromSupabase() {
  const sb = window.supabaseClient;
  const sess = window.TDG_AUTH?.getSession?.();
  if (!sb || !sess?.userId) return null;

  const { data, error } = await sb
    .from("tdg_user_settings")
    .select("week_cycle_anchor, week_cycle_anchor_week_start")
    .eq("owner_id", sess.userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const cycle = Number(data.week_cycle_anchor || 1);
  const weekStart = parseLocalDate(data.week_cycle_anchor_week_start);
  if (!(cycle >= 1 && cycle <= 8) || !weekStart) return null;

  const anchor = { cycle, weekStart };
  setCachedWeekCycleAnchor(cycle, weekStart);
  return anchor;
}

async function saveWeekCycleAnchorToSupabase(selectedCycle, now = new Date()) {
  const sb = window.supabaseClient;
  const sess = window.TDG_AUTH?.getSession?.();
  if (!sb || !sess?.userId) throw new Error("Supabase session missing");

  const cycle = Number(selectedCycle);
  if (!(cycle >= 1 && cycle <= 8)) throw new Error("Invalid week cycle");

  const weekStart = getWeekStartMonday(now);
  const weekStartStr = formatLocalDate(weekStart);

  const payload = {
    owner_id: sess.userId,
    week_cycle_anchor: cycle,
    week_cycle_anchor_week_start: weekStartStr,
    updated_at: tdgLocalDateTimeISO(),
  };

  const { error } = await sb
    .from("tdg_user_settings")
    .upsert(payload, { onConflict: "owner_id" });

  if (error) throw error;

  setCachedWeekCycleAnchor(cycle, weekStartStr);
  return { cycle, weekStart };
}

async function loadWeekCycle() {
  const weekCycle = $("weekCycle");
  if (!weekCycle) return 1;

  let anchor = null;

  try {
    anchor = await fetchWeekCycleAnchorFromSupabase();
  } catch (e) {
    console.warn("fetchWeekCycleAnchorFromSupabase failed:", e);
    anchor = getCachedWeekCycleAnchor();
  }

  if (!anchor) {
    anchor = { cycle: 1, weekStart: getWeekStartMonday(new Date()) };
    setCachedWeekCycleAnchor(anchor.cycle, anchor.weekStart);
  }

  const cycle = computeWeekCycleFromAnchor(anchor, new Date());
  weekCycle.value = String(cycle);
  return cycle;
}

// ---------------------------
// Profile / user info (Supabase master)
// ---------------------------
function ensureDemoProfile() {
  if (localStorage.getItem(LS_PROFILE)) return;
  localStorage.setItem(
    LS_PROFILE,
    JSON.stringify({
      driverNumber: "D-001",
      driverName: "Driver Demo",
      vehicleNo: "VH-102",
    }),
  );
}

async function loadUserProfileFromSupabase() {
  const sb = window.supabaseClient;
  if (!sb?.auth || !sb?.from) return null;

  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) {
    console.warn("loadUserProfileFromSupabase:getUser failed:", userErr);
    return null;
  }

  const user = userData.user;

  const { data: profile, error: profileErr } = await sb
    .from("tdg_profiles")
    .select("id, driver_number, username, display_name, vehicle_no, role, email, phone")
    .eq("id", user.id)
    .single();

  if (profileErr || !profile) {
    console.warn("loadUserProfileFromSupabase:profile query failed:", profileErr);
    return null;
  }

  return {
    id: profile.id,
    driverNumber: profile.driver_number || profile.username || "",
    driverName: profile.display_name || profile.username || "",
    vehicleNo: profile.vehicle_no || "",
    role: profile.role || "",
    email: profile.email || "",
    phone: profile.phone || "",
  };
}

async function syncProfileCacheFromSupabase() {
  const profile = await loadUserProfileFromSupabase();
  if (!profile) return null;

  try {
    localStorage.setItem(
      LS_PROFILE,
      JSON.stringify({
        driverNumber: profile.driverNumber || "",
        driverName: profile.driverName || "",
        vehicleNo: profile.vehicleNo || "",
        role: profile.role || "",
        email: profile.email || "",
        phone: profile.phone || "",
        updatedAt: tdgLocalDateTimeISO(),
      }),
    );
  } catch {}

  return profile;
}

async function fillVehicleNoFromProfileIfNeeded(force = false) {
  const vehicleEl = $("vehicleNo");
  if (!vehicleEl) return "";

  if (!force && vehicleEl.value.trim()) {
    return vehicleEl.value.trim();
  }

  const profile = await syncProfileCacheFromSupabase();
  const vehicleNo = profile?.vehicleNo || "";

  if (vehicleNo) {
    vehicleEl.value = vehicleNo;
    saveIndexState();
  }

  return vehicleNo;
}

async function loadFromProfile() {
  try {
    const sess = getAuthSessionSafe();

    if ($("driverNumber")) {
      $("driverNumber").value = sess?.driverNumber || sess?.username || $("driverNumber").value || "";
    }
    if ($("driverName")) {
      $("driverName").value = sess?.displayName || sess?.username || $("driverName").value || "";
    }

    const profile = await syncProfileCacheFromSupabase();

    if ($("driverNumber") && profile?.driverNumber) {
      $("driverNumber").value = profile.driverNumber;
    }
    if ($("driverName") && profile?.driverName) {
      $("driverName").value = profile.driverName;
    }
    if ($("vehicleNo")) {
      $("vehicleNo").value = profile?.vehicleNo || "";
    }

    toast("已带入", "已从用户资料带入司机/车辆信息。");
  } catch (e) {
    console.warn("loadFromProfile failed:", e);
    toast("错误", "无法加载用户资料");
  }
  saveIndexState();
}

function loadFromCalendar() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  if ($("date")) $("date").value = `${yyyy}-${mm}-${dd}`;

  const list = getCustomers();
  if (list.length) {
    const planned = list[0];
    if ($("accountNumber")) $("accountNumber").value = planned.accountNumber;
    if ($("accountName")) $("accountName").value = planned.accountName;
    if ($("accountAddress")) $("accountAddress").value = planned.accountAddress;
  }
  toast("已带入", "已从日历带入日期 + 计划客户（演示）。");
  saveIndexState();
}

function loadFromYesterday() {
  const driverKey = getDriverKeySafe();
  migrateLegacyYesterdayIfAny(driverKey);
  const y = loadYesterdayForDriver(driverKey);
  if (!y) {
    toast("暂无记录", "没有找到昨天记录（先 Save Draft 或 Done 一次）。");
    return;
  }
  try {
    setFormData({
      ...y,
      deliveredVolume: "",
      notes: "",
      done: false,
    });
    toast("已带入", "已从昨天记录带入常用字段（Delivered/Notes 不复制）。");
  } catch {
    toast("错误", "无法加载昨天记录");
  }
  saveIndexState();
}

function autoLoadVolumeFromYesterday() {
  const driverKey = getDriverKeySafe();
  migrateLegacyYesterdayIfAny(driverKey);
  const y = loadYesterdayForDriver(driverKey);
  if (!y) return;

  const cur = Number($("tdgVolume")?.value || 0);
  if (!cur && y.remainingVolume != null) {
    $("tdgVolume").value = y.remainingVolume;
    toast("已带入", "TDG Volume 已自动带入前一天余数。");
  }
}

// ---------------------------
// Search UI
// ---------------------------
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderResults(items) {
  const box = $("resultBox");
  if (!box) return;

  if (!items.length) {
    box.innerHTML = `
      <h3 style="margin: 0 0 8px 0;">Search result shows here</h3>
      <div class="muted">没有匹配结果。换个关键词，或先加载演示客户库。</div>
    `;
    return;
  }

  const rows = items
    .map(
      (c, idx) => `
        <div style="padding:12px; border-radius:16px; border:1px solid rgba(255,255,255,.10); background: rgba(0,0,0,.14); margin-top:10px;">
          <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start; flex-wrap:wrap;">
            <div style="min-width:220px;">
              <div style="font-weight:800; font-size:14px;">${escapeHtml(c.accountName)}</div>
              <div class="muted" style="margin-top:6px;">${escapeHtml(c.accountAddress || "")}</div>
              <div class="muted" style="margin-top:6px;">Account: ${escapeHtml(c.accountNumber)} | City: ${escapeHtml(c.city || "")} | Route: ${escapeHtml(c.route || c.routeType || "")}</div>
            </div>
            <button class="btn ok" data-pick="${idx}" type="button" style="min-width:120px;">Select</button>
          </div>
        </div>
      `,
    )
    .join("");

  box.innerHTML = `
    <h3 style="margin: 0 0 8px 0;">匹配到 ${items.length} 条客户</h3>
    <div class="muted">点击“Select”自动填充账号信息。</div>
    ${rows}
  `;

  box.querySelectorAll("[data-pick]").forEach((btn) => {
    btn.addEventListener(
      "click",
      () => {
        const i = Number(btn.getAttribute("data-pick"));
        const c = items[i];
        if ($("accountNumber")) $("accountNumber").value = c.accountNumber || "";
        if ($("accountName")) $("accountName").value = c.accountName || "";
        if ($("accountAddress")) $("accountAddress").value = c.accountAddress || "";
        toast("已选择客户", "已自动填充 Account / City / Route 字段。");
        if ($("accountCity")) $("accountCity").value = c.city || "";
        if ($("accountRoute")) $("accountRoute").value = c.route || c.routeType || "";
        saveIndexState();
      },
      { passive: true },
    );
  });
}

// ---------------------------
// Server backup functions
// ---------------------------
function getAuthSessionSafe() {
  try {
    return window.TDG_AUTH?.getSession?.() || null;
  } catch {
    return null;
  }
}

async function getAuthTokenSafe() {
  try {
    const sb = window.supabaseClient;
    if (sb?.auth?.getSession) {
      const { data, error } = await sb.auth.getSession();
      if (!error) {
        const token = data?.session?.access_token;
        if (token) return token;
      }
    }
  } catch (e) {
    console.warn("getAuthTokenSafe: supabase session read failed:", e);
  }

  return (
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt") ||
    ""
  );
}

function enqueuePendingSync(payload, errorMsg) {
  try {
    const raw = localStorage.getItem(LS_PENDING_SYNC);
    const list = raw ? JSON.parse(raw) : [];
    list.push({
      createdAt: tdgLocalDateTimeISO(),
      error: String(errorMsg || "unknown"),
      payload,
    });
    localStorage.setItem(LS_PENDING_SYNC, JSON.stringify(list));
  } catch {}
}

function buildDailyPayload(reason) {
  const form = getFormData();
  const records = getRecords();
  const baseTdg = Number($("tdgVolume")?.value || 0);
  const cal = computeRemainingTDG(baseTdg, records);
  const sess = getAuthSessionSafe();

  return {
    kind: "tdg_daily_log",
    version: 1,
    reason: reason || "manual",
    savedAt: tdgLocalDateTimeISO(),
    date: form.date || "",
    driver: {
      employeeNumber: sess?.username || form.driverNumber || "",
      driverName: sess?.displayName || form.driverName || "",
      role: sess?.role || "",
    },
    vehicleNo: form.vehicleNo,
    weekCycle: form.weekCycle,
    shift: { start: shiftStart || "", finish: shiftFinish || "" },
    arriveState: { arrived: !!isArrived, arrivalTime: arrivalTime || "" },
    tdg: {
      base: cal.base,
      totalDelivered: cal.totalDelivered,
      remaining: cal.remaining,
    },
    form,
    records,
  };
}

async function postJsonWithTimeout(
  url,
  payload,
  { timeoutMs = 8000 } = {},
) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const token = await getAuthTokenSafe();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    const text = await res.text().catch(() => "");
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}

    return { ok: res.ok, status: res.status, data, text };
  } finally {
    clearTimeout(t);
  }
}

async function backupDailyToServer(reason = "manual") {
  const payload = buildDailyPayload(reason);

  try {
    const sb = window.supabaseClient;
    if (sb?.auth && sb?.from) {
      const uRes = await sb.auth.getUser();
      const user = uRes?.data?.user;
      if (!user) throw new Error("Not signed in (Supabase session missing)");

      const row = {
        owner_id: user.id,
        log_date: payload.date || null,
        driver_employee_number: payload?.driver?.employeeNumber || "",
        driver_name: payload?.driver?.driverName || "",
        driver_role: payload?.driver?.role || "",
        vehicle_no: payload.vehicleNo || null,
        week_cycle: payload.weekCycle ?? null,
        payload,
      };

      const ins = await sb
        .from("tdg_daily_logs")
        .insert(row)
        .select("id")
        .single();

      if (ins.error) throw ins.error;

      return {
        ok: true,
        url: "supabase:tdg_daily_logs",
        response: { id: ins.data?.id || null },
      };
    }
  } catch (e) {}

  const endpoints = [
    "/api/daily-logs",
    "/api/dailylog",
    "/api/tdg/daily-logs",
    "/api/backup/daily",
    "/api/backup",
  ];

  for (const url of endpoints) {
    try {
      const r = await postJsonWithTimeout(url, payload, {
        timeoutMs: 9000,
      });
      if (r.ok) {
        return { ok: true, url, response: r.data || r.text || null };
      }
    } catch (e) {}
  }

  enqueuePendingSync(payload, "Supabase + all endpoints failed");
  return { ok: false };
}

// ---------------------------
// Supabase: record-level sync (Add Record)
// ---------------------------
function genClientRecordId() {
  try {
    return crypto.randomUUID();
  } catch {
    return "cr_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  }
}

function buildRecordRowForSupabase(rec, ownerId) {
  const workDate = rec.date || tdgLocalDate();
  return {
    client_record_id: rec.clientRecordId,
    owner_id: ownerId,

    driver_number: String(rec.driverNumber || rec.driver_number || ""),
    driver_name: String(rec.driverName || rec.driver_name || ""),
    work_date: workDate,
    vehicle_no: String(rec.vehicleNo || rec.vehicle_no || ""),
    week_cycle: rec.weekCycle ?? rec.week_cycle ?? null,
    shift_start: rec.shiftStart || rec.shift_start || "",
    shift_finish: rec.shiftFinish || rec.shift_finish || "",
    arrived: true,
    arrival_time: rec.arrivalTime || rec.arrival_time || "",
    completed_at: rec.completedAt || rec.completed_at || tdgLocalDateTimeISO(),

    account_number: rec.accountNumber || rec.account_number || "",
    account_name: rec.accountName || rec.account_name || "",
    account_address: rec.accountAddress || rec.account_address || "",
    account_city: rec.accountCity || rec.account_city || "",
    account_route: rec.accountRoute || rec.account_route || "",

    tdg_volume: Number(rec.tdgVolume ?? rec.tdg_volume ?? 0) || null,
    delivered_volume: Number(rec.deliveredVolume ?? rec.delivered_volume ?? 0) || 0,
    notes: rec.notes || "",
    raw: rec,
  };
}

async function syncRecordToSupabase(rec) {
  const sb = window.supabaseClient;
  if (!sb?.auth || !sb?.from) {
    throw new Error("Supabase client not initialized");
  }

  const { data: userData, error: uErr } = await sb.auth.getUser();
  if (uErr) throw new Error("读取登录用户失败: " + uErr.message);

  const user = userData?.user;
  if (!user) throw new Error("Auth session missing");

  if (!rec.clientRecordId) rec.clientRecordId = genClientRecordId();

  const row = buildRecordRowForSupabase(rec, user.id);

  console.log("Uploading tdg_records row:", row);

  const r = await sb
    .from("tdg_records")
    .upsert(row, { onConflict: "client_record_id" })
    .select("id, client_record_id, owner_id, work_date, account_number, account_name, created_at")
    .single();

  if (r.error) {
    console.error("syncRecordToSupabase failed:", r.error);
    throw new Error(r.error.message || "Supabase insert/upsert failed");
  }

  console.log("tdg_records uploaded:", r.data);
  return r.data;
}

async function syncAllLocalRecordsToSupabase() {
  const list = getRecords();
  for (const rec of list) {
    try {
      await syncRecordToSupabase(rec);
      rec.synced = true;
      rec.syncError = "";
    } catch (e) {
      rec.synced = false;
      rec.syncError = String(e?.message || e);
    }
  }
  setRecords(list);
  return list;
}

async function uploadFinalDailyLogAndOffDuty(reason = "off_duty") {
  const sb = window.supabaseClient;
  if (!sb?.auth || !sb?.from) throw new Error("Supabase client not initialized");

  const { data: userData, error: uErr } = await sb.auth.getUser();
  if (uErr) throw uErr;
  const user = userData?.user;
  if (!user) throw new Error("Auth session missing");

  const payload = buildDailyPayload(reason);
  payload.meta = { ...(payload.meta || {}), skip_expand: true };

  const row = {
    owner_id: user.id,
    log_date: payload.date || null,
    driver_employee_number: payload?.driver?.employeeNumber || "",
    driver_name: payload?.driver?.driverName || "",
    driver_role: payload?.driver?.role || "",
    vehicle_no: payload.vehicleNo || null,
    week_cycle: payload.weekCycle ?? null,
    payload,
  };

  const ins = await sb.from("tdg_daily_logs").insert(row).select("id").single();
  if (ins.error) throw ins.error;
  return ins;
}

async function logoutFlow() {
  const ok = confirm("Off Duty will sync all today's local records to Supabase, then upload a final daily snapshot. Continue?");
  if (!ok) return;

  const btn = $("btnLogout");
  if (btn) btn.disabled = true;

  try {
    toast("同步中…", "正在把本地记录逐条同步到云端数据库（可离线重试）。");

    await syncAllLocalRecordsToSupabase();

    toast("上传汇总…", "正在上传当日最终汇总（Daily Log）。");
    await uploadFinalDailyLogAndOffDuty("off_duty");

    toast("完成", "已完成同步与汇总上传，正在退出…");

    try {
      localStorage.removeItem(LS_RECORDS);
      localStorage.removeItem(LS_DRAFT);
    } catch {}

    try {
      await window.supabaseClient?.auth?.signOut?.();
    } catch {}
    try {
      window.TDG_AUTH?.logout?.();
      return;
    } catch {}

    window.location.href = "./login.html";
  } catch (e) {
    console.error(e);
    toast("失败", "Off Duty 同步/上传失败：请检查网络或稍后重试（本地记录未丢失）。");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function remoteBackupFlow() {
  const btn = $("btnRemoteBackup");
  if (btn) btn.disabled = true;

  toast("远程备份…", "正在把当日数据上传到服务器（如失败会暂存本地队列）。");
  const result = await backupDailyToServer("manual");
  if (btn) btn.disabled = false;

  if (result.ok) {
    toast("备份成功", `已保存到：${result.url}`);
  } else {
    toast("备份失败", "所有接口都不可用：已暂存到本地队列。");
  }
}

// ---------------------------
// Actions
// ---------------------------
function confirmArrive() {
  if (isArrived) return;
  isArrived = true;
  arrivalTime = nowHHMM();
  renderArrivalUI();
  toast("到达确认", `已记录 Arrival Time：${arrivalTime}`);
  saveIndexState();
}

function checkIn() {
  if (shiftStart) {
    const ok = confirm(`已经有 Check-in：${shiftStart}。要覆盖为当前时间吗？`);
    if (!ok) return;
  }
  shiftStart = nowHHMM();
  shiftFinish = "";
  renderShiftTime();
  toast("已 Check-in", `开始时间：${shiftStart}`);
  saveIndexState();
}

function checkOut() {
  if (!shiftStart) {
    alert("请先 Check-in（记录开始时间）");
    return;
  }
  if (shiftFinish) {
    const ok = confirm(`已经有 Check-out：${shiftFinish}。要覆盖为当前时间吗？`);
    if (!ok) return;
  }
  shiftFinish = nowHHMM();
  renderShiftTime();
  toast("已 Check-out", `结束时间：${shiftFinish}`);
  saveIndexState();
}

function saveDraft() {
  const d = getFormData();
  const records = getRecords();
  const baseTdg = Number($("tdgVolume")?.value || 0);
  const cal = computeRemainingTDG(baseTdg, records);
  d.remainingVolume = cal.remaining;

  localStorage.setItem(LS_DRAFT, JSON.stringify(d));
  saveYesterdayForDriver(getDriverKeySafe(), d);
  toast("已保存", "草稿已保存到本地。");
  saveIndexState();
}

async function done() {
  if (window.__savingDone) return;
  window.__savingDone = true;

  const btn = $("btnDone");
  if (btn) btn.disabled = true;

  try {
    if (!isArrived) {
      toast("请先到达确认", "请先点击 Confirm Arrive 再 Add Record。");
      return;
    }

    const d = getFormData();

    if (!d.date) {
      toast("缺少日期", "请先选择 Date。");
      return;
    }
    if (!d.driverNumber || !d.driverName) {
      toast("缺少司机信息", "请填写 Driver's Number / Name。");
      return;
    }
    if (!d.accountNumber || !d.accountName) {
      toast("缺少客户信息", "请先搜索并选择客户，或手动填写 Account 字段。");
      return;
    }

    d.done = true;
    d.arrivalTime = arrivalTime || "";
    d.shiftStart = shiftStart || "";
    d.shiftFinish = shiftFinish || "";
    d.completedAt = tdgLocalDateTimeISO();
    d.clientRecordId = d.clientRecordId || genClientRecordId();

    const baseTdg = Number($("tdgVolume")?.value || 0);
    const cal = computeRemainingTDG(baseTdg, getRecords());
    d.remainingVolume = cal.remaining;

    toast("上传中", "正在立即上传本条记录到 Supabase...");

    const remoteRow = await syncRecordToSupabase(d);

    const records = getRecords();
    records.push({
      ...d,
      synced: true,
      syncError: "",
      remoteId: remoteRow?.id || null,
    });
    setRecords(records);

    setPill("donePill", true);
    setStatus("已完成");
    toast("上传成功", "本条记录已成功写入 Supabase。");

    saveYesterdayForDriver(getDriverKeySafe(), d);

    resetAccountFieldsForNextRecord();
    isArrived = false;
    arrivalTime = "";
    renderArrivalUI();
    setPill("donePill", false);
    setPill("arrivePill", false);
    setStatus("Driving");

    const next = {
      ...d,
      accountNumber: "",
      accountName: "",
      accountAddress: "",
      accountCity: "",
      accountRoute: "",
      deliveredVolume: 0,
      notes: "",
      arrived: false,
      arrivalTime: "",
      done: false,
    };

    setFormData(next);

    if ($("searchBox")) $("searchBox").value = "";
    const resultBox = $("resultBox");
    if (resultBox) {
      resultBox.innerHTML = `
        <h3 style="margin: 0 0 8px 0;">Search result shows here</h3>
        <div class="muted">已上传成功。请搜索/填写下一个客户。</div>
      `;
    }

    $("accountNumber")?.focus();
  } catch (e) {
    console.error("Add Record immediate upload failed:", e);
    toast("上传失败", "未成功写入 Supabase，当前记录没有提交。请检查网络或权限后重试。");
  } finally {
    window.__savingDone = false;
    if (btn) btn.disabled = false;
  }
}

function resetForm() {
  const keepCycle = $("weekCycle")?.value || "1";

  isArrived = false;
  arrivalTime = "";
  shiftStart = "";
  shiftFinish = "";

  setFormData({
    driverNumber: $("driverNumber")?.value || "",
    driverName: $("driverName")?.value || "",
    vehicleNo: $("vehicleNo")?.value || "",
    date: "",
    weekCycle: Number(keepCycle),
    arrived: false,
    arrivalTime: "",
    shiftTimeStart: "",
    shiftTimeFinish: "",
    done: false,
  });

  if ($("searchBox")) $("searchBox").value = "";
  const resultBox = $("resultBox");
  if (resultBox) {
    resultBox.innerHTML = `
      <h3 style="margin: 0 0 8px 0;">Search result shows here</h3>
      <div class="muted">已重置。你可以重新搜索客户。</div>
    `;
  }

  toast("已重置", "表单已清空（Week Cycle 保留）。");
  saveIndexState();
}

function loadDraftIfAny() {
  const raw = localStorage.getItem(LS_DRAFT);
  if (!raw) return false;
  try {
    const d = JSON.parse(raw);
    delete d.weekCycle;
    setFormData(d);
    toast("已恢复", "已从本地草稿恢复上次填写内容。");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------
// SessionStorage: index state
// ---------------------------
const SS_INDEX_STATE = "tdg_index_state_v2";

function saveIndexState() {
  try {
    const d = getFormData();
    sessionStorage.setItem(SS_INDEX_STATE, JSON.stringify(d));
  } catch {}
}

function restoreIndexState() {
  try {
    const raw = sessionStorage.getItem(SS_INDEX_STATE);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object") return false;
    setFormData(d);
    return true;
  } catch {
    return false;
  }
}

let __saveIndexTimer = null;
function scheduleSaveIndexState() {
  clearTimeout(__saveIndexTimer);
  __saveIndexTimer = setTimeout(saveIndexState, 150);
}

window.addEventListener("pageshow", () => {
  restoreIndexState();
});

/* ===============================
   DAILY SYNC (SUPABASE MASTER)
   =============================== */

function tdgToday() {
  return tdgLocalDate();
}

function tdgPullKey(driverNumber) {
  return "tdg_last_pull_v1__" + (driverNumber || "unknown");
}

async function pullTodayRecordsFromSupabase() {
  const sb = window.supabaseClient;
  if (!sb) throw new Error("Supabase not ready");

  const sess = window.TDG_AUTH?.getSession?.();
  if (!sess?.userId) throw new Error("No login session");

  const today = tdgToday();

  const { data, error } = await sb
    .from("tdg_records")
    .select("*")
    .eq("owner_id", sess.userId)
    .eq("work_date", today)
    .order("completed_at", { ascending: true });

  if (error) throw error;

  const list = (data || []).map((r) => ({
    clientRecordId: r.client_record_id,
    driverNumber: r.driver_number,
    driverName: r.driver_name,
    date: r.work_date,
    vehicleNo: r.vehicle_no,
    weekCycle: r.week_cycle,
    shiftStart: r.shift_start,
    shiftFinish: r.shift_finish,
    arrivalTime: r.arrival_time,
    completedAt: r.completed_at,
    accountNumber: r.account_number,
    accountName: r.account_name,
    accountAddress: r.account_address,
    accountCity: r.account_city,
    accountRoute: r.account_route,
    tdgVolume: r.tdg_volume,
    deliveredVolume: r.delivered_volume,
    notes: r.notes,
    synced: true,
    remoteId: r.id,
  }));

  localStorage.setItem(LS_RECORDS, JSON.stringify(list));
  localStorage.removeItem(LS_PENDING_SYNC);

  return list;
}

async function ensureDailyPullAfterLogin() {
  const sess = window.TDG_AUTH?.getSession?.();
  if (!sess?.driverNumber) return;

  const today = tdgToday();
  const key = tdgPullKey(sess.driverNumber);

  const last = localStorage.getItem(key);

  if (last === today) {
    console.log("TDG daily pull already done");
    return;
  }

  console.log("TDG pulling today's records from Supabase...");

  const list = await pullTodayRecordsFromSupabase();

  localStorage.setItem(key, today);

  console.log("TDG sync finished:", list.length);
}

/* exposed */
window.TDG_SYNC = {
  ensureDailyPullAfterLogin,
  pullTodayRecordsFromSupabase,
};

window.TDG_CUSTOMERS = {
  syncFromServer: syncCustomersFromServer,
};

// ---------------------------
// Wire up
// ---------------------------
document.addEventListener("DOMContentLoaded", async () => {
  function updateTotalKm() {
    const start = Number($("startKm")?.value || 0);
    const end = Number($("endKm")?.value || 0);

    if (!start && !end) {
      $("totalKm").value = "";
      return;
    }

    const total = end - start;
    $("totalKm").value = total >= 0 ? total : "";
  }

  $("startKm")?.addEventListener("input", updateTotalKm);
  $("endKm")?.addEventListener("input", updateTotalKm);

  const sess = window.TDG_AUTH?.requireAuth?.();
  if (!sess) return;

  const fillDriverFromSession = (s) => {
    const dn = s.driverNumber || s.username || "";
    const nm = s.displayName || s.username || "";
    if ($("driverNumber")) $("driverNumber").value = dn;
    if ($("driverName")) $("driverName").value = nm;
  };

  fillDriverFromSession(sess);

  const restored = restoreIndexState();

  autoLoadVolumeFromYesterday();

  $("btnSeedDemo")?.addEventListener("click", () => seedDemoCustomers(true));

  $("btnSearch")?.addEventListener("click", () =>
    renderResults(searchCustomers($("searchBox")?.value)),
  );

  $("searchBox")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btnSearch")?.click();
  });

  $("btnClearSearch")?.addEventListener("click", () => {
    if ($("searchBox")) $("searchBox").value = "";
    renderResults([]);
  });

  $("btnArrive")?.addEventListener("click", confirmArrive);
  $("btnCheckIn")?.addEventListener("click", checkIn);
  $("btnCheckOut")?.addEventListener("click", checkOut);

  $("btnSaveDraft")?.addEventListener("click", saveDraft);
  $("btnDone")?.addEventListener("click", done);
  $("btnReset")?.addEventListener("click", resetForm);
  $("btnLogout")?.addEventListener("click", logoutFlow);
  $("btnRemoteBackup")?.addEventListener("click", remoteBackupFlow);

  $("btnLoadProfile")?.addEventListener("click", async () => {
    await loadFromProfile();
  });
  $("btnLoadCalendar")?.addEventListener("click", loadFromCalendar);
  $("btnLoadYesterday")?.addEventListener("click", loadFromYesterday);

  $("weekCycle")?.addEventListener("change", async () => {
    const val = Number($("weekCycle")?.value || 1);

    try {
      await saveWeekCycleAnchorToSupabase(val, new Date());
      await loadWeekCycle();
      toast("已更新", `Week Cycle 已设为 ${val}，将从本周起按周自动递增。`);
    } catch (e) {
      console.warn("saveWeekCycleAnchorToSupabase failed:", e);
      const weekStart = getWeekStartMonday(new Date());
      setCachedWeekCycleAnchor(val, weekStart);
      await loadWeekCycle();
      toast("已本地保存", "云端更新失败，当前设备仍会按周自动递增。");
    }

    saveIndexState();
  });

  $("btnToday")?.addEventListener("click", () => {
    saveIndexState();
    window.location.href = "./Current_Detail.html";
  });

  $("btnHistory")?.addEventListener("click", () => {
    window.location.href = "./History_Record.html";
  });

  $("btnGenText")?.addEventListener("click", () => {
    toast("生成文本", "功能开发中");
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        await navigator.serviceWorker.register("./sw.js");
      } catch {}
    });
  }

  [
    "date", "vehicleNo", "tdgVolume", "startKm", "endKm", "totalKm", "weekCycle",
    "accountNumber", "accountName", "accountAddress", "accountCity", "accountRoute",
    "deliveredVolume", "notes",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", scheduleSaveIndexState, { passive: true });
    el.addEventListener("change", scheduleSaveIndexState, { passive: true });
  });

  const dateInput = $("date");
  if (dateInput && !dateInput.value) {
    dateInput.value = tdgLocalDate();
  }

  ensureDemoProfile();
  renderShiftTime();
  renderArrivalUI();

  if (!restored) {
    loadDraftIfAny();
  }

  await loadWeekCycle();

  fillDriverFromSession(sess);

  if (!getCustomers().length) {
    seedDemoCustomers();
  }

  await syncCustomersFromServer({ silent: true });

  fillDriverFromSession(sess);

  if (!restored && !$("vehicleNo")?.value) {
    await fillVehicleNoFromProfileIfNeeded(true);
  } else {
    await syncProfileCacheFromSupabase();
  }

  saveIndexState();
});
