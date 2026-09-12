# TDG Route upgrade — 2026-09-12

Status: prepared upgrade branch; production deployment is blocked pending resolution of automatic approval review.

- Baseline GitHub commit: 79aa1fe7d05447a633dd8969070e584093557d2e, main, GitHub Pages.
- GitHub write access verified by creating upgrade/tdg-security-2026-09-12.
- Live read-only inventory: 1103 delivery records, 129 daily logs, one active admin. No business data changed.
- Existing database structure/policies/grants and four Edge Function sources saved in a separate private configuration snapshot, not this public repository. This is not a full data/Auth backup.
- Core (21), database (18), Edge mocks (6), browser (3 groups) passed in isolation. Browser's first launch had an environment extraction error; the retry passed.
- Live transactional schema preflight was rejected by automatic approval review, citing the original read-only authorization, despite the subsequent explicit production-upgrade authorization. No SQL from that request executed.
- Do not merge/publish the new frontend until SQL compatibility and six Edge Function deployments are verified. The new login requires tdg-login.
- No claim of successful production login or successful live database migration is made.

The optional private-read policy remains unselected. Existing sharing and owner/vehicle ledger behavior are preserved. Historical off-duty values cannot be reconstructed where no source exists.
