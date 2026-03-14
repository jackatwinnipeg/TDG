/* /js/admin.js
 * Supabase-first Admin Panel
 * - Users: uses public.tdg_profiles
 * - Auth guard: uses window.TDG_AUTH from auth_supabase.js
 * - Customers: uses public.tdg_customers
 * - Create / Update / Delete User: via Edge Functions / Supabase
 *
 * IMPORTANT:
 * - username === driver_number
 */
(() => {
  "use strict";
  console.log("admin.js loaded");

  const $ = (id) => document.getElementById(id);
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  const safe = (v) => String(v ?? "").trim();
  const lower = (v) => safe(v).toLowerCase();
  const nowIso = () => new Date().toISOString();

  const escapeHtml = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  let currentProfile = null;

async function requireAdminPageAccess() {
  const sb = getSb();

  const {
    data: { user },
    error: userError,
  } = await sb.auth.getUser();

  if (userError || !user) {
    alert("登录已失效，请重新登录");
    window.location.href = "./login.html";
    return false;
  }

  const { data: profile, error: profileError } = await sb
    .from("tdg_profiles")
    .select("id, username, display_name, role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || profile.role !== "admin") {
    alert("没有权限访问此页面");
    window.location.href = "./login.html";
    return false;
  }

  currentProfile = profile;

  if ($("who")) {
    $("who").textContent = `当前登录：${profile.display_name || profile.username}（${profile.role}）`;
  }

  on($("btnLogout"), "click", async () => {
    await sb.auth.signOut();
    window.location.href = "./login.html";
  });

  return true;
}

  function getSb() {
    const sb = window.supabaseClient;
    if (!sb?.from || !sb?.auth) {
      throw new Error("Supabase client not initialized");
    }
    return sb;
  }

  async function getSbSession() {
    const sb = getSb();
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    return data?.session || null;
  }

  async function getAccessToken() {
  const sb = getSb();

  const {
    data: { session },
    error: sessionError,
  } = await sb.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("登录已失效，请重新登录");
  }

  const {
    data: { user },
    error: userError,
  } = await sb.auth.getUser();

  if (userError || !user) {
    throw new Error("登录已失效，请重新登录");
  }

  return session.access_token;
}

  function canonicalEmailFromDriverNumber(driverNumber, email = "") {
    const normalizedEmail = safe(email).toLowerCase();
    if (normalizedEmail) return normalizedEmail;
    return `${safe(driverNumber).toLowerCase()}@tdg.com`;
  }

  async function callFn(name, payload, { method = "POST" } = {}) {
  const sb = getSb();

  const {
    data: { session },
    error: sessionError,
  } = await sb.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("登录已失效，请重新登录");
  }

  let data, error;

  try {
    const result = await sb.functions.invoke(name, {
      body: method === "GET" ? undefined : (payload ?? {}),
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    data = result.data;
    error = result.error;
  } catch (e) {
    throw new Error("网络请求失败，无法连接 Edge Function");
  }

  if (error) {
    const msg =
      error?.context?.error ||
      error?.message ||
      "Edge Function 调用失败";

    if (
      msg.includes("Invalid session") ||
      msg.includes("登录已失效") ||
      msg.includes("Missing bearer token")
    ) {
      throw new Error("登录已失效，请重新登录");
    }

    if (
      msg.includes("Only admin can update users") ||
      msg.includes("Caller profile not found")
    ) {
      throw new Error("没有权限执行此操作");
    }

    throw new Error(msg);
  }

  return data;
}

  function showApiError(err, fallback = "操作失败") {
  const msg = String(err?.message || fallback);

  if (
    msg.includes("重新登录") ||
    msg.includes("登录已失效") ||
    msg.includes("Invalid session") ||
    msg.includes("Missing bearer token")
  ) {
    alert(msg);
    window.location.href = "./login.html";
    return;
  }

  alert(msg || fallback);
}

  const FN = {
    createUser: "admin-create-user",
    updateUser: "admin-update-user",
    deleteUser: "admin-delete-user",
  };

  function openModal(title, bodyHtml, { onClose } = {}) {
    const titleEl = $("modalTitle");
    const bodyEl = $("modalBody");
    const backdrop = $("modalBackdrop");

    if (!titleEl || !bodyEl || !backdrop) {
      throw new Error("Modal elements not found");
    }

    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    backdrop.style.display = "flex";
    backdrop.setAttribute("aria-hidden", "false");

    let closed = false;

    const esc = (ev) => {
      if (ev.key === "Escape") close();
    };

    const close = () => {
      if (closed) return;
      closed = true;
      backdrop.style.display = "none";
      backdrop.setAttribute("aria-hidden", "true");
      bodyEl.innerHTML = "";
      document.removeEventListener("keydown", esc);
      backdrop.onclick = null;
      onClose && onClose();
    };

    backdrop.onclick = (e) => {
      if (e.target === backdrop) close();
    };

    document.addEventListener("keydown", esc);

    return { close };
  }

  const Rules = {
    driverNumber: (v) => /^[A-Za-z0-9._-]{2,32}$/.test(v),
    displayName: (v) => safe(v).length <= 60,
    role: (v) => ["admin", "driver", "viewer"].includes(v),
    phone: (v) => safe(v).length <= 40,
    email: (v) => safe(v).length <= 120,
    vehicleNo: (v) => safe(v).length <= 40,
  };

  function assertOrThrow(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  function normalizeUserPayload(payload, { mode = "update" } = {}) {
    const driverNumber = safe(payload.driverNumber).toLowerCase();
    const username = driverNumber;
    const displayName = safe(payload.displayName);
    const role = safe(payload.role || "driver");
    const isActive = payload.isActive === false ? false : true;
    const mustChangePassword = !!payload.mustChangePassword;
    const vehicleNo = safe(payload.vehicleNo);
    const phone = safe(payload.phone);
    const email = safe(payload.email).toLowerCase();
    const password = safe(payload.password);

    assertOrThrow(driverNumber, "Driver Number 不能为空");
    assertOrThrow(Rules.driverNumber(driverNumber), "Driver Number 格式不合法");
    assertOrThrow(Rules.displayName(displayName), "Display Name 太长");
    assertOrThrow(Rules.role(role), "Role 不合法");
    assertOrThrow(Rules.phone(phone), "Phone 太长");
    assertOrThrow(Rules.email(email), "Email 太长");
    assertOrThrow(Rules.vehicleNo(vehicleNo), "Vehicle No 太长");

    if (mode === "create") {
      assertOrThrow(password.length >= 6, "密码至少 6 位");
    }
    if (mode === "update" && password) {
      assertOrThrow(password.length >= 6, "密码至少 6 位");
    }

    return {
      username,
      driverNumber,
      displayName,
      role,
      isActive,
      mustChangePassword,
      vehicleNo,
      phone,
      email,
      password,
    };
  }

  function normalizeCustomerPayload(payload) {
    const accountNumber = safe(payload.accountNumber);
    const accountName = safe(payload.accountName);
    const accountAddress = safe(payload.accountAddress);
    const city = safe(payload.city);
    const route = safe(payload.route);

    assertOrThrow(accountNumber, "Account Number 不能为空");
    assertOrThrow(accountName, "Account Name 不能为空");
    assertOrThrow(city.length <= 60, "City 太长");
    assertOrThrow(route.length <= 60, "Route 太长");

    return { accountNumber, accountName, accountAddress, city, route };
  }

  function sanitizeUsers(list) {
    return (Array.isArray(list) ? list : []).map((u) => {
      const loginName = safe(u.driver_number ?? u.username).toLowerCase();
      return {
        id: safe(u.id),
        username: loginName,
        driverNumber: loginName,
        displayName: safe(u.display_name ?? u.displayName),
        role: safe(u.role || "viewer"),
        isActive: !!(u.is_active ?? u.isActive),
        mustChangePassword: !!(u.must_change_password ?? u.mustChangePassword),
        vehicleNo: safe(u.vehicle_no ?? u.vehicleNo),
        phone: safe(u.phone),
        email: safe(u.email),
        createdAt: safe(u.created_at ?? u.createdAt),
        updatedAt: safe(u.updated_at ?? u.updatedAt),
      };
    });
  }

  function sanitizeCustomers(list) {
    return (Array.isArray(list) ? list : []).map((c) => ({
      id: safe(c.id),
      accountNumber: safe(c.account_number ?? c.accountNumber),
      accountName: safe(c.account_name ?? c.accountName),
      accountAddress: safe(c.account_address ?? c.accountAddress),
      city: safe(c.city),
      route: safe(c.route),
      createdAt: safe(c.created_at ?? c.createdAt),
      updatedAt: safe(c.updated_at ?? c.updatedAt),
    }));
  }

  function parseCsv(text) {
    const t = String(text ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();
    if (!t) return [];

    const lines = [];
    let cur = "";
    let inQ = false;

    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === '"') {
        if (inQ && t[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (ch === "\n" && !inQ) {
        lines.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    if (cur) lines.push(cur);

    const splitRow = (row) => {
      const out = [];
      let s = "";
      let q = false;
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '"') {
          if (q && row[i + 1] === '"') {
            s += '"';
            i++;
          } else {
            q = !q;
          }
        } else if (ch === "," && !q) {
          out.push(s);
          s = "";
        } else {
          s += ch;
        }
      }
      out.push(s);
      return out.map((x) => x.trim());
    };

    const header = splitRow(lines[0]).map((h) => h.replace(/^\uFEFF/, "").trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = splitRow(lines[i]);
      if (cols.every((c) => !c)) continue;
      const obj = {};
      for (let j = 0; j < header.length; j++) obj[header[j]] = cols[j] ?? "";
      rows.push(obj);
    }

    return rows;
  }

  let custPage = 1;
  const CUST_PAGE_SIZE = 5;

  const Api = {
    users: {
      async list() {
        const sb = getSb();
        const { data, error } = await sb
          .from("tdg_profiles")
          .select(
            "id, username, driver_number, display_name, role, is_active, must_change_password, vehicle_no, phone, email, created_at, updated_at"
          )
          .order("driver_number", { ascending: true });

        if (error) throw error;
        return sanitizeUsers(data || []);
      },

      async create(payload) {
        const u = normalizeUserPayload(payload, { mode: "create" });
        const email = canonicalEmailFromDriverNumber(u.driverNumber, u.email);

        const result = await callFn(FN.createUser, {
          username: u.driverNumber,
          driverNumber: u.driverNumber,
          email,
          password: u.password,
          displayName: u.displayName,
          role: u.role,
          vehicleNo: u.vehicleNo,
          phone: u.phone,
          isActive: u.isActive,
          mustChangePassword: u.mustChangePassword,
        });

        return sanitizeUsers([result?.user || result])[0];
      },

      async update(id, patch) {
        const u = normalizeUserPayload(
          {
            driverNumber: patch.driverNumber,
            displayName: patch.displayName,
            role: patch.role,
            isActive: patch.isActive,
            mustChangePassword: patch.mustChangePassword,
            vehicleNo: patch.vehicleNo,
            phone: patch.phone,
            email: patch.email,
            password: patch.password,
          },
          { mode: "update" }
        );

        const result = await callFn(FN.updateUser, {
          id,
          driverNumber: u.driverNumber,
          displayName: u.displayName,
          role: u.role,
          isActive: u.isActive,
          mustChangePassword: u.mustChangePassword,
          vehicleNo: u.vehicleNo,
          phone: u.phone,
          email: u.email,
          password: u.password,
        });

        return sanitizeUsers([result?.user || result])[0];
      },

      async remove(id) {
        await callFn(FN.deleteUser, { id });
        return true;
      },
    },

    customers: {
      async list() {
        const sb = getSb();
        const { data, error } = await sb
          .from("tdg_customers")
          .select(
            "id, account_number, account_name, account_address, city, route, created_at, updated_at"
          )
          .order("account_number", { ascending: true });

        if (error) throw error;
        return sanitizeCustomers(data || []);
      },

      async create(payload) {
        const c = normalizeCustomerPayload(payload);
        const sb = getSb();

        const { data, error } = await sb
          .from("tdg_customers")
          .insert({
            account_number: c.accountNumber,
            account_name: c.accountName,
            account_address: c.accountAddress,
            city: c.city,
            route: c.route,
          })
          .select(
            "id, account_number, account_name, account_address, city, route, created_at, updated_at"
          )
          .single();

        if (error) {
          if (String(error.message || "").toLowerCase().includes("duplicate")) {
            throw new Error("Account Number 已存在");
          }
          throw error;
        }

        return sanitizeCustomers([data])[0];
      },

      async update(id, patch) {
        const c = normalizeCustomerPayload(patch);
        const sb = getSb();

        const { data, error } = await sb
          .from("tdg_customers")
          .update({
            account_number: c.accountNumber,
            account_name: c.accountName,
            account_address: c.accountAddress,
            city: c.city,
            route: c.route,
            updated_at: nowIso(),
          })
          .eq("id", id)
          .select(
            "id, account_number, account_name, account_address, city, route, created_at, updated_at"
          )
          .single();

        if (error) {
          if (String(error.message || "").toLowerCase().includes("duplicate")) {
            throw new Error("Account Number 已存在");
          }
          throw error;
        }

        return sanitizeCustomers([data])[0];
      },

      async remove(id) {
        const sb = getSb();
        const { error } = await sb.from("tdg_customers").delete().eq("id", id);
        if (error) throw error;
        return true;
      },

      async importFromCsvText(csvText) {
        const rows = parseCsv(csvText);
        assertOrThrow(rows.length > 0, "CSV 没有数据");

        const mapped = rows
          .map((r) => ({
            account_number: safe(
              r.accountNumber ??
                r.accountNo ??
                r.no ??
                r.Position ??
                r["Account Number"] ??
                r["AccountNo"] ??
                ""
            ),
            account_name: safe(
              r.accountName ??
                r.name ??
                r["Customer Name"] ??
                r["Account Name"] ??
                ""
            ),
            account_address: safe(
              r.accountAddress ??
                r.address ??
                r.Address ??
                r["Account Address"] ??
                ""
            ),
            city: safe(r.city ?? r.City ?? ""),
            route: safe(r.route ?? r.Route ?? ""),
          }))
          .filter((x) => x.account_number && x.account_name);

        assertOrThrow(mapped.length > 0, "CSV 缺少必要字段（Account Number / Name）");

        const sb = getSb();
        const { error } = await sb.from("tdg_customers").upsert(mapped, {
          onConflict: "account_number",
          ignoreDuplicates: false,
        });

        if (error) throw error;
        return mapped.length;
      },

      async migrateFromLocalStorage() {
        let local = [];
        try {
          local = JSON.parse(localStorage.getItem("tdg_customers_demo_v2") || "[]");
        } catch {
          local = [];
        }

        if (!Array.isArray(local) || !local.length) {
          return 0;
        }

        const rows = local
          .map((c) => ({
            account_number: safe(c.accountNumber),
            account_name: safe(c.accountName),
            account_address: safe(c.accountAddress),
            city: safe(c.city),
            route: safe(c.route),
          }))
          .filter((x) => x.account_number && x.account_name);

        if (!rows.length) return 0;

        const sb = getSb();
        const { error } = await sb.from("tdg_customers").upsert(rows, {
          onConflict: "account_number",
          ignoreDuplicates: false,
        });

        if (error) throw error;

        return rows.length;
      },
    },
  };

  document.querySelectorAll(".tab").forEach((t) => {
    on(
      t,
      "click",
      () => {
        document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");

        const tab = t.getAttribute("data-tab");
        if ($("panel-users")) $("panel-users").style.display = tab === "users" ? "" : "none";
        if ($("panel-customers")) $("panel-customers").style.display = tab === "customers" ? "" : "none";
        if ($("panel-tools")) $("panel-tools").style.display = tab === "tools" ? "" : "none";

        renderAll();
      },
      { passive: true }
    );
  });

  async function renderUsers() {
    const wrap = $("usersTableWrap");
    if (!wrap) return;

    let users = [];
    try {
      const q = lower($("userSearch")?.value);
      users = await Api.users.list();

      if (q) {
        users = users.filter(
          (u) =>
            lower(u.username).includes(q) ||
            lower(u.driverNumber).includes(q) ||
            lower(u.displayName).includes(q) ||
            lower(u.email).includes(q) ||
            lower(u.phone).includes(q)
        );
      }

      users.sort((a, b) => safe(a.driverNumber).localeCompare(safe(b.driverNumber)));
    } catch (e) {
      wrap.innerHTML = `<div class="empty">加载失败：${escapeHtml(e.message || "error")}</div>`;
      return;
    }

    const rows = users
      .map((u) => {
        const roleChip = `<span class="chip">${escapeHtml(u.role)}</span>`;
        const activeChip = `<span class="chip">${u.isActive ? "active" : "disabled"}</span>`;
        const must = u.mustChangePassword ? `<span class="chip">must change pwd</span>` : "";
        const sub = [
          u.displayName ? escapeHtml(u.displayName) : "",
          u.vehicleNo ? `Vehicle: ${escapeHtml(u.vehicleNo)}` : "",
          u.phone ? `Phone: ${escapeHtml(u.phone)}` : "",
          u.email ? `Email: ${escapeHtml(u.email)}` : "",
        ]
          .filter(Boolean)
          .join(" · ");

        return `
          <tr>
            <td>
              <div style="font-weight:800">${escapeHtml(u.driverNumber)}</div>
              ${sub ? `<div class="muted" style="margin-top:6px">${sub}</div>` : ""}
            </td>
            <td>${roleChip} ${activeChip} ${must}</td>
            <td>
              <div class="muted">Created: ${
                u.createdAt ? escapeHtml(u.createdAt.slice(0, 19).replace("T", " ")) : "-"
              }</div>
              <div class="muted">Updated: ${
                u.updatedAt ? escapeHtml(u.updatedAt.slice(0, 19).replace("T", " ")) : "-"
              }</div>
            </td>
            <td style="white-space:nowrap">
              <button class="btn secondary" data-act="user-edit" data-id="${escapeHtml(
                u.id
              )}" type="button">编辑</button>
              <button class="btn warn" data-act="user-del" data-id="${escapeHtml(
                u.id
              )}" data-name="${escapeHtml(u.driverNumber || u.username)}" type="button">删除</button>
            </td>
          </tr>
        `;
      })
      .join("");

    wrap.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>User</th><th>角色/状态</th><th>时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="4">无数据</td></tr>`}</tbody>
      </table>
    `;
  }

  function userFormHtml({ mode, data }) {
    const u = data || {};
    const isEdit = mode === "edit";

    return `
      <div>
        <label>Driver Number / Login ID</label>
        <input id="f_driverNumber" value="${escapeHtml(
          u.driverNumber || u.username || ""
        )}" placeholder="999999" />
      </div>

      <div class="row2" style="margin-top:10px">
        <div>
          <label>Display Name</label>
          <input id="f_displayName" value="${escapeHtml(u.displayName || "")}" />
        </div>
        <div>
          <label>Role</label>
          <select id="f_role">
            <option value="driver" ${u.role === "driver" ? "selected" : ""}>driver</option>
            <option value="viewer" ${u.role === "viewer" ? "selected" : ""}>viewer</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
          </select>
        </div>
      </div>

      <div class="row2" style="margin-top:10px">
        <div>
          <label>Vehicle No</label>
          <input id="f_vehicleNo" value="${escapeHtml(u.vehicleNo || "")}" />
        </div>
        <div>
          <label>Status</label>
          <select id="f_active">
            <option value="1" ${u.isActive !== false ? "selected" : ""}>active</option>
            <option value="0" ${u.isActive === false ? "selected" : ""}>disabled</option>
          </select>
        </div>
      </div>

      <div class="row2" style="margin-top:10px">
        <div>
          <label>Phone</label>
          <input id="f_phone" value="${escapeHtml(u.phone || "")}" />
        </div>
        <div>
          <label>Email</label>
          <input id="f_email" value="${escapeHtml(u.email || "")}" />
        </div>
      </div>

      <div class="row2" style="margin-top:10px">
        <div>
          <label>${isEdit ? "New Password（留空不改）" : "Initial Password"}</label>
          <input id="f_password" type="password" />
        </div>
        <div style="display:flex;align-items:end">
          <label style="display:flex;align-items:center;gap:8px;margin:0">
            <input id="f_mustChange" type="checkbox" ${u.mustChangePassword ? "checked" : ""} />
            must change password on next login
          </label>
        </div>
      </div>

      <div class="divider"></div>
      <div class="right-actions">
        <button class="btn secondary" id="btnCancel" type="button">Cancel</button>
        <button class="btn ok" id="btnSave" type="button">${isEdit ? "Save" : "Add"}</button>
      </div>
    `;
  }

  async function openCreateUser() {
    const modal = openModal("Create User", userFormHtml({ mode: "create", data: {} }), {
      onClose: renderAll,
    });

    $("btnCancel").onclick = () => modal.close();
    $("btnSave").onclick = async () => {
      try {
        const payload = {
          driverNumber: safe($("f_driverNumber").value),
          displayName: safe($("f_displayName").value),
          role: $("f_role").value,
          isActive: $("f_active").value === "1",
          mustChangePassword: $("f_mustChange").checked,
          vehicleNo: safe($("f_vehicleNo").value),
          phone: safe($("f_phone").value),
          email: safe($("f_email").value),
          password: safe($("f_password").value),
        };

        await Api.users.create(payload);
        modal.close();
        alert("已创建");
      } catch (e) {
        showApiError(e, "创建失败");
      }
    };
  }

  async function openEditUser(id) {
    let users;
    try {
      users = await Api.users.list();
    } catch {
      return alert("加载用户失败");
    }

    const u = users.find((x) => x.id === id);
    if (!u) return alert("用户不存在");

    const modal = openModal("编辑用户", userFormHtml({ mode: "edit", data: u }), {
      onClose: renderAll,
    });

    $("btnCancel").onclick = () => modal.close();
    $("btnSave").onclick = async () => {
      try {
        const patch = {
          driverNumber: safe($("f_driverNumber").value),
          displayName: safe($("f_displayName").value),
          role: $("f_role").value,
          isActive: $("f_active").value === "1",
          mustChangePassword: $("f_mustChange").checked,
          vehicleNo: safe($("f_vehicleNo").value),
          phone: safe($("f_phone").value),
          email: safe($("f_email").value),
          password: safe($("f_password").value),
        };

        await Api.users.update(id, patch);
        modal.close();
        alert("已保存");
      } catch (e) {
        showApiError(e, "保存失败");
      }
    };
  }

  async function deleteUser(id, name) {
    if (!confirm(`确定删除用户：${name || id} ?`)) return;

    try {
      await Api.users.remove(id);
      alert("已删除");
      renderAll();
    } catch (e) {
      showApiError(e, "删除失败");
    }
  }

  async function renderCustomers() {
    const wrap = $("customersTableWrap");
    if (!wrap) return;

    let list;
    try {
      list = await Api.customers.list();
    } catch (e) {
      wrap.innerHTML = `<div class="empty">加载失败：${escapeHtml(e.message || "error")}</div>`;
      return;
    }

    const q = lower($("custSearch")?.value);
    let filtered = list;
    if (q) {
      filtered = list.filter(
        (c) =>
          lower(c.accountNumber).includes(q) ||
          lower(c.accountName).includes(q) ||
          lower(c.accountAddress).includes(q) ||
          lower(c.city).includes(q) ||
          lower(c.route).includes(q)
      );
    }

    const all = filtered
      .slice()
      .sort((a, b) => safe(a.accountNumber).localeCompare(safe(b.accountNumber)));

    if (!all.length) {
      wrap.innerHTML = `<div class="empty">无数据</div>`;
      return;
    }

    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / CUST_PAGE_SIZE));
    custPage = Math.min(Math.max(1, custPage), totalPages);

    const start = (custPage - 1) * CUST_PAGE_SIZE;
    const pageItems = all.slice(start, start + CUST_PAGE_SIZE);

    const rows = pageItems
      .map((c) => {
        return `
          <tr>
            <td>
              <div style="font-weight:800">${escapeHtml(c.accountNumber)}</div>
              <div class="muted" style="margin-top:6px">${escapeHtml(c.accountName)}</div>
            </td>
            <td class="muted">${escapeHtml(c.accountAddress || "")}</td>
            <td class="muted">${escapeHtml(c.city || "")}</td>
            <td class="muted">${escapeHtml(c.route || "")}</td>
            <td style="white-space:nowrap">
              <button class="btn secondary" data-act="cust-edit" data-id="${escapeHtml(
                c.id
              )}" type="button">编辑</button>
              <button class="btn warn" data-act="cust-del" data-id="${escapeHtml(
                c.id
              )}" type="button">删除</button>
            </td>
          </tr>
        `;
      })
      .join("");

    wrap.innerHTML = `
      <table class="table">
        <thead>
          <tr><th>Account</th><th>Address</th><th>City</th><th>Route</th><th>操作</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="grid-actions" style="justify-content:flex-end; margin-top:10px">
        <span class="muted" style="margin-right:auto">
          Showing ${start + 1}-${Math.min(start + CUST_PAGE_SIZE, total)} of ${total}
        </span>

        <button class="btn secondary" type="button" data-act="cust-page-prev" ${
          custPage === 1 ? "disabled" : ""
        }>Prev</button>
        <span class="chip">Page ${custPage} / ${totalPages}</span>
        <button class="btn secondary" type="button" data-act="cust-page-next" ${
          custPage === totalPages ? "disabled" : ""
        }>Next</button>
      </div>
    `;
  }

  function customerFormHtml({ mode, data }) {
    const c = data || {};
    const isEdit = mode === "edit";

    return `
      <div class="row2">
        <div>
          <label>Account Number</label>
          <input id="c_no" value="${escapeHtml(c.accountNumber || "")}" placeholder="1008" />
        </div>
        <div>
          <label>Account Name</label>
          <input id="c_name" value="${escapeHtml(c.accountName || "")}" placeholder="Customer Name" />
        </div>
      </div>

      <div style="margin-top:10px">
        <label>Account Address</label>
        <input id="c_addr" value="${escapeHtml(
          c.accountAddress || ""
        )}" placeholder="Street, City, Province" />
      </div>

      <div class="row2" style="margin-top:10px">
        <div>
          <label>City</label>
          <input id="c_city" value="${escapeHtml(c.city || "")}" placeholder="Winnipeg" />
        </div>
        <div>
          <label>Route</label>
          <input id="c_route" value="${escapeHtml(c.route || "")}" placeholder="R-01" />
        </div>
      </div>

      <div class="divider"></div>
      <div class="right-actions">
        <button class="btn secondary" id="btnCancel" type="button">Cancel</button>
        <button class="btn ok" id="btnSave" type="button">${isEdit ? "保存" : "创建"}</button>
      </div>
    `;
  }

  function openCreateCustomer() {
    const modal = openModal("新增客户", customerFormHtml({ mode: "create", data: {} }), {
      onClose: renderAll,
    });

    $("btnCancel").onclick = () => modal.close();
    $("btnSave").onclick = async () => {
      try {
        const payload = {
          accountNumber: safe($("c_no").value),
          accountName: safe($("c_name").value),
          accountAddress: safe($("c_addr").value),
          city: safe($("c_city").value),
          route: safe($("c_route").value),
        };
        await Api.customers.create(payload);
        modal.close();
        alert("已创建");
      } catch (e) {
        alert(e.message || "创建失败");
      }
    };
  }

  async function openEditCustomer(id) {
    const list = await Api.customers.list();
    const c = list.find((x) => x.id === id);
    if (!c) return alert("客户不存在");

    const modal = openModal("编辑客户", customerFormHtml({ mode: "edit", data: c }), {
      onClose: renderAll,
    });

    $("btnCancel").onclick = () => modal.close();
    $("btnSave").onclick = async () => {
      try {
        const patch = {
          accountNumber: safe($("c_no").value),
          accountName: safe($("c_name").value),
          accountAddress: safe($("c_addr").value),
          city: safe($("c_city").value),
          route: safe($("c_route").value),
        };
        await Api.customers.update(id, patch);
        modal.close();
        alert("已保存");
      } catch (e) {
        alert(e.message || "保存失败");
      }
    };
  }

  async function deleteCustomer(id) {
    const list = await Api.customers.list();
    const c = list.find((x) => x.id === id);
    if (!c) return alert("客户不存在");

    if (!confirm(`确定删除客户：${c.accountNumber} / ${c.accountName} ?`)) return;

    try {
      await Api.customers.remove(id);
      alert("已删除");
      renderAll();
    } catch (e) {
      alert(e.message || "删除失败");
    }
  }

  on($("userSearch"), "input", () => renderUsers(), { passive: true });

  on(
    $("custSearch"),
    "input",
    () => {
      custPage = 1;
      renderCustomers();
    },
    { passive: true }
  );

  on($("btnAddUser"), "click", () => openCreateUser(), { passive: true });
  on($("btnAddCustomer"), "click", () => openCreateCustomer(), { passive: true });

  on($("importCustomersCsv"), "change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;

    try {
      const text = await f.text();
      const n = await Api.customers.importFromCsvText(text);
      alert(`导入成功（合并后共 ${n} 条）`);
      renderCustomers();
    } catch (err) {
      alert(err.message || "CSV 导入失败");
    }
  });

  on(document, "click", (e) => {
    const btn = e.target?.closest?.("button[data-act]");
    if (!btn) return;

    const act = btn.getAttribute("data-act");
    console.log("clicked act =", act, btn);

    if (act === "cust-page-prev") {
      custPage = Math.max(1, custPage - 1);
      return renderCustomers();
    }

    if (act === "cust-page-next") {
      custPage = custPage + 1;
      return renderCustomers();
    }

    if (act === "user-edit") {
      return openEditUser(btn.getAttribute("data-id"));
    }

    if (act === "user-del") {
      return deleteUser(btn.getAttribute("data-id"), btn.getAttribute("data-name"));
    }

    if (act === "cust-edit") {
      return openEditCustomer(btn.getAttribute("data-id"));
    }

    if (act === "cust-del") {
      return deleteCustomer(btn.getAttribute("data-id"));
    }
  });

  on($("btnDangerResetAll"), "click", () => {
    if (!confirm("⚠️确定清空所有本地数据？（不可恢复）")) return;
    localStorage.clear();
    sessionStorage.clear();
    alert("已清空。将返回登录页。");
    window.location.href = "./login.html";
  });

  function renderAll() {
    renderUsers();
    renderCustomers();
  }

  requireAdminPageAccess().then((ok) => {
  if (ok) {
    renderAll();
  }
});
