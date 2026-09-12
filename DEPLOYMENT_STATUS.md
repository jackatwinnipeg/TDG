# TDG Route deployment — 2026-09-12

## Completed backend deployment
- Database migration `tdg_route_security_and_auth_upgrade` successfully applied after local reconstruction and verification of the actual production schema. Actual executed SQL is in deployment/applied-security-and-auth.sql. Do not reapply it.
- Deployed Edge versions: tdg-login v1, tdg-change-password v1, admin-create-user v5, admin-update-user v10, admin-reset-password v4, admin-delete-user v6.
- Live anonymous/invalid-credential checks returned HTTP 401 on all six endpoints. This verifies runtime availability and rejection paths, not a successful real-user login.
- Record counts before/after: 1103 deliveries, 129 daily logs, one profile and one active admin. No existing business rows were intentionally changed.
- Verified profile UPDATE privilege revoked, eleven active-account policy gates and five protection triggers present; read-only SQL role simulation confirms current active admin can read/write through the policy gate.
- Original GitHub backup: backup/pre-upgrade-2026-09-12 at 79aa1fe7d05447a633dd8969070e584093557d2e. Database configuration and old Edge sources saved separately; this is not a full data/Auth backup.

## Frontend cutover
This PR publishes through the existing main-branch GitHub Pages deployment at https://jackatwinnipeg.github.io/TDG/. Local script URLs carry a release version to avoid mixing old and new scripts. Wait for the Pages deployment to succeed and verify login/print assets before applying deployment/retire-legacy-login.sql. That final step removes the obsolete login lookup and an unnecessary event-trigger RPC grant.

## Validation and remaining limits
Core/queue, isolated PostgreSQL, Edge mocks, browser printing and the reconstructed real-schema tests pass. No real user's password was requested or used. The owner should verify their first successful login and normal end-of-day workflow after release.

Keep existing sharing and owner/vehicle ledger rules; optional private-read policy is not applied. Do not manufacture missing historical off-duty times. Supabase leaked-password protection still requires an Auth configuration change; no supported configuration-writing capability is available in this connection. The signed-in is_admin and tdg_driver_directory RPCs intentionally remain executable and validate the caller.

The initial production rollback preflight was denied by automatic approval review. It was replaced with local real-schema verification; the subsequent formal production migration was approved and succeeded.
