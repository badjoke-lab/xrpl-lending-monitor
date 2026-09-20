# Implementation status

Last updated: 2026-09-20

## Current decision

XRPL Lending Monitor is pivoting to a DB-less static-artifact runtime.

The prior Cloudflare D1 / Queue / Worker-scheduled collector and Supabase recovery architecture is retired as a future direction. It must not be restarted merely to continue the old recovery chain.

The repository still contains substantial legacy runtime code. Therefore the architecture decision is **adopted**, but the DB-less production implementation is **not yet complete**.

## Canonical main at decision time

`fc6e9f2b8d967b6923c5d8529378c21cb172a08e`

Commit title:

`Remove retired Current control-plane workflows (#1660)`

At this commit, `wrangler.jsonc` still declares a D1 database, minute Cron, and legacy Worker runtime. Those bindings describe legacy code that D6 will remove; they do not override the new source-of-truth documents.

## Proven reusable evidence

### Fresh complete Current build

A 2026-09-11 GitHub Actions run successfully built a complete type-filtered binary Current snapshot.

Evidence:

- Actions run: `34563293802`;
- validated ledger: `5,218,039`;
- ledger hash: `5701853F89034B14F4E9698AD31E04535636CF4DD9CD986136ABDA7F290011A6`;
- Vaults: `1,234,169`;
- LoanBrokers: `776,954`;
- Loans: `339,744`;
- total relevant objects: `2,350,867`;
- read-model page size: `50`;
- read-model lookup prefix length: `2`.

This proves complete DB-independent source acquisition and static read-model generation are feasible. It does not prove the new live runtime.

### Existing historical archive

The retained `history-data` publication proves:

- epoch: `devnet-3371675`;
- start ledger: `3,371,676`;
- end ledger: `3,932,301`;
- ledgers: `560,626`;
- segments: `1,136`;
- exact index records: `33,811,930`.

The archive is retained as historical evidence.

No continuity is claimed from `3,932,302` to the future DB-less live-history start until backfill is independently verified.

## Reusable code

High-value reuse candidates already exist for:

- validated ledger parsing;
- WebSocket ledger reading;
- Lending transaction filtering;
- AffectedNodes normalization;
- Current overlay mutation derivation;
- Loan lifecycle derivation;
- deleted-object archive derivation;
- cover/debt/loss history derivation;
- history segment record building;
- Vault/LoanBroker/Loan normalization;
- existing React presentation routes/components.

## Retired problem area

Do not spend new implementation time repairing:

- D1 capacity behavior;
- Queue delivery/cadence;
- fast-lane D1 persistence;
- Supabase R4/R5 recovery;
- Worker Cron cutover/reseed;
- D1 overlay fold/cutover.

These are historical implementation paths.

## Active roadmap unit

**D0 — Source-of-truth reset: complete**

Merged through PR #1661 as `f764967947f0be10f08013ac8a655cef3bc816f6`.

**D1 — Persistence decoupling: complete**

Merged through PR #1663 as `09b9fae2eeeec54f3dbc82101e16704b41fe0b80`.

Validation run `35457202156` passed typecheck, focused lint, and the DB-less fixture suite. The merged contracts now provide deterministic seven-class Current+History live artifacts, immutable artifact publication interfaces, channel integrity/coverage rules, and collector-layer overlay typing without a Worker repository dependency.

**D2 — Current base generation: active**

The canonical type-filtered binary traversal, Release-compatible base read model, independent verifier, and candidate publication workflow are implemented on main.

Candidate run `35458490439` failed closed at the former 4,000-page Vault safety limit. PR #1678 raised the cap to 8,000 while retaining fixed-ledger, repeated-marker, and marker-exhaustion checks.

The next fresh candidate, run `35481411720`, proved that 8,000 was still an artificial blocker: the traversal remained valid through all 8,000 Vault pages and again stopped only because of the configured page ceiling. No Release was created.

The type-filtered traversal is streaming and separately protected by fixed-ledger identity verification, repeated-marker rejection, the workflow timeout, downstream independent verification, and the Release asset ceiling. D2 therefore raises the per-type page ceiling to 50,000 so it serves as an abnormal-run safety stop rather than an estimate of expected Devnet object count.

D2 remains active until a fresh candidate reaches marker exhaustion for all three types, passes the independent manifest/relationship verifier, and is uploaded and read back successfully as a prerelease Release generation.

## Release status

Not formally released.

The next release requires completion of D1-D8 in `development-roadmap.md`, with evidence recorded as each unit exits.