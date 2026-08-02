# Implementation status

Last updated: `2026-08-02`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired Cloudflare fixed-32-ledger recovery remains halted after a content-dependent Worker subrequest failure. Worker Cron remains empty, Mainnet remains disabled, the public read surface remains legacy-authoritative, and no stabilization qualification or soak is active.

The separate Supabase Free Devnet profile now has a deployed seven-class executor and a remotely verified schema-3 `scan -> commit -> finalize -> next scan` phase chain. The retained remote work had one `validated-ledger` row and zero rows in the other six semantic classes, so non-empty six-class evidence, reader/transfer parity, and remote fault qualification remain incomplete. PR #1116 adds the qualification-only committed-reader implementation, but it remains unverified until the exact main-branch bundle passes the remote reader verifier and retained evidence is merged. The profile remains an R4 conditional candidate and is not a public-reader or production cutover.

## Controlling documents

- Recovery design and schedule: [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md)
- R4 qualification contract and schedule: [`ops/r4-deployment-profile-qualification-plan-2026-08-01.md`](ops/r4-deployment-profile-qualification-plan-2026-08-01.md)
- R4 initial matrix: [`ops/r4-initial-profile-matrix-2026-08-01.json`](ops/r4-initial-profile-matrix-2026-08-01.json)
- R4B evaluator evidence: [`ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md`](ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md)
- R4C1 local SQLite evidence: [`ops/r4c1-local-sqlite-service-evidence-2026-08-01.md`](ops/r4c1-local-sqlite-service-evidence-2026-08-01.md)
- R4C2a Supabase probe evidence: [`ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md`](ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md)
- R4C2b remote phase evidence: [`ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md`](ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md)
- R4C2b machine-readable evidence: [`ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.json`](ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.json)
- R4C2c remote deployment evidence: [`ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md)
- R4C2c machine-readable evidence: [`ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.json`](ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.json)
- R4C2c committed-reader implementation unit: [`ops/r4c2c-supabase-committed-reader-plan-2026-08-02.md`](ops/r4c2c-supabase-committed-reader-plan-2026-08-02.md)
- Completed R3 plan: [`ops/r3-adapter-reader-integration-plan-2026-08-01.md`](ops/r3-adapter-reader-integration-plan-2026-08-01.md)
- Runtime invariants: [`history-runtime-contract.md`](history-runtime-contract.md)
- Resource gates: [`resource-envelope.md`](resource-envelope.md)

## Retired production checkpoint

Controlling checkpoint: Issue #1079.

- network: `devnet`
- Mainnet enabled: `false`
- Worker Cron: empty
- last completed slot: `2026-08-01T03:52:00Z`
- failed slot: `2026-08-01T03:53:00Z`
- failure: `Too many subrequests by single Worker invocation`
- last processed ledger: `4,051,454`
- latest observed ledger at halt: `4,108,194`
- terminal lag: `56,740`
- successor chain: halted
- 24-hour soak: not started

The halted Cloudflare deployment is rollback context and historical evidence only. It is not an operating collector.

## Completed reconstruction milestones

- R0 contract and portability reset: PR #1081.
- R1 reference schema and deterministic planner: PR #1082.
- R2 portable typed runtime and parent exit: PRs #1084–#1095.
- R3 adapters, reader, mappers, publication, maintenance, and complete-state transfer: PRs #1096–#1101.
- R4A qualification contract and initial matrix: PR #1102.
- R4B machine-readable evaluator: PR #1103.
- R4C1 local SQLite service supervisor: PR #1104.
- R4C2a Supabase remote probe bootstrap and unattended deploy: PRs #1105–#1107.
- R4C2b Supabase durable remote phase chain: PR #1108, merge `aa5712e874707993d7eb945430c9d926d070b461`.
- Supabase deployment run ledger: Issue #1109 and PR #1110, merge `c6446d8c5f336665e1f873c34c30556ec0c907bd`.
- R4C2c seven-class remote executor implementation: PR #1112, merge `9bd01c94f891f72f7e04c54ebb106f55fa475d37`.
- Supabase prebundle and Cloudflare-transport separation: PRs #1113 and #1114, final merge `fa275a6372cd8d9ee3a486b5e65b530ffc421eb1`.
- R4C2c remote deployment evidence reconciliation: PR #1115, merge `805f0fca31e763abd3f65555019e5e8d2317124b`.

## R3 completion

R3 is complete on `main`. Retained R3A–R3E suites prove provider-neutral phase execution, committed-reader semantics, strict seven-class mapping, legacy-authoritative shadow comparison, verified publication, publication-gated maintenance, and exact complete-state export, restore, and continuation.

## Active R4 work

### R4C1 — Local SQLite profile

Status: **complete on `main`; conditional and unselected**.

The local file-backed SQLite supervisor proves crash/reopen persistence, exact-expiry process-lease reclaim, scheduler-state persistence, backoff, graceful stop, and terminal halt. G7 throughput, G8 sustained resources, and G9 actual always-on operations remain unresolved.

### R4C2a — Supabase remote probe

Status: **complete**.

Run `30709474048` verified cardless remote project access, Vault-backed authentication, migration and Edge Function deployment, one-minute `pg_cron`, short-lived transactional tick leases, repeated Devnet observation, and sanitized evidence.

### R4C2b — Supabase durable remote phase chain

Status: **complete with retained repository evidence**.

Run `30726776731` succeeded on main commit `c6446d8c5f336665e1f873c34c30556ec0c907bd`.

Verified deployment steps:

- exact project link;
- pending migration application;
- exact Devnet phase executor deployment;
- remote phase-chain verifier;
- sanitized evidence artifact;
- Issue #1109 run locator publication.

Retained evidence at `2026-08-02T01:17:22.860Z`:

- profile: `supabase-devnet`;
- network: `devnet`;
- phase epoch: `supabase-r4c2b-v1`;
- immutable base ledger: `4,132,391`;
- stream status: `active`;
- completed ticks: `504`;
- recent Cron runs: `5/5 completed`;
- consecutive failures: `0`;
- last error: `null`;
- retained consecutive committed works: `4`;
- committed watermark ledger: `4,132,395`;
- committed watermark hash: `63B0C8EDE770DCA9591E9147CA036821AC5197B8AC2403A394D8C1AA8F9D9454`;
- latest successor: `scan / pending / attempt 0`;
- recent terminal phase messages: `0`.

The latest retained work proves the exact sequence:

`scan completed/staged -> deterministic commit completed -> deterministic finalize completed/committed -> committed watermark -> deterministic next scan pending`.

The committed-only view exposed the `validated-ledger` row matching the watermark. Four consecutive ledger rows from `4,132,392` through `4,132,395` were retained as committed evidence.

This closes the initial remote portions of G3 and G4 for one validated-ledger work item per scan and provides remote committed-only visibility evidence for that class. It does not complete the full hard gates.

### R4C2c — Seven-class remote collector and reader/transfer parity

Status: **remote executor deployed and schema-3 verifier passed; committed-reader implementation pending remote proof; remaining R4C2c evidence active**.

Run `30735822415` succeeded on main commit `fa275a6372cd8d9ee3a486b5e65b530ffc421eb1` after the Supabase dependency graph was separated from the Cloudflare RPC transport.

Retained deployment evidence:

- bundle bytes: `103,351`;
- bundle SHA-256: `e7e4b58f5a841c3f5dd85cc024235f8f33b0db8a49d4956c00b056a4385139f8`;
- unresolved relative imports: `0`;
- Cloudflare runtime imports: `0`;
- verifier schema: `3`;
- phase epoch: `supabase-r4c2c-v1`;
- immutable base ledger: `4,132,417`;
- committed watermark ledger: `4,132,418`;
- committed watermark hash: `F19EAD766B2B052513A08A0131F40B41E77C6DA273CE9C775ECC380E2FB02072`;
- completed ticks: `573`;
- consecutive failures at the evidence fence: `0`;
- last error: `null`;
- latest successor: `scan / pending / attempt 0`.

The deployed executor and verifier use all seven semantic classes and passed ordered commit, committed-only visibility, semantic-count parity, and successor-continuation checks. The retained Devnet work contained no Lending transaction, so actual committed counts were one `validated-ledger` row and zero rows for protocol events, object changes, loan lifecycle, archived objects, balance history, and current projections.

Two retained Cron runs immediately before the successful R4C2c runs failed with `base_mismatch: scan message scope is not R4C2b Devnet`. The activation recovery subsequently reached the new epoch and the verifier passed, but the transition must not be described as failure-free. The retained scan completed at attempt `241`; commit and finalize completed at attempt `1`.

PR #1116 implements a separate qualification-only Supabase committed reader with an atomic stream/watermark/work fence, committed-only exact/semantic/range/relationship reads, deterministic ordering, bounded pagination, and source/query/order/fence-bound SHA-256 cursors. It does not switch the application reader. No part of that reader may be credited under G5 until the exact main-branch bundle passes its remote verifier and the resulting evidence is retained.

Remaining R4C2c work:

1. capture non-empty real Devnet evidence for the other six semantic classes;
2. prove class-complete identities and relationships remotely;
3. prove true multi-chunk remote continuation;
4. pass and retain remote committed-reader fence, pagination, exact/range parity, tamper, query/order, source, and stale-fence evidence;
5. implement exact collection, scheduler, publication, and maintenance export;
6. prove empty-target restore with canonical parity and post-restore continuation;
7. add remote interruption, retry, stale-lease, duplicate, and terminal-injection evidence.

### R4C2d–R4E

- R4C2d: G7 throughput and G8 sustained resource/quota qualification;
- R4C2e: R4B decision revision and R4E selection or `no_profile_qualified`.

R4C2d must not start from a claim that R4C2c is complete. The Supabase profile remains `remote_verified_conditional_candidate`, `not_selected`, and unavailable for public cutover or R5 recovery.

## Later phases

### R5 — Controlled recovery

Deploy only a fully qualified and explicitly selected R4 profile. Then prove one staged work item, rollback, restore, and a fixed two-hour catch-up qualification.

### R6 — Lag-zero and steady qualification

Reach lag zero, pass twelve consecutive five-minute freshness checkpoints, and remain inside a measured no-cost envelope.

### R7 — Formal operation evidence

Pass fixed 24-hour and seven-day evidence windows before reopening formal Devnet release qualification.

## Operating restrictions

- Do not describe the R4C2c deployment as complete seven-class qualification while six classes have only zero-count remote evidence.
- Do not describe the committed-reader implementation as remotely verified before a successful main-branch verifier artifact is retained.
- Do not describe the retired Cloudflare collector as operating.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select a profile before all R4 hard gates pass.
- Do not add a payment method, paid plan, or automatic-overage profile.
- Do not use GitHub Actions as the normal collection clock; Supabase `pg_cron` owns the remote clock.
- Do not start R5 recovery or R6 stabilization/soak early.
- Do not enable Mainnet.
- Do not switch the public reader.
- Do not skip a failed ledger or advance state after partial persistence.
- Do not silently fall back after integrity or identity failure.
- Do not call a theoretical no-cost projection an operating result.
