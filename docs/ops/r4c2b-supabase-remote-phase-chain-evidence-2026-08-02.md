# R4C2b Supabase remote phase-chain evidence — 2026-08-02

Status: remote `scan -> commit -> finalize -> next scan` chain verified on the cardless Supabase Free Devnet profile. This is not full seven-class collector qualification, profile selection, public cutover, R5 recovery, or soak.

## Deployment evidence

GitHub Actions workflow run `30726776731` completed successfully on main commit `c6446d8c5f336665e1f873c34c30556ec0c907bd`.

Every deployment and verification step passed:

- required GitHub Secret bindings;
- Supabase CLI setup;
- exact project linking;
- pending migration application;
- exact Devnet phase executor deployment;
- repeated remote portable phase execution verification;
- sanitized artifact upload;
- retained Issue #1109 run locator publication.

Artifact:

- name: `supabase-remote-probe-evidence`;
- artifact ID: `8826618235`;
- digest: `sha256:526f594c2ef16a6abe9c7b442c7a43952c19f9f8dee7149a72c12ed5f6de107c`;
- verifier evidence schema: `2`;
- verification timestamp: `2026-08-02T01:17:22.860Z`;
- verifier attempt: `1`.

Machine-readable retained evidence: [`r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.json`](r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.json).

## Stream identity

- profile: `supabase-devnet`;
- network: `devnet`;
- phase epoch: `supabase-r4c2b-v1`;
- immutable base ledger: `4,132,391`;
- immutable base hash: `568EB96802AF699D0F1E469CE95662AAA3727E043ED84D46F3487BAD2FBD42A5`;
- stream status: `active`;
- terminal error classification: `null`;
- terminal error message: `null`.

The immutable base was captured from the previously verified remote probe and was not silently replaced after phase-chain bootstrap.

## Verified durable phase chain

The retained evidence contains four consecutive committed work items for ledgers:

- `4,132,392`;
- `4,132,393`;
- `4,132,394`;
- `4,132,395`.

For the latest work at ledger `4,132,395`, the exact retained chain is:

1. scan message completed with status `staged`;
2. scan reserved the deterministic commit message;
3. commit message completed with one operation and one row mutation;
4. commit reserved the deterministic finalize message;
5. finalize completed with status `committed`;
6. finalize advanced the committed watermark;
7. finalize reserved the next deterministic scan message;
8. the next scan remained `pending` with attempt count `0` at the evidence fence.

All completed phase messages in the retained evidence had attempt count `1`. No recent phase message had terminal status `error`.

## Latest committed work

- watermark ledger: `4,132,395`;
- watermark hash: `63B0C8EDE770DCA9591E9147CA036821AC5197B8AC2403A394D8C1AA8F9D9454`;
- previous ledger: `4,132,394`;
- expected parent hash: `D7FC0DB59278EA99C4D88AC319487BB570D4C23C8DBD2AF277268EAE4DB0B583`;
- work status: `committed`;
- expected payload chunks: `1`;
- expected commit chunks: `1`;
- payload digest: `92c62435872bd9a8c6292e82b91c900a99b6828dbc37a8a17893158cdb564a51`;
- commit chunk digest: `056e6f4cc0a17a5e4cb145a2732bbd2aa5c485f67f9bd9b4f63897bde155c632`;
- committed at: `2026-08-02T01:17:00.782Z`.

The committed-only view exposed exactly the validated-ledger row matching that work and watermark:

- semantic class: `validated-ledger`;
- canonical key: `ledger:4132395`;
- source ledger index: `4,132,395`;
- source ledger hash: `63B0C8EDE770DCA9591E9147CA036821AC5197B8AC2403A394D8C1AA8F9D9454`;
- tombstone: `false`.

No staged row was used as verification evidence.

## One-minute runtime evidence

At the same evidence fence:

- completed tick count: `504`;
- consecutive failures: `0`;
- last error: `null`;
- last observed Devnet ledger: `4,132,619`;
- last observed Devnet ledger hash: `AF80B4626FEEE030A343290B4C0BD0CED6BDC1A7DE8EB1197A53B3858898942C`;
- recent retained Cron runs: `5/5` completed without error.

The runtime status was `stopped` because the short tick lease is released after each Cron execution. The pending successor and repeated Cron history prove that the one-minute phase executor remained scheduled.

## What this proves

R4C2b now has remote operating evidence for:

- deterministic scan, commit, and finalize message identity;
- durable pending, leased, completed, and successor state;
- atomic current-message completion and successor reservation;
- actual validated Devnet parent-chain checking;
- payload digest and byte-count verification;
- committed work and commit-chunk evidence;
- atomic committed-watermark advancement;
- committed-only row visibility;
- next-scan continuation from the committed boundary;
- repeated unattended `pg_cron` execution;
- sanitized evidence and run-location publication without dashboard use.

## What this does not prove

R4C2b deliberately persists only the `validated-ledger` semantic class. It does not yet prove:

- protocol events;
- object changes;
- loan lifecycle events;
- archived objects;
- balance history;
- current projections;
- portable committed-reader cursor parity on Supabase;
- complete collection, scheduler, publication, and maintenance export/restore on Supabase;
- G7 throughput thresholds;
- G8 sustained Free-plan resource headroom and stop thresholds;
- public-reader cutover;
- Mainnet;
- R5 recovery;
- qualification slots or soak.

## Current decision

The Supabase profile remains `remote_verified_conditional_candidate`, `not_selected`, and ineligible for final R4 selection.

R4C2c is next: extend remote scan normalization and persistence from `validated-ledger` to all seven semantic classes while preserving the proven phase and transaction boundaries.
