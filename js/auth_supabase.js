/* /js/auth_supabase.js
 * Supabase Auth and protected-page helpers.
 *
 * Driver Number is resolved to the user's configured email by the existing
 * lookup_login_profile RPC. Supabase remains the sole owner of access and
 * refresh token persistence; the TDG session contains display/profile data
 * only and is never accepted until the Supabase user has been validated.
 */
(() => {
  "use strict";

  const SS_SESSION = "tdg_session_v1";
  const LS_USERS = "tdg_users_compat_v1";
  const LS_LEGACY_SUPABASE_SESSION = "tdg_supabase_session_v1";
  const LS_TDG_PROFILE = "tdg_auth_profile_v1";

  const nowIso = () => new Date().toISOString();
  const safe = (value) => String(value ?? "").trim();
  let authInitializationComplete = false;
  let redirecting = false;

  function getSupabaseClient() {
    if (window.supabaseClient?.auth && window.supabaseClient?.from) {
      return window.supabaseClient;
    }

    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY;
    if (window.supabase?.createClient && url && key) {
      window.supabaseClient = window.supabase.createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
      return window.supabaseClient;
    }

    return null;
  }

  function getSession() {
    try {
      return JSON.parse(sessionStorage.getItem(SS_SESSION) || "null");
    } catch {
      return null;
    }
  }

  function setSession(session) {
    if (!session) {
      sessionStorage.removeItem(SS_SESSION);
      return;
    }
    sessionStorage.setItem(SS_SESSION, JSON.stringify(session));
  }

  function clearAuthCache() {
    try {
      sessionStorage.removeItem(SS_SESSION);
      localStorage.removeItem(LS_LEGACY_SUPABASE_SESSION);
      localStorage.removeItem(LS_TDG_PROFILE);
    } catch {}
  }

  function isLoginPage() {
    return String(window.location.pathname || "")
      .toLowerCase()
      .endsWith("/login.html");
  }

  function appRelative(path) {
    const configuredBase = safe(window.TDG_AUTH_BASE_PATH || "./");
    const base = configuredBase.endsWith("/")
      ? configuredBase
      : `${configuredBase}/`;
    return `${base}${String(path || "").replace(/^\.\//, "")}`;
  }

  function currentPageReturnTo() {
    return window.location.href;
  }

  function loginUrl() {
    const returnTo = currentPageReturnTo();
    return `${appRelative("login.html")}?returnTo=${encodeURIComponent(returnTo)}`;
  }

  function redirectToLogin() {
    if (redirecting || isLoginPage()) return;
    redirecting = true;
    window.location.replace(loginUrl());
  }

  function getPostLoginRedirect(fallback = "./index.html") {
    const requested = new URLSearchParams(window.location.search).get("returnTo");
    if (!requested) return fallback;

    try {
      const appBase = new URL("./", window.location.href);
      const target = new URL(requested, appBase);
      const sameOrigin = target.origin === appBase.origin;
      const insideApp = target.pathname.startsWith(appBase.pathname);
      const isLoginTarget = target.pathname.toLowerCase().endsWith("/login.html");

      if (sameOrigin && insideApp && !isLoginTarget) {
        return target.href;
      }
    } catch {}

    return fallback;
  }

  function syncProfileToLegacyLS() {
    const session = getSession();
    if (!session) return;

    try {
      localStorage.setItem(
        "tdg_user_profile_v2",
        JSON.stringify({
          driverNumber: session.driverNumber || "",
          driverName: session.displayName || session.username || "",
          vehicleNo: session.vehicleNo || "",
        }),
      );
    } catch {}
  }

  async function fetchProfileByUserId(userId) {
    const sb = getSupabaseClient();
    if (!sb) throw new Error("Supabase client not initialized");

    const { data, error } = await sb
      .from("tdg_profiles")
      .select(
        "id, username, driver_number, display_name, role, vehicle_no, email, is_active",
      )
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  function buildTDGSession({ profile, user }) {
    const loginName =
      safe(profile?.driver_number) ||
      safe(profile?.username) ||
      safe(user?.email).split("@")[0];
    const previous = getSession();

    return {
      userId: user?.id || profile?.id || "",
      username: loginName,
      displayName: profile?.display_name || loginName,
      role: profile?.role || "driver",
      driverNumber: loginName,
      vehicleNo: profile?.vehicle_no || "",
      loginAt:
        previous?.userId === (user?.id || profile?.id)
          ? previous.loginAt || nowIso()
          : nowIso(),
    };
  }

  async function clearInvalidSupabaseSession() {
    clearAuthCache();
    try {
      await getSupabaseClient()?.auth?.signOut?.({ scope: "local" });
    } catch {}
  }

  async function refreshSessionFromSupabase() {
    const sb = getSupabaseClient();
    if (!sb?.auth) {
      clearAuthCache();
      return null;
    }

    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    if (sessionError || !sessionData?.session) {
      clearAuthCache();
      return null;
    }

    // getUser verifies the access token with the Auth server. A custom
    // sessionStorage record alone is never sufficient for route access.
    const { data: userData, error: userError } = await sb.auth.getUser();
    const user = userData?.user;
    if (userError || !user) {
      await clearInvalidSupabaseSession();
      return null;
    }

    try {
      const profile = await fetchProfileByUserId(user.id);
      if (!profile || profile.is_active === false) {
        await clearInvalidSupabaseSession();
        return null;
      }

      const session = buildTDGSession({ profile, user });
      setSession(session);
      localStorage.setItem(LS_TDG_PROFILE, JSON.stringify(profile));
      syncProfileToLegacyLS();
      return session;
    } catch (error) {
      console.warn("Unable to validate the TDG profile:", error?.message || error);
      clearAuthCache();
      return null;
    }
  }

  async function authenticate(username, password) {
    const loginInput = safe(username).toLowerCase();
    const suppliedPassword = safe(password);
    const sb = getSupabaseClient();

    if (!sb?.auth) {
      return { ok: false, msg: "Supabase client not initialized" };
    }
    if (!loginInput || !suppliedPassword) {
      return { ok: false, msg: "请输入 Driver Number 和密码" };
    }

    clearAuthCache();

    try {
      const { data: rows, error: lookupError } = await sb.rpc(
        "lookup_login_profile",
        { login_input: loginInput },
      );
      const lookupProfile = Array.isArray(rows) ? rows[0] : rows;

      if (lookupError) {
        return { ok: false, msg: `登录前查询用户失败: ${lookupError.message}` };
      }
      if (!lookupProfile?.email || lookupProfile.is_active === false) {
        return { ok: false, msg: "用户名、密码错误或用户已停用" };
      }

      const { data, error } = await sb.auth.signInWithPassword({
        email: safe(lookupProfile.email).toLowerCase(),
        password: suppliedPassword,
      });

      if (error || !data?.user) {
        clearAuthCache();
        return { ok: false, msg: error?.message || "登录失败" };
      }

      const profile = await fetchProfileByUserId(data.user.id);
      if (!profile || profile.is_active === false) {
        await clearInvalidSupabaseSession();
        return { ok: false, msg: "用户资料不存在或用户已停用" };
      }

      const session = buildTDGSession({ profile, user: data.user });
      setSession(session);
      localStorage.setItem(LS_TDG_PROFILE, JSON.stringify(profile));
      syncProfileToLegacyLS();

      try {
        await window.TDG_CUSTOMERS?.syncFromServer?.({ silent: true });
      } catch (error) {
        console.warn("Customer sync after login failed:", error);
      }

      return { ok: true, user: profile };
    } catch (error) {
      clearAuthCache();
      return { ok: false, msg: `登录失败: ${error?.message || error}` };
    }
  }

  async function requireAuthAsync({ roles } = {}) {
    await authReady;
    const session = getSession();

    if (!session?.userId) {
      redirectToLogin();
      return null;
    }

    if (Array.isArray(roles) && roles.length && !roles.includes(session.role)) {
      alert("权限不足（Access Denied）");
      window.location.replace(appRelative("index.html"));
      return null;
    }

    return session;
  }

  // Compatibility for older code. Protected page initialization must use
  // requireAuthAsync() so it waits for server-validated session restoration.
  function requireAuth({ roles } = {}) {
    if (!authInitializationComplete) return null;
    const session = getSession();
    if (!session?.userId) {
      redirectToLogin();
      return null;
    }
    if (Array.isArray(roles) && roles.length && !roles.includes(session.role)) {
      return null;
    }
    return session;
  }

  async function logout() {
    redirecting = true;
    try {
      await getSupabaseClient()?.auth?.signOut?.({ scope: "local" });
    } catch (error) {
      console.warn("Supabase sign-out failed; local session was still cleared:", error);
    } finally {
      clearAuthCache();
      window.location.replace(appRelative("login.html"));
    }
  }

  function getUsers() {
    try {
      return JSON.parse(localStorage.getItem(LS_USERS) || "[]");
    } catch {
      return [];
    }
  }

  function setUsers(users) {
    localStorage.setItem(LS_USERS, JSON.stringify(Array.isArray(users) ? users : []));
  }

  async function ensureSeedAdmin() {}

  async function sha256(text) {
    const buffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(String(text ?? "")),
    );
    return Array.from(new Uint8Array(buffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function initAuth() {
    // Remove the old duplicate refresh-token store. Supabase JS owns its own
    // namespaced session storage and refresh lifecycle.
    try {
      localStorage.removeItem(LS_LEGACY_SUPABASE_SESSION);
    } catch {}

    const sb = getSupabaseClient();
    if (!sb?.auth) {
      clearAuthCache();
      authInitializationComplete = true;
      return null;
    }

    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearAuthCache();
        if (authInitializationComplete && !isLoginPage()) redirectToLogin();
      }

      if (
        authInitializationComplete &&
        (event === "TOKEN_REFRESHED" || event === "USER_UPDATED")
      ) {
        setTimeout(() => refreshSessionFromSupabase(), 0);
      }
    });

    try {
      return await refreshSessionFromSupabase();
    } finally {
      authInitializationComplete = true;
    }
  }

  const authReady = initAuth();

  window.TDG_AUTH = {
    authenticate,
    getSession,
    requireAuth,
    requireAuthAsync,
    logout,
    ready: authReady,
    getPostLoginRedirect,
    syncProfileToLegacyLS,
    refreshSessionFromSupabase,
    getUsers,
    setUsers,
    ensureSeedAdmin,
    sha256,
  };
})();
