# R4C2c Supabase post-restore continuation remote evidence — 2026-08-02

Status: **remote post-restore standard-phase continuation verified in an isolated typed namespace**.

## Run identity

- workflow run: `30751813536`;
- main commit: `5346b831bfb5c7f205167d465c763d8a8d4489dc`;
- artifact: `8834687183`;
- artifact digest: `sha256:32e89f576426e5f78bd224766b9ce0dfe052a0cf6a04ddef6b617e815efbda2a`;
- verified at: `2026-08-02T14:19:33.101Z`.

The same run reverified the active seven-class executor and committed reader, durable historical witness, isolated standard multi-chunk work, and complete-state transfer before executing the continuation verifier.

## Isolated identities

- read-only durable source profile: `supabase-devnet`;
- restored source identity: `supabase-devnet-restore-continuation-source`;
- typed target: `xrpl_restore_continuation_v1`;
- target ID: `supabase-devnet-restore-continuation-v1`;
- fixture ID: `r4c2c-post-restore-continuation-v1`;
- restored source-state digest: `8e807adcd9a49ad47236d3dbaeb67cde74bc795ec2ea3019891090d4ec429991`.

The active profile was read only as the durable source of two exact consecutive committed works. No active profile row, message, successor, work, or watermark was mutated by the isolated continuation.

## Restored anchor

- anchor ledger: `4,132,573`;
- anchor hash: `8471870B8E722DC683EC69EC3CCD006E2CEC2669CE8AEF1ACC54A8ED1E35F241`;
- anchor payload chunks: `1`;
- anchor commit chunks: `1`;
- anchor committed reference rows: `1`;
- restored scheduler messages before continuation: one pending `scan`;
- restored scheduler successors before continuation: `0`.

The empty target canonical state matched the constructed source state before any continuation phase executed.

## Standard continuation

The restored scheduler executed this exact sequence, with every completed phase on attempt `1`:

1. `scan` — completed;
2. `commit:0` — completed;
3. `finalize` — completed;
4. next `scan` — pending, attempt `0`.

The restored watermark advanced exactly one ledger:

- previous ledger: `4,132,573`;
- committed continuation ledger: `4,132,574`;
- continuation hash: `7FF0E703A282BA7DFFC2AB2D20E56753C891CBE46FFF842F2BA8568AB27CCFD3`.

The continuation committed one real durable reference row. Its full-row digest was:

`7609d7198d2019c205433f5c45cc7fa44d83d5c394f955e554437a02f15ae5a1`.

The restored row count and full-row digest exactly matched the durable active source work after preserving the source `created_at` value.

## Final restored state

| Class | Rows |
| --- | ---: |
| streams | 1 |
| work | 2 |
| payload chunks | 2 |
| reference rows | 2 |
| commit chunks | 2 |
| watermarks | 1 |
| scheduler messages | 4 |
| scheduler successors | 3 |

- completed scheduler messages: `3`;
- pending scheduler messages: `1`;
- restored target state digest: `09ea04f458959c0203628d3c12891a7aebbf31cf553f45e805e782231007fb3e`.

## Duplicate and credential boundaries

After the initial continuation, the verifier replayed completion for each completed message:

- scan replay: duplicate convergence;
- commit replay: duplicate convergence;
- finalize replay: duplicate convergence.

Exact duplicate replay count: `3`.

The verifier also proved:

- missing verifier token rejected;
- wrong verifier purpose rejected;
- one pending successor scan remained after finalize;
- committed rows were not exposed before restored finalization.

## Active-profile isolation

The active `supabase-devnet` watermark was source-identical before and after the isolated continuation:

- ledger: `4,132,575`;
- hash: `5C64B9101D26ACBDD96069DBB605CADAAF6B3224DF6CA57D65D7FEC373FC7E17`;
- ledger advance during isolated verification: `0`;
- source identity preserved: `true`;
- non-regression: `true`.

## Corrected remote defect

The first continuation run, `30751593148`, completed the restored phase sequence but failed exact full-row digest parity because the isolated target replaced the durable source row's `created_at` with the qualification execution time.

PR #1133 added a forward-only correction that:

- repaired already committed isolated rows from the exact durable source timestamp;
- installed a fail-closed trigger preserving that timestamp for future target inserts;
- retained the full-row digest requirement without weakening it.

Run `30751813536` then passed the continuation verifier.

## Qualification effect

This evidence closes the post-restore continuation portion of G6 for the isolated Supabase qualification profile:

- empty-target restore parity;
- restored pending scan;
- standard scan/commit/finalize execution;
- exact one-ledger restored watermark advance;
- committed row count and digest parity;
- explicit source rebinding;
- next pending scan reservation;
- duplicate phase replay convergence;
- active-profile isolation.

Remote fault qualification remains unresolved for interruption rollback, retry/backoff, stale-lease reclaim, and terminal fail-closed halt. Throughput, Free-plan resource headroom, final profile selection, R5 recovery, public-reader cutover, Mainnet, stabilization, and soak are also not authorized by this evidence.

Machine-readable evidence is retained in [`r4c2c-supabase-restore-continuation-remote-evidence-2026-08-02.json`](r4c2c-supabase-restore-continuation-remote-evidence-2026-08-02.json).
