# R4C2c Supabase complete-state transfer plan — 2026-08-02

Status: implementation unit for exact isolated remote export and empty-target typed restore of collection, scheduler, publication, and maintenance state.

## Purpose

R3 proved the provider-neutral complete-state contract locally. R4C2c still requires the selected remote profile to prove an equivalent exact export and restore boundary.

This unit uses the already committed isolated multi-chunk profile as the source. It does not export or mutate the active `supabase-devnet` profile.

## Source identity

- source profile: `supabase-devnet-multichunk-witness`;
- network: `devnet`;
- epoch: `supabase-r4c2c-v1`;
- base identity: `multichunk-witness-2776760`;
- committed ledger: `2,776,760`;
- committed work rows: `116`;
- payload chunks: `3`;
- commit chunks: `3`;
- scheduler messages: `6`;
- successor links: `5`.

The source must retain one committed three-chunk work and one pending successor scan.

## State sections

The exported schema-v1 state contains:

### Collection

- phase stream;
- committed work;
- payload chunks;
- committed reference rows;
- commit chunks;
- phase watermark.

### Scheduler

- completed and pending phase messages;
- exact current-to-successor links.

### Publication

The isolated transfer fixture derives one verified publication candidate, one publication-work row, and one publication watermark from the committed source work. Their canonical JSON bodies and digests are retained.

### Maintenance

The fixture derives one applied maintenance plan with two applied retention mutations bound to the verified publication and committed work.

These publication and maintenance rows are qualification state only. They do not switch the public reader or claim normal publication ownership.

## Typed empty-target restore

The restore target is the dedicated `xrpl_restore_v1` schema. Its tables are typed copies of the source phase, publication, and maintenance tables, so source primary keys can be restored without colliding with the live qualification namespace.

Target ID: `supabase-devnet-transfer-restore-v1`.

The restore function must:

1. validate the exact source identity and schema version;
2. recompute the canonical JSONB SHA-256 digest;
3. validate exact row counts for all state sections;
4. reject a non-empty target without valid matching metadata;
5. insert all typed rows in one PostgreSQL transaction;
6. rebuild the complete state from the restored tables;
7. compare the rebuilt JSONB value and SHA-256 digest with the source;
8. commit restore metadata only inside the same transaction;
9. roll back every inserted row when parity fails;
10. converge an exact repeated restore with `duplicate: true`;
11. reject a digest-tampered restore.

## Expected row counts

| Section | Table | Rows |
| --- | --- | ---: |
| collection | streams | 1 |
| collection | work | 1 |
| collection | payload chunks | 3 |
| collection | reference rows | 116 |
| collection | commit chunks | 3 |
| collection | watermarks | 1 |
| scheduler | messages | 6 |
| scheduler | successors | 5 |
| publication | candidates | 1 |
| publication | work | 1 |
| publication | watermarks | 1 |
| maintenance | plans | 1 |
| maintenance | mutations | 2 |

Scheduler status counts must be exactly five completed messages and one pending message.

## Independent Edge verification

The token-gated Edge function must independently:

- SHA-256 hash the SQL-exported canonical text;
- verify the source state shape and fixed row counts;
- invoke the typed restore;
- read and rebuild the target state;
- compare source and target canonical text byte-for-byte;
- hash the restored canonical text independently;
- verify exact duplicate convergence;
- verify digest tamper rejection;
- prove the active `supabase-devnet` watermark is non-regressing and source-identical before and after.

The GitHub verifier additionally checks missing-token and wrong-purpose rejection and retains only a sanitized summary, not the full state payload or verifier token.

## Deployment boundary

The existing single guarded Supabase workflow:

1. bundles the exact seventh Edge entry;
2. rotates the same one-run masked verifier token once;
3. applies the migration;
4. deploys the transfer function;
5. reruns all active, historical, and multi-chunk regression verifiers;
6. runs the transfer verifier;
7. uploads one sanitized artifact;
8. publishes one Issue #1109 locator.

No workflow or schedule is added.

## What this unit does not prove

This unit does not prove post-restore collection continuation. The restored namespace is typed and parity-verified, but the standard phase executor remains bound to the source `public` schema.

A later R4C2c unit must prove controlled continuation from the restored pending message without mutating the source or active profile.

The unit also does not prove interruption rollback, retry/backoff, stale-lease reclaim, duplicate phase replay, terminal injection, throughput, Free-plan resource headroom, profile selection, public-reader cutover, R5 recovery, Mainnet, stabilization, or soak.
