# TDG Supabase Auth and protected-route fix

Project: `TDG_Log` (`mwuwsgxlcappifjwomkp`)

Date: 2026-08-08

## Frontend changes

### `js/auth_supabase.js`

- Replaced the synchronous custom-session gate with an asynchronous
  `requireAuthAsync()` gate that waits for Supabase session initialization.
- A protected page is accepted only after `supabase.auth.getUser()` validates
  the user with the Auth server and the matching `tdg_profiles` row is present
  and active.
- Removed the duplicate `tdg_supabase_session_v1` token store. Supabase JS now
  exclusively owns access-token and refresh-token persistence and refresh.
- Removed access and refresh tokens from the TDG business session stored in
  `sessionStorage`.
- Added an early `onAuthStateChange` listener. A `SIGNED_OUT` event clears TDG
  auth/profile state and moves protected pages to login.
- Added safe return-path preservation. External-origin, outside-directory, and
  login-loop return URLs are rejected.
- Logout uses `signOut({ scope: "local" })`, always clears TDG state, and uses
  a replace navigation to `login.html`.
- Disabled or missing profiles fail closed.

### `js/supabaseClient.js` and `js/supabaseConfig.js`

- Made browser Auth persistence, automatic refresh, and URL-session detection
  explicit in the client initialization.
- Removed configuration/key-prefix logging.
- Confirmed the configured key is the active modern publishable key for
  `TDG_Log`; it is not a secret or `service_role` key.

### Protected pages

The following pages now wait for the server-validated async Auth gate:

- `index.html` and `index-0806.html`
- `Current_Detail.html`, `Current_Detail-0806.html`,
  `Current_Detail_edited.html`, and `Old_Current_Detail.html`
- `History_Record.html` and `history_detail.html`
- `fill_log.html` and `batch_fill_log.html`
- `tdg_print.html`, `batch_tdg_print.html`, and
  `export_tdg_print_optimized.html`
- `admin.html` (also revalidates the admin profile from `tdg_profiles`)
- `Export/TDG.html`

`login.html` remains public and returns a successful normal login to the
validated original page. The explicit Admin Panel button still goes to the
admin page, where the admin role is checked again.

All Supabase browser script URLs were pinned from the floating `@2` tag to
`@supabase/supabase-js@2.111.0`.

### Logout and logging

- Removed the duplicate direct `signOut()` call in the Off Duty workflow.
- The existing record sync and final daily-log upload still complete before
  the single centralized logout call.
- Removed console logging of access-token prefixes and admin request payloads
  that can contain new-user passwords.
- Removed fallback use of generic `localStorage` keys named `token`,
  `access_token`, or `jwt` for backup requests.

## Database changes already applied

- Replaced the unsafe `tdg_user_profiles` admin policy based on editable
  `user_metadata.role` with `public.is_admin(auth.uid())`.
- Limited `tdg_user_profiles` policies to `authenticated`.
- Hardened `public.is_admin(uuid)`:
  - fixed `search_path` to `pg_catalog, public`;
  - revoked execution from `PUBLIC` and `anon`;
  - retained `authenticated` execution because existing RLS policies call it;
  - rejects UUIDs other than the authenticated caller;
  - retains `SECURITY DEFINER` to avoid recursive `tdg_profiles` RLS.

The reproducible SQL is in
`supabase/migrations/20260808_harden_tdg_auth.sql`.

## Verification performed

- JavaScript syntax checks passed for all active modified scripts.
- Inline JavaScript parsing passed across all HTML pages.
- Auth unit tests passed for:
  - valid session restoration;
  - rejection of a stale forged TDG session;
  - removal of duplicate stored refresh tokens;
  - same-app return URL acceptance;
  - malicious external return URL rejection;
  - local-scope logout and cache clearing.
- Local browser tests confirmed unauthenticated redirects (with preserved
  return paths) for the main, detail, history, Fill Log, batch print, TDG
  print, export, standalone Export, and admin pages.
- Browser console checks showed no warnings or errors in those guard tests.
- Secret scan found no `service_role`, `sb_secret_`, secret-key variable, or
  three-part JWT embedded in the project.
- Live database tests confirmed `anon` cannot execute `is_admin(uuid)`, a real
  admin can validate their own UID, and a spoofed UID returns false.
- Supabase security advisors were run after the database migration and again
  after packaging.

No production data was inserted, updated, or deleted during frontend tests.
Because no user password was supplied, the package was not tested by signing
in as a real driver/admin; signed-in behavior was covered with isolated Auth
mocks and all existing data workflows retained their original code.

## Existing advisor findings outside this fix

The advisor still reports unrelated pre-existing items, including:

- mutable search paths on several other functions;
- anonymously executable `SECURITY DEFINER` functions such as
  `lookup_login_profile` (currently required by Driver Number login),
  `is_admin_user`, and `rls_auto_enable`;
- leaked-password protection disabled;
- RLS-enabled staging/legacy tables with no policies.

These were not changed because their intended callers and operational impact
need a separate review. See the Supabase database-linter remediation guidance:
https://supabase.com/docs/guides/database/database-linter

## Business-flow preservation

No volume calculation, record mapping, batch rendering, Fill Log field/data
logic, shift-session check-in/check-out code, or Supabase table payload schema
was changed. In `app_supabase.js`, edits are limited to the initial Auth gate,
centralized logout, and removal of ambiguous fallback token keys.
