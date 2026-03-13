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
  const LS_SUPABASE_SESSION = "tdg_supabase_session_v1";
  const LS_TDG_PROFILE = "tdg_auth_profile_v1";

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

  function saveSupabaseSession(session) {
    try {
      if (!session) {
        localStorage.removeItem(LS_SUPABASE_SESSION);
        return;
      }

      localStorage.setItem(
        LS_SUPABASE_SESSION,
        JSON.stringify({
          access_token: session.access_token || "",
          refresh_token: session.refresh_token || "",
          expires_at: session.expires_at || null,
          expires_in: session.expires_in || null,
          token_type: session.token_type || "bearer",
          user: session.user || null,
        }),
      );
    } catch (e) {
      console.warn("saveSupabaseSession failed:", e);
    }
  }

  function loadSavedSupabaseSession() {
    try {
      return JSON.parse(localStorage.getItem(LS_SUPABASE_SESSION) || "null");
    } catch {
      return null;
    }
  }

  function clearSavedSupabaseSession() {
    try {
      localStorage.removeItem(LS_SUPABASE_SESSION);
    } catch {}
  }

  function saveTDGProfile(profile) {
    try {
      if (!profile) {
        localStorage.removeItem(LS_TDG_PROFILE);
        return;
      }
      localStorage.setItem(LS_TDG_PROFILE, JSON.stringify(profile));
    } catch (e) {
      console.warn("saveTDGProfile failed:", e);
    }
  }

  function loadTDGProfile() {
    try {
      return JSON.parse(localStorage.getItem(LS_TDG_PROFILE) || "null");
    } catch {
      return null;
    }
  }

  function clearTDGProfile() {
    try {
      localStorage.removeItem(LS_TDG_PROFILE);
    } catch {}
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

  function buildTDGSession({ profile, user, session }) {
    const loginName =
      safe(profile?.driver_number) ||
      safe(profile?.username) ||
      safe(user?.email).split("@")[0];

    return {
      userId: user?.id || profile?.id || "",
      username: loginName,
      displayName: profile?.display_name || loginName,
      role: profile?.role || "driver",
      driverNumber: loginName,
      vehicleNo: profile?.vehicle_no || "",
      loginAt: nowIso(),

      // 关键：把 token 保存进业务 session，供 app_supabase.js 恢复
      access_token: session?.access_token || "",
      refresh_token: session?.refresh_token || "",
    };
  }

  async function restoreSupabaseSessionIfNeeded() {
    const sb = getSupabaseClient();
    if (!sb?.auth?.getSession || !sb?.auth?.setSession) return false;

    try {
      const current = await sb.auth.getSession();
      if (current?.data?.session?.access_token) {
        return true;
      }

      const saved = loadSavedSupabaseSession();
      if (!saved?.access_token || !saved?.refresh_token) {
        return false;
      }

      const { data, error } = await sb.auth.setSession({
        access_token: saved.access_token,
        refresh_token: saved.refresh_token,
      });

      if (error) {
        console.warn("restoreSupabaseSessionIfNeeded:setSession failed:", error);
        return false;
      }

      if (data?.session) {
        saveSupabaseSession(data.session);
        return true;
      }

      return false;
    } catch (e) {
      console.warn("restoreSupabaseSessionIfNeeded exception:", e);
      return false;
    }
  }

  async function refreshSessionFromSupabase() {
    const sb = getSupabaseClient();
    if (!sb?.auth) return null;

    const { data, error } = await sb.auth.getSession();
    if (error) return null;

    const session = data?.session;
    const user = session?.user;
    if (!user) return null;

    try {
      const profile = await fetchProfileByUserId(user.id);

      if (profile && profile.is_active === false) {
        await sb.auth.signOut();
        clearSession();
        clearSavedSupabaseSession();
        clearTDGProfile();
        return null;
      }

      saveSupabaseSession(session);
      saveTDGProfile(profile);

      const sess = buildTDGSession({
        profile,
        user,
        session,
      });

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
        clearSavedSupabaseSession();
        clearTDGProfile();
        return { ok: false, msg: error.message };
      }

      const user = data?.user || data?.session?.user;
      const session = data?.session || null;
      const userId = user?.id;

      if (!userId || !session) {
        clearSession();
        clearSavedSupabaseSession();
        clearTDGProfile();
        return { ok: false, msg: "Login failed (missing session)" };
      }

      const profile = await fetchProfileByUserId(userId);

      if (profile && profile.is_active === false) {
        await sb.auth.signOut();
        clearSession();
        clearSavedSupabaseSession();
        clearTDGProfile();
        return { ok: false, msg: "用户已停用" };
      }

      saveSupabaseSession(session);
      saveTDGProfile(profile);

      const sess = buildTDGSession({
        profile,
        user,
        session,
      });

      setSession(sess);
      syncProfileToLegacyLS();

      try {
        await window.TDG_CUSTOMERS?.syncFromServer?.({ silent: true });
      } catch (e) {
        console.warn("Customer sync after login failed:", e);
      }

      return { ok: true, user: profile || { id: userId, username: sess.username } };
    } catch (e) {
      clearSession();
      clearSavedSupabaseSession();
      clearTDGProfile();
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
    clearSavedSupabaseSession();
    clearTDGProfile();
    window.location.href = "./login.html";
  }

  // ===== compatibility only =====
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
      JSON.stringify(Array.isArray(users) ? users : []),
    );
  }

  async function ensureSeedAdmin() {
    return;
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(String(text ?? "")),
    );
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function initAuth() {
    try {
      await restoreSupabaseSessionIfNeeded();

      const restored = await refreshSessionFromSupabase();
      if (restored) {
        console.log("Session restored from Supabase");

        try {
          await window.TDG_CUSTOMERS?.syncFromServer?.({ silent: true });
        } catch (e) {
          console.warn("Customer sync after session restore failed:", e);
        }
      }
    } catch (e) {
      console.warn("Initial session restore failed:", e);
    }
  }

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

  initAuth();
})();
