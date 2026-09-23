# Development roadmap

Status: active DB-less migration roadmap
Adopted: 2026-09-20

## Objective

Replace the retired Cloudflare D1/Queue/Supabase runtime with a verified static-artifact architecture while preserving the existing product semantics and as much UI/domain code as practical.

Do not resume the old Current recovery chain.

## D0 — Source-of-truth reset

Scope:

- adopt DB-less runtime contract;
- rewrite authoritative product/architecture/collector/resource/testing documents;
- remove obsolete D1/Supabase recovery plans from the current documentation tree;
- mark legacy code as migration-only.

Exit:

- repository source of truth has one coherent architecture;
- no active roadmap points to D1, Queue, Supabase, or Worker Cron.

## D1 — Persistence decoupling — COMPLETE

Scope:

- extract collector/domain derivation from D1 repository interfaces;
- define artifact writer/publisher interfaces;
- add deterministic live-delta schema;
- add channel schema;
- preserve existing parser and derivation behavior.

Exit evidence:

- PR #1663 merged as `09b9fae2eeeec54f3dbc82101e16704b41fe0b80`;
- validation run `35457202156`: typecheck, lint, and focused tests all passed;
- fixture ledger ranges produce Current + History artifacts without D1;
- repeated artifact generation is byte-for-byte deterministic for the same source revision;
- immutable artifact conflicts fail closed;
- active channel contracts encode Current continuity and explicit History coverage gaps.

## D2 — Current base generation — COMPLETE

Scope:

- move the successful type-filtered binary traversal into normal source code;
- remove emergency workflow source patching;
- generate sharded base read model and indexes;
- publish an immutable candidate base as Release assets;
- measure scale.

Exit evidence:

- Actions run `35558034659` completed successfully on source revision `f2d4da7009f3b3a34bae5c846d4558b752b0b9fe`;
- fixed validated Devnet ledger `5,479,808` / hash `7A7D48431A7B36490C226D4D9731F7C3AB825F108321FF974ACF29ABB856D59C`;
- complete marker exhaustion produced Vault `1,301,400`, LoanBroker `807,256`, and Loan `353,698`;
- independent verifier passed;
- Release-compatible base stayed within the GitHub asset ceiling at `860` assets;
- all `860` remote assets passed name/size/SHA-256 readback verification;
- verified prerelease `d2-current-base-35558034659` was published with base manifest SHA-256 `89d9346d4eb2403b80ffc53b81b1a7621d8467506b3b931bfc9f688e6b5a4dc3`;
- no D1/Queue/Supabase mutation was required.

## D3 — Live collector and publication — ACTIVE

Scope:

- stable control channel separate from immutable live-data Releases;
- channel cursor/hash;
- contiguous validated-ledger catch-up;
- Current mutations and History records from one scan;
- immutable delta and live-chain publication;
- each delta records its own artifact location so chains may span Releases;
- channel-last activation;
- single-writer concurrency guard;
- read-only rehearsal followed by one-shot publication;
- deterministic bounded data-Release sharding after delta artifact count is known;
- six-hour UTC shard buckets with a 720-asset operational ceiling and `-rN` early rotation;
- five-minute scheduling is activated through a dedicated driver after candidate evidence and bounded Release-sharding tests pass;
- owner-only diagnostic dispatch proves the exact driver → bounded collector handoff independently of GitHub cron delivery.

Current exit evidence:

- D3 rehearsal run `35594182270` passed;
- candidate initialization run `35594237813` passed;
- bounded one-shot/catch-up publication has repeatedly passed with channel-last activation and linked-chain verification;
- formal qualification run `35809460180` passed, including active shard bounds, full linked-chain reconstruction, and <=256-ledger catch-up-to-latest;
- post-activation qualification run `35822742381` also passed;
- schedule activation PR #1682 merged;
- dedicated schedule driver PR #1692, staggered five-minute cron PR #1693, and diagnostic trigger PR #1694 merged;
- diagnostic schedule-driver run `35822507664` passed and dispatched collector run `35822514298`, which also passed;
- no D1/Queue/Supabase mutation occurs.

Remaining exit proof:

- observe at least one genuine GitHub Actions `event=schedule` driver delivery and successful bounded collector dispatch from it.

## D4 — Compaction and bounded indexes

Scope:

- compact live Current mutations into bounded overlay/index shards;
- define retention for superseded live artifacts;
- prove exact lookup and list-page query plans;
- prevent unbounded five-minute delta fan-out.

Exit:

- normal browser reads are bounded independently of project age;
- compaction equivalence passes.

## D5 — Static UI cutover

Scope:

- add UI data-source abstraction;
- connect Overview and Current entity pages;
- connect Activity/history/audit pages;
- expose Current freshness and history coverage gaps;
- remove required `/api/*` dependency;
- deploy static candidate.

Exit:

- representative UI parity;
- stale/unavailable/gap states;
- accessibility/responsive regression;
- static deployment works with no canonical Worker/database.

## D6 — Legacy removal

Scope:

- delete D1 migrations/repositories;
- delete Queue/Worker scheduled runtime;
- delete Supabase runtime/recovery code;
- remove legacy build scripts/configuration;
- simplify package scripts/check;
- retire obsolete generated-data branches from operational use;
- verify no Cloudflare stateful dependency remains.

Exit:

- clean install/build/test has no D1 migration step;
- no runtime binding requires D1/Queue/Supabase;
- legacy production is not required for public service.

## D7 — Historical continuity

Scope:

- independently determine whether the gap after ledger 3,932,301 can be backfilled from available validated Devnet data;
- backfill only with complete hash-contiguous evidence;
- otherwise retain explicit gap;
- merge ranges only after exact boundary verification.

Exit:

- coverage map is truthful and machine-readable.

## D8 — Release qualification

Scope:

- production-shaped resource measurements;
- multi-day soak;
- static host/domain cutover;
- final documentation and discovery files;
- formal Devnet release decision.

Exit:

- Current remains within freshness target during soak;
- History advances contiguously from the live-generation start;
- no prohibited stateful runtime is used;
- failure drills preserve last verified public truth.