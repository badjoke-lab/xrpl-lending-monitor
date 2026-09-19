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

## D2 — Current base generation — ACTIVE

Scope:

- move the successful type-filtered binary traversal into normal source code;
- remove emergency workflow source patching;
- generate sharded base read model and indexes;
- publish an immutable candidate base as Release assets;
- measure scale.

Exit:

- complete marker exhaustion for Vault/LoanBroker/Loan;
- relationship checks pass;
- manifest/digests pass;
- candidate is readable without D1.

## D3 — Five-minute live collector

Scope:

- scheduled GitHub Actions collector;
- channel cursor/hash;
- contiguous catch-up;
- Current mutations and History records from one scan;
- immutable delta publication;
- channel-last activation;
- concurrency guard.

Exit:

- no-op, normal run, catch-up, failure, retry, and duplicate-run tests pass;
- no D1/Queue/Supabase mutation occurs.

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