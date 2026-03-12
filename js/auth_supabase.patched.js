/* /js/auth_supabase.js
 * Supabase-only Auth
 *
 * Login strategy:
 * - User enters Driver Number + password
 * - We sign in to Supabase using email = `${driverNumber}@tdg.com`
 * - Role / profile are read from public.tdg_profiles (id = auth.users.id)
 *
 * IMPORTANT:
 * - username === driver_number
 */
(() => {
  const SS_SESSION = "tdg_session_v1";
  const LS_USERS = "tdg_users_compat_v1";

  const nowIso = () => new Date().toISOString();
  const safe = (s) => String(s ?? "").trim();

  function getSupabaseClient() {
    if (window.supabaseClient?.auth && window.supabaseClient?.from) {
      return window.supabaseClient;
    }

    try {
      const url = window.SUPABASE_URL;
      const key = window.SUPABASE_ANON_KEY;
      if (window.supabase?.createClient && url && key) {
        window.supabaseClient = window.supabase.createClient(url, key);
        return window.supabaseClient;
      }
    } catch {}

    return null;
  }

  function getSession() {
    try {
      return JSON.parse(sessionStorage.getItem(SS_SESSION) || "null");
    } catch {
      return null;
    }
  }

  function setSession(sess) {
    sessionStorage.setItem(SS_SESSION, JSON.stringify(sess));
  }

  function clearSession() {
    sessionStorage.removeItem(SS_SESSION);
  }

  function syncProfileToLegacyLS() {
    const sess = getSession();
    if (!sess) return;

    const LS_PROFILE = "tdg_user_profile_v2";
    const profile = {
      driverNumber: sess.driverNumber || "",
      driverName: sess.displayName || sess.username || "",
      vehicleNo: sess.vehicleNo || "",
    };

    try {
      localStorage.setItem(LS_PROFILE, JSON.stringify(profile));
    } catch {}
  }

  async function fetchProfileByUserId(userId) {
    const sb = getSupabaseClient();
    if (!sb) throw new Error("Supabase client not initialized");

    const { data, error } = await sb
      .from("tdg_profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) throw error;
    return data;
  }

  async function refreshSessionFromSupabase() {
    const sb = getSupabaseClient();
    if (!sb?.auth) return null;

    const { data, error } = await sb.auth.getSession();
    if (error) return null;

    const user = data?.session?.user;
    if (!user) return null;

    try {
      const profile = await fetchProfileByUserId(user.id);

      if (profile && profile.is_active === false) {
        await sb.auth.signOut();
        clearSession();
        return null;
      }

      const loginName =
        safe(profile?.driver_number) ||
        safe(profile?.username) ||
        safe(user.email).split("@")[0];

      const sess = {
        userId: user.id,
        username: loginName,
        displayName: profile?.display_name || loginName,
        role: profile?.role || "driver",
        driverNumber: loginName,
        vehicleNo: profile?.vehicle_no || "",
        loginAt: nowIso(),
      };

      setSession(sess);
      syncProfileToLegacyLS();
      return sess;
    } catch (e) {
      console.warn("Session refresh failed:", e);
      return null;
    }
  }

  async function authenticate(username, password) {
    const u = safe(username).toLowerCase();
    const p = safe(password);

    const sb = getSupabaseClient();
    if (!sb?.auth) {
      return { ok: false, msg: "Supabase client not initialized" };
    }

    try {
      const email = `${u}@tdg.com`;

      const { data, error } = await sb.auth.signInWithPassword({
        email,
        password: p,
      });

      if (error) {
        clearSession();
        return { ok: false, msg: error.message };
      }

      const userId = data?.user?.id;
      if (!userId) {
        clearSession();
        return { ok: false, msg: "Login failed (no user id)" };
      }

      const profile = await fetchProfileByUserId(userId);

      if (profile && profile.is_active === false) {
        await sb.auth.signOut();
        clearSession();
        return { ok: false, msg: "用户已停用" };
      }

      const loginName =
        safe(profile?.driver_number) ||
        safe(profile?.username) ||
        u;

      const sess = {
        userId,
        username: loginName,
        displayName: profile?.display_name || loginName,
        role: profile?.role || "driver",
        driverNumber: loginName,
        vehicleNo: profile?.vehicle_no || "",
        loginAt: nowIso(),
      };

      setSession(sess);
      syncProfileToLegacyLS();

// 登录成功后：强制从云端同步客户库，并覆盖本地
try {
  if (window.TDG_SYNC?.ensureDailyCloudSyncAfterLogin) {
    await window.TDG_SYNC.ensureDailyCloudSyncAfterLogin({ force: true, silent: true });
  } else {
    await window.TDG_CUSTOMERS?.syncFromServer?.({ silent: true });
  }
} catch (e) {
  console.warn("Customer sync after login failed:", e);
}

return { ok: true, user: profile || { id: userId, username: loginName } };
    } catch (e) {
      clearSession();
      return { ok: false, msg: "登录失败: " + (e?.message || e) };
    }
  }

  function requireAuth({ roles } = {}) {
    const sess = getSession();

    if (!sess || !sess.userId) {
      const path = String(window.location.pathname || "").toLowerCase();
      if (!path.includes("login.html")) {
        window.location.href = "./login.html";
      }
      return null;
    }

    if (Array.isArray(roles) && roles.length && !roles.includes(sess.role)) {
      alert("权限不足（Access Denied）");
      window.location.href = "./index.html";
      return null;
    }

    return sess;
  }

  async function logout() {
    try {
      const sb = getSupabaseClient();
      await sb?.auth?.signOut?.();
    } catch {}

    clearSession();
    window.location.href = "./login.html";
  }

  // ===== compatibility only =====
  // 这些函数是为了兼容旧代码保留的，新 admin.js 实际上已不依赖它们
  function getUsers() {
    try {
      return JSON.parse(localStorage.getItem(LS_USERS) || "[]");
    } catch {
      return [];
    }
  }

  function setUsers(users) {
    localStorage.setItem(
      LS_USERS,
      JSON.stringify(Array.isArray(users) ? users : [])
    );
  }

  async function ensureSeedAdmin() {
    return;
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(String(text ?? ""))
    );
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  (async () => {
  try {
    const restored = await refreshSessionFromSupabase();
    if (restored) {
      console.log("Session restored from Supabase");

      try {
        if (window.TDG_SYNC?.ensureDailyCloudSyncAfterLogin) {
          await window.TDG_SYNC.ensureDailyCloudSyncAfterLogin({ force: true, silent: true });
        } else {
          if (window.TDG_SYNC?.ensureDailyCloudSyncAfterLogin) {
    await window.TDG_SYNC.ensureDailyCloudSyncAfterLogin({ force: true, silent: true });
  } else {
    await window.TDG_CUSTOMERS?.syncFromServer?.({ silent: true });
  }
        }
      } catch (e) {
        console.warn("Customer sync after session restore failed:", e);
      }
    }
  } catch (e) {
    console.warn("Initial session restore failed:", e);
  }
})();

  window.TDG_AUTH = {
    authenticate,
    getSession,
    requireAuth,
    logout,
    syncProfileToLegacyLS,
    refreshSessionFromSupabase,

    // compatibility
    getUsers,
    setUsers,
    ensureSeedAdmin,
    sha256,
  };
})();