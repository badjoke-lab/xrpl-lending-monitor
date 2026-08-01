# Implementation status

Last updated: `2026-08-01`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired fixed-32-ledger production recovery remains halted after a content-dependent Worker subrequest failure. The successor chain is absent, the recorded terminal lag was `56,740`, Worker Cron is empty, and no stabilization qualification or 24-hour soak is active.

The public read surface remains legacy-authoritative. Mainnet remains disabled. The portable runtime has not been connected to a hosted deployment or public route.

## Controlling documents

- Recovery design and schedule: [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md)
- R3 contract and exit plan: [`ops/r3-adapter-reader-integration-plan-2026-08-01.md`](ops/r3-adapter-reader-integration-plan-2026-08-01.md)
- R3A evidence: [`ops/r3a-adapter-conformance-evidence-2026-08-01.md`](ops/r3a-adapter-conformance-evidence-2026-08-01.md)
- R3B evidence: [`ops/r3b-committed-reader-evidence-2026-08-01.md`](ops/r3b-committed-reader-evidence-2026-08-01.md)
- R3C evidence: [`ops/r3c-product-mapper-shadow-evidence-2026-08-01.md`](ops/r3c-product-mapper-shadow-evidence-2026-08-01.md)
- R3D evidence: [`ops/r3d-publication-maintenance-evidence-2026-08-01.md`](ops/r3d-publication-maintenance-evidence-2026-08-01.md)
- R3E evidence: [`ops/r3e-complete-state-transfer-evidence-2026-08-01.md`](ops/r3e-complete-state-transfer-evidence-2026-08-01.md)
- Runtime invariants: [`history-runtime-contract.md`](history-runtime-contract.md)
- Resource gates: [`resource-envelope.md`](resource-envelope.md)

## Production checkpoint

Controlling checkpoint: Issue #1079.

- network: `devnet`
- Mainnet enabled: `false`
- Worker Cron: empty
- last completed slot: `2026-08-01T03:52:00Z`
- failed slot: `2026-08-01T03:53:00Z`
- failure: `Too many subrequests by single Worker invocation`
- last processed ledger: `4,051,454`
- latest observed ledger: `4,108,194`
- terminal lag: `56,740`
- successor chain: halted
- 24-hour soak: not started

The halted remote deployment is evidence and rollback context only. It is not an operating collector.

## Completed reconstruction milestones

- R0 contract and portability reset: PR #1081, merge `c077e7b16b8b08213bbadcc5e927bba0f9472f6c`.
- R1 reference schema and deterministic planner: PR #1082, merge `85f42e665a5e6f2f519cd372718b9c41c16b3f68`.
- R2 portable typed runtime and parent exit: PRs #1084–#1095, final merge `fb90cbbd3a44337dc0891552f3618581cfc31e1c`.
- R3 contract: PR #1096, merge `d38615dc283462dee50605adb535caefb1975f0f`.
- R3A adapter interfaces and SQLite conformance: PR #1097, merge `741f4ac24396dd21ae100b963ea439782b1696be`.
- R3B committed generic reader: PR #1098, merge `fa04ea280525e7c93bf13dd1b8debbfcf78193af`.
- R3C product mappers and shadow compatibility: PR #1099, merge `e7bcedcf3f597e765da42098a89683e1ba62cd68`.
- R3D verified publication and bounded maintenance: PR #1100, merge `25d35741a1e0b60d01ba422e5ab8fba3edf15a3e`.

## R3E and parent R3 exit

Status: **implementation and validation passed in PR #1101; merge pending**.

Delivered on the branch:

- provider-neutral complete-state transfer interface;
- outer complete-state schema version 1 preserving inner runtime schema version 3;
- canonical export of collection, scheduler, publication, and maintenance state;
- one-transaction restore into a fully empty target;
- exact canonical export parity before restore commit;
- publication candidate parent-chain restoration and cycle/missing-parent rejection;
- staged, committing, committed, published, and maintained state transfer;
- committed-reader fence parity after restore;
- same-source cursor continuation and cross-source cursor rejection;
- completed scheduler message, dispatched outbox, and pending successor parity;
- verified publication watermark and applied maintenance-plan parity;
- publication continuation after restore;
- non-empty target rejection and failed-restore rollback to empty.

Latest implementation head `0fbe87426d6f6e22d8cc1404abd5ed8653639967` passed CI run `30702565940`:

- workflow-surface guard;
- lint;
- shell syntax and canonical-base checks;
- TypeScript type-check;
- production runner bundle and configuration validation;
- complete unit-test suite;
- clean migration sequence through migration `10007`;
- application build;
- browser smoke.

The final documentation head must pass the same ordinary CI before merge. R3 is complete only after PR #1101 merges to `main`.

## Next phase

### R4 — Deployment-profile qualification

Status: **next after PR #1101 merges**.

R4 is local and read-only until a candidate passes every gate. It must:

- enumerate candidate storage, scheduler, execution, and publication profiles without selecting one prematurely;
- reject mandatory paid runtime dependencies and automatic paid overage;
- prove transaction and committed-read semantics;
- prove scheduler lease, retry, duplicate, and successor behavior;
- prove exact export and restore into the reference format;
- measure request, operation, byte, row, CPU, memory, and elapsed envelopes;
- demonstrate steady throughput above 21 ledgers/minute and catch-up throughput above 30 ledgers/minute under retained fixtures or shadow evidence;
- prove fail-closed behavior before any provider ceiling;
- prove deploy, rollback, checkpoint, and evidence paths without routine interactive dashboard operation;
- perform no production mutation until a later explicit R5 approval.

### R5 — Controlled recovery

Deploy only a qualified profile, then prove one staged work item, rollback, restore, and a fixed two-hour catch-up qualification.

### R6 — Lag-zero and steady qualification

Reach lag zero, pass twelve consecutive five-minute freshness checkpoints, and remain inside the measured no-cost envelope.

### R7 — Formal operation evidence

Pass fixed 24-hour and seven-day evidence windows before reopening formal Devnet release qualification.

## Operating restrictions

- Do not describe the collector as operating while its successor or lease chain is absent.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select or deploy a hosted provider before R4 qualification.
- Do not use GitHub Actions as the normal collection clock.
- Do not start stabilization or soak before R6.
- Do not enable Mainnet.
- Do not skip a failed ledger or advance a cursor after partial persistence.
- Do not mix portable and legacy reader sources inside one response.
- Do not silently fall back after integrity or identity failure.
- Do not expose the portable reader publicly before a later explicit cutover gate.
- Do not make a provider dashboard, local terminal, or paid runtime dependency part of routine recovery.
- Do not call a theoretical no-cost projection an operating result.
