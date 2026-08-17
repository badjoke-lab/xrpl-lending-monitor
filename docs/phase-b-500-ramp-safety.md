# R5 terminal archive Phase B 500-row ramp

This is a one-step graduation proof from the production-proven 250-row Phase B tranche.

- The existing 250-row workflow and manager remain unchanged.
- The ramp wrapper pins the exact proven manager SHA-256 and changes only `TRANCHE_LIMIT` from 250 to 500 in a temporary runtime copy.
- The existing 2,000,000 logical-byte cap remains unchanged.
- Exact candidate, structural-state, cutoff, project, source, plan, expiry, nonce, advisory-lock, checkpoint fail-close, and post-apply identity checks remain inherited from the pinned manager.
- The database statement timeout remains 180 seconds. A timeout/failure must rollback the transaction.
- The 250-row and 500-row workflows share the same GitHub Actions concurrency group.
- Physical compaction, VACUUM, REINDEX, table rewrite, scheduler/deployment/public-reader/Mainnet mutation, stabilization, soak, and R5 rearm remain outside this authorization.

A successful 500-row proof does not authorize a further scale increase. Each later change requires its own review and bounded authorization.
