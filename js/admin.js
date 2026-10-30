/* /js/admin.js
 * Admin page (website only, Admin accounts only; ROLES_PROPOSAL.md decisions 6, 8, 13):
 * - Users: public.tdg_profiles, the five roles
 * - Create / update / deactivate users through the new site's Edge Functions
 *   (tdg-admin-create-user, tdg-admin-update-user); the current site keeps admin-*.
 * - Customers and reload plants moved to the Customers page (js/app/customers.js).
 *
 * IMPORTANT:
 * - username === driver_number
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  const safe = (v) => String(v ?? "").trim();
  const lower = (v) => safe(v).toLowerCase();

  const escapeHtml = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const SIGNED_OUT = "Your sign-in has expired. Please sign in again.";
  const ROLES = [
    ["admin", "Admin"],
    ["supervisor", "Supervisor"],
    ["manager", "Manager"],
    ["driver", "Driver"],
    ["viewer", "Viewer"],
  ];
  const roleLabel = (r) => (ROLES.find(([k]) => k === r) || [r, r])[1];

  function getSb() {
    const sb = window.supabaseClient;
    if (!sb?.from || !sb?.auth) throw new Error("Supabase client not initialized");
    return sb;
  }

  async function requireAdminPageAccess() {
    const sb = getSb();
    const tdgSession = await window.TDG_AUTH?.requireAuthAsync?.({ roles: ["admin"] });
    if (!tdgSession) return false;

    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError || !user) {
      alert(SIGNED_OUT);
      window.location.replace("./login.html");
      return false;
    }

    const { data: profile, error: profileError } = await sb
      .from("tdg_profiles")
      .select("id, username, display_name, role, email, is_active")
      .eq("id", user.id)
      .single();
    if (profileError || !profile) {
      alert("Your account was not found. Please sign in again.");
      window.location.replace("./login.html");
      return false;
    }
    if (profile.role !== "admin" || !profile.is_active) {
      alert("Only admin accounts can open this page.");
      window.location.replace("./index.html");
      return false;
    }

    if ($("who")) $("who").textContent = `Signed in: ${profile.display_name || profile.username} (${roleLabel(profile.role)})`;
    on($("btnLogout"), "click", async () => { await window.TDG_AUTH.logout(); });
    return true;
  }

  // Edge Function call with the admin's session; a 401 refreshes the session and retries once.
  async function callFn(name, payload) {
    const sb = getSb();
    const base = String(window.SUPABASE_URL || "").replace(/\/+$/, "");
    const anonKey = String(window.SUPABASE_ANON_KEY || "").trim();
    if (!base) throw new Error("SUPABASE_URL missing");
    if (!anonKey) throw new Error("SUPABASE_ANON_KEY missing");

    async function readSession(refresh = false) {
      const { data, error } = refresh ? await sb.auth.refreshSession() : await sb.auth.getSession();
      if (error) throw new Error(`${SIGNED_OUT} (${error.message || "Unknown auth error"})`);
      return data?.session || null;
    }

    async function send(session) {
      const token = session?.access_token;
      if (!token) throw new Error(SIGNED_OUT);
      let response;
      try {
        response = await fetch(`${base}/functions/v1/${name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", apikey: anonKey, Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload ?? {}),
        });
      } catch {
        throw new Error("No connection to the server. Check the internet connection and try again.");
      }
      const text = await response.text();
      let body = null;
      if (text) { try { body = JSON.parse(text); } catch { body = { message: text }; } }
      return { response, body };
    }

    let result = await send(await readSession());
    if (result.response.status === 401) result = await send(await readSession(true));

    const { response, body } = result;
    if (!response.ok) {
      const msg = body?.detail || body?.error_description || body?.error || body?.message || `${name} failed (${response.status})`;
      if (response.status === 401) throw new Error(`${SIGNED_OUT} (${msg})`);
      if (response.status === 403) throw new Error(msg || "Your account cannot do this.");
      if (response.status === 404) throw new Error(`The server function ${name} is not deployed.`);
      if (response.status === 409) throw new Error(msg || "This user already exists.");
      if (response.status >= 500) throw new Error(`Server error: ${msg}`);
      throw new Error(msg);
    }
    return body;
  }

  function showApiError(err, fallback) {
    const msg = String(err?.message || fallback);
    alert(msg);
    if (msg.startsWith(SIGNED_OUT) || msg.includes("Invalid session") || msg.includes("Missing bearer token")) window.location.href = "./login.html";
  }

  const FN = {
    createUser: "tdg-admin-create-user",
    updateUser: "tdg-admin-update-user",
  };

  function openModal(title, bodyHtml, { onClose } = {}) {
    const backdrop = $("modalBackdrop");
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = bodyHtml;
    backdrop.style.display = "flex";
    backdrop.setAttribute("aria-hidden", "false");
    let closed = false;
    const esc = (ev) => { if (ev.key === "Escape") close(); };
    const close = () => {
      if (closed) return;
      closed = true;
      backdrop.style.display = "none";
      backdrop.setAttribute("aria-hidden", "true");
      $("modalBody").innerHTML = "";
      document.removeEventListener("keydown", esc);
      backdrop.onclick = null;
      onClose && onClose();
    };
    backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
    document.addEventListener("keydown", esc);
    return { close };
  }

  const Rules = {
    driverNumber: (v) => /^[A-Za-z0-9._-]{2,32}$/.test(v),
    displayName: (v) => safe(v).length > 0 && safe(v).length <= 60,
    role: (v) => ROLES.some(([k]) => k === v),
    phone: (v) => safe(v).length <= 40,
    email: (v) => /^\S+@\S+\.\S+$/.test(safe(v)) && safe(v).length <= 120,
    vehicleNo: (v) => safe(v).length <= 40,
  };
  function assertOrThrow(cond, msg) { if (!cond) throw new Error(msg); }

  function normalizeUserPayload(payload, { mode = "update" } = {}) {
    const driverNumber = safe(payload.driverNumber).toLowerCase();
    const u = {
      driverNumber,
      username: driverNumber,
      displayName: safe(payload.displayName),
      role: safe(payload.role || "driver"),
      isActive: payload.isActive !== false,
      mustChangePassword: !!payload.mustChangePassword,
      vehicleNo: safe(payload.vehicleNo),
      phone: safe(payload.phone),
      email: lower(payload.email),
      password: String(payload.password ?? ""),
    };
    assertOrThrow(driverNumber, "Enter the Driver Number.");
    assertOrThrow(Rules.driverNumber(driverNumber), "Driver Number: 2–32 letters, digits, dots, dashes or underscores.");
    assertOrThrow(Rules.displayName(u.displayName), "Enter the display name (up to 60 characters).");
    assertOrThrow(Rules.role(u.role), "Choose a role.");
    assertOrThrow(Rules.phone(u.phone), "Phone is too long.");
    assertOrThrow(Rules.email(u.email), "Enter the user's work email.");
    assertOrThrow(Rules.vehicleNo(u.vehicleNo), "Vehicle No is too long.");
    if (mode === "create" || u.password) assertOrThrow(u.password.length >= 12, "The password needs at least 12 characters.");
    return u;
  }

  function sanitizeUsers(list) {
    return (Array.isArray(list) ? list : []).map((u) => {
      const loginName = lower(u.driver_number ?? u.username);
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

  const Api = {
    async list() {
      const { data, error } = await TDG_CORE.paged(getSb()
        .from("tdg_profiles")
        .select("id, username, driver_number, display_name, role, is_active, must_change_password, vehicle_no, phone, email, created_at, updated_at")
        .order("driver_number", { ascending: true }));
      if (error) throw error;
      return sanitizeUsers(data || []);
    },
    async create(payload) {
      const u = normalizeUserPayload(payload, { mode: "create" });
      const result = await callFn(FN.createUser, {
        username: u.driverNumber, driverNumber: u.driverNumber, email: u.email, password: u.password,
        displayName: u.displayName, role: u.role, vehicleNo: u.vehicleNo, phone: u.phone,
        isActive: u.isActive, mustChangePassword: u.mustChangePassword,
      });
      return sanitizeUsers([result?.user || result])[0];
    },
    async update(id, patch) {
      const u = normalizeUserPayload(patch, { mode: "update" });
      const result = await callFn(FN.updateUser, {
        id, expectedUpdatedAt: patch.expectedUpdatedAt,
        driverNumber: u.driverNumber, displayName: u.displayName, role: u.role, isActive: u.isActive,
        mustChangePassword: u.mustChangePassword, vehicleNo: u.vehicleNo, phone: u.phone, email: u.email,
        password: u.password || undefined,
      });
      return sanitizeUsers([result?.user || result])[0];
    },
    // Deactivating keeps the account and its history; the last active Admin cannot be deactivated.
    async deactivate(u) {
      return Api.update(u.id, { ...u, isActive: false, password: "", expectedUpdatedAt: u.updatedAt });
    },
  };

  // The website's Users page (js/app/web_admin.js) uses the same calls and rules.
  window.TDG_ADMIN = { Api, ROLES, Rules };

  const stamp = (iso) => (iso ? escapeHtml(iso.slice(0, 19).replace("T", " ")) : "-");

  async function renderUsers() {
    const wrap = $("usersTableWrap");
    if (!wrap) return;
    let users;
    try {
      const q = lower($("userSearch")?.value);
      users = await Api.list();
      if (q) users = users.filter((u) => [u.driverNumber, u.displayName, u.email, u.phone].some((v) => lower(v).includes(q)));
      users.sort((a, b) => a.driverNumber.localeCompare(b.driverNumber));
    } catch (e) {
      wrap.innerHTML = `<div class="empty">Users not loaded: ${escapeHtml(e.message || "error")}</div>`;
      return;
    }
    const rows = users.map((u) => {
      const sub = [
        u.displayName ? escapeHtml(u.displayName) : "",
        u.vehicleNo ? `Vehicle: ${escapeHtml(u.vehicleNo)}` : "",
        u.phone ? `Phone: ${escapeHtml(u.phone)}` : "",
        u.email ? `Email: ${escapeHtml(u.email)}` : "",
      ].filter(Boolean).join(" · ");
      return `
        <tr data-user="${escapeHtml(u.driverNumber)}">
          <td>
            <div style="font-weight:800">${escapeHtml(u.driverNumber)}</div>
            ${sub ? `<div class="muted" style="margin-top:6px">${sub}</div>` : ""}
          </td>
          <td><span class="chip">${escapeHtml(roleLabel(u.role))}</span> <span class="chip">${u.isActive ? "Active" : "Deactivated"}</span>${u.mustChangePassword ? ` <span class="chip">Must change password</span>` : ""}</td>
          <td><div class="muted">Created: ${stamp(u.createdAt)}</div><div class="muted">Updated: ${stamp(u.updatedAt)}</div></td>
          <td style="white-space:nowrap">
            <button class="btn secondary" data-act="user-edit" data-id="${escapeHtml(u.id)}" type="button">Edit</button>
            ${u.isActive ? `<button class="btn warn" data-act="user-off" data-id="${escapeHtml(u.id)}" type="button">Deactivate</button>` : ""}
          </td>
        </tr>`;
    }).join("");
    wrap.innerHTML = `
      <table class="table">
        <thead><tr><th>User</th><th>Role / status</th><th>Time</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4">No users.</td></tr>`}</tbody>
      </table>`;
  }

  function userFormHtml({ mode, data }) {
    const u = data || {};
    const isEdit = mode === "edit";
    const role = u.role || "driver";
    return `
      <div>
        <label for="f_driverNumber">Driver Number (sign-in)</label>
        <input id="f_driverNumber" value="${escapeHtml(u.driverNumber || "")}" placeholder="999999" />
      </div>
      <div class="row2" style="margin-top:10px">
        <div><label for="f_displayName">Display Name</label><input id="f_displayName" value="${escapeHtml(u.displayName || "")}" /></div>
        <div><label for="f_role">Role</label>
          <select id="f_role">${ROLES.map(([k, n]) => `<option value="${k}" ${role === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      </div>
      <div class="row2" style="margin-top:10px">
        <div><label for="f_vehicleNo">Vehicle No</label><input id="f_vehicleNo" value="${escapeHtml(u.vehicleNo || "")}" /></div>
        <div><label for="f_active">Status</label>
          <select id="f_active"><option value="1" ${u.isActive !== false ? "selected" : ""}>Active</option><option value="0" ${u.isActive === false ? "selected" : ""}>Deactivated</option></select></div>
      </div>
      <div class="row2" style="margin-top:10px">
        <div><label for="f_phone">Phone</label><input id="f_phone" value="${escapeHtml(u.phone || "")}" /></div>
        <div><label for="f_email">Email</label><input id="f_email" value="${escapeHtml(u.email || "")}" /></div>
      </div>
      <div class="row2" style="margin-top:10px">
        <div><label for="f_password">${isEdit ? "New password (leave empty to keep it)" : "First password"}</label><input id="f_password" type="password" autocomplete="new-password" /></div>
        <div style="display:flex;align-items:end">
          <label style="display:flex;align-items:center;gap:8px;margin:0">
            <input id="f_mustChange" type="checkbox" ${u.mustChangePassword || !isEdit ? "checked" : ""} />
            Must change the password at the next sign-in
          </label>
        </div>
      </div>
      <p class="muted" style="margin-top:10px">Supervisors and Managers use the new website and app only. Only Admins manage users.</p>
      <div class="divider"></div>
      <div class="right-actions">
        <button class="btn secondary" id="btnCancel" type="button">Cancel</button>
        <button class="btn ok" id="btnSave" type="button">${isEdit ? "Save" : "Add"}</button>
      </div>`;
  }

  const readForm = () => ({
    driverNumber: safe($("f_driverNumber").value),
    displayName: safe($("f_displayName").value),
    role: $("f_role").value,
    isActive: $("f_active").value === "1",
    mustChangePassword: $("f_mustChange").checked,
    vehicleNo: safe($("f_vehicleNo").value),
    phone: safe($("f_phone").value),
    email: safe($("f_email").value),
    password: String($("f_password").value),
  });

  function openCreateUser() {
    const modal = openModal("Add User", userFormHtml({ mode: "create", data: {} }), { onClose: renderUsers });
    $("btnCancel").onclick = () => modal.close();
    $("btnSave").onclick = async () => {
      try {
        await Api.create(readForm());
        modal.close();
        alert("User added.");
      } catch (e) {
        showApiError(e, "User not added.");
      }
    };
  }

  async function findUser(id) {
    try { return (await Api.list()).find((x) => x.id === id) || null; } catch { alert("Users not loaded. Try again."); return undefined; }
  }

  async function openEditUser(id) {
    const u = await findUser(id);
    if (u === undefined) return;
    if (!u) return alert("This user no longer exists.");
    const modal = openModal(`Edit User · ${u.driverNumber}`, userFormHtml({ mode: "edit", data: u }), { onClose: renderUsers });
    $("btnCancel").onclick = () => modal.close();
    $("btnSave").onclick = async () => {
      try {
        await Api.update(id, { ...readForm(), expectedUpdatedAt: u.updatedAt });
        modal.close();
        alert("Saved.");
      } catch (e) {
        showApiError(e, "Not saved.");
      }
    };
  }

  async function deactivateUser(id) {
    const u = await findUser(id);
    if (!u) return;
    if (!confirm(`Deactivate ${u.driverNumber}${u.displayName ? ` (${u.displayName})` : ""}? The account can no longer sign in; its records stay.`)) return;
    try {
      await Api.deactivate(u);
      alert("Deactivated. The records stay.");
      renderUsers();
    } catch (e) {
      showApiError(e, "Not deactivated.");
    }
  }

  if (!$("panel-users")) return; // loaded by the website's own pages for TDG_ADMIN only
  on($("userSearch"), "input", () => renderUsers(), { passive: true });
  on($("btnAddUser"), "click", () => openCreateUser(), { passive: true });
  on(document, "click", (e) => {
    const btn = e.target?.closest?.("button[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    if (act === "user-edit") return openEditUser(btn.getAttribute("data-id"));
    if (act === "user-off") return deactivateUser(btn.getAttribute("data-id"));
  });

  requireAdminPageAccess().then((ok) => { if (ok) renderUsers(); });
})();
