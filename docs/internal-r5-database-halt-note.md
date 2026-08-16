# R5 revision-4 database halt boundary

This note records the repository contract for the pending revision-4 database-size guard.

- Scope: `public.xrpl_claim_r5_revision4_recovery_batch(...)` only.
- Project database halt: `400000000` bytes.
- Claims are allowed only while `pg_database_size(current_database()) < 400000000`.
- At or above the halt, the recovery run is marked `halted` with `last_error = 'r5_recovery_database_halt'` before caught-up metadata changes, leased-batch reclaim, or new batch creation.
- The returned evidence includes current database bytes, halt bytes, and signed headroom.
- The change does not delete history, VACUUM tables, change the scheduler, deploy Edge functions, change the public reader, enable Mainnet, authorize stabilization, or authorize soak.
- Rearm is not authorized by this migration. Storage must first be brought below the fixed halt and a separately reviewed rearm path must revalidate production state.
