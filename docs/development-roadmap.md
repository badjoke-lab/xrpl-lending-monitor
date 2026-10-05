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

## D3 — Live collector and publication — COMPLETE

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

Schedule-delivery evidence and operational hardening:

- genuine GitHub Actions schedule driver run `35847201599` completed successfully with `event=schedule`;
- its bounded collector dispatch run `35847211102` completed successfully and advanced the live control head to ledger `5,534,676` with full channel-last publication and linked-chain verification;
- subsequent observation found that GitHub did not deliver the dedicated five-minute cron consistently enough to treat one successful scheduled event as sustained cadence proof;
- PR #1700 replaced direct five-minute cron dependence with a half-hour driver (`:17`, `:47`) that holds six bounded five-minute dispatch slots, while preserving the existing collector, channel, sharding, and qualification contracts;
- post-#1700 owner diagnostic driver run `35870131475` passed and dispatched collector run `35870142951`, which also passed and advanced the control head to ledger `5,534,932`;
- 2026-09-24 read-only qualification measured ledger `5,538,772 → 5,556,349` (lag `17,577`) after half-hour cron delivery again proved intermittent; shard bounds and full chain verification remained valid.
- The driver is hardened to self-chain one successor `workflow_dispatch` after each six-slot batch, leaving cron `:17/:47` as bootstrap/fallback while preserving the bounded collector and single-writer contract.
- PR #1714 merged as `a2564945b988b8aa15b7dd8837fe59fc89ef9252` after three consecutive scheduled collectors failed on transient Devnet RPC reads; D3 now retries only XRPL RPC preparation failures inside the same collector slot, with four bounded attempts, alternating endpoint priority, and bounded 5s/10s/15s backoff while non-RPC/integrity failures remain fail-closed.
- Sustained five-minute cadence is now demonstrated after that hardening: natural collector runs `36097185560` through `36148943212` cover 2026-09-25 05:06:44Z–14:40:09Z, with 114 executed collectors all succeeding and a maximum start-to-start interval of 314 seconds.
- The latest observed collector `36148943212` advanced the verified control head from ledger `5,596,828` to `5,596,916`, matched the latest validated ledger, and reported `completeToLatest=true`.
- No claim is made yet that the new same-slot RPC retry path has recovered a real production transient; the sustained-cadence PASS is based on uninterrupted natural execution, not on an injected or observed retry event.

## D4 — Compaction and bounded indexes — COMPLETE

Scope:

- compact live Current mutations into bounded overlay/index shards;
- define retention for superseded live artifacts;
- prove exact lookup and list-page query plans;
- prevent unbounded five-minute delta fan-out.

Current evidence:

- PR #1720 moved D4 initial-compaction payload reads away from the GitHub REST asset-download endpoint while retaining digest verification and bounded retry;
- PR #1721 aligned D4 Current projection canonical identity with the D3 contract;
- PR #1722 unified checkpoint writer, reader, and equivalence ordering under one bytewise canonical-key comparator;
- full read-only rehearsal run `36263240118` passed on main `f7ccb36908df2bad082f1fb5e1037d8ffd2c1e09`;
- source D3 channel head was ledger `5,629,502`;
- all `747 / 747` source generations were verified and read;
- the compacted checkpoint contains `49,045` entries, including `891` tombstones, across `256` buckets/shards;
- checkpoint manifest SHA-256: `cbdb9a91ae3af56c184df5793e71fb3fd5b307b13dfe3dc5f41e3b52edb9b274`;
- source and checkpoint state SHA-256 both equal `68300b3727907d86065a1d8c8c0ba2ff5575009517cc3ce030b35a0f182ad616`;
- equivalence: `true`;
- the rehearsal was read-only and did not activate a D4 checkpoint/channel;
- exact-bound activation PR #1725 merged and initial activation run `36425196028` passed on main `2316eec6c1d1300a8e1776d2760df2bf79066cf3`;
- activation was bound to D3 channel SHA-256 `646dc88384067d641040aa2f230f48fb2e9b0c434eca91325f8b6be22d72dbaf` at ledger `5,678,037`;
- active checkpoint Release `db-less-current-overlay-v1-5678037` contains `257` verified immutable assets and D4 channel SHA-256 `6b7f016925187c8e4875535b1465f64f0df099a73344131ad89fda8894bf9ca3`;
- activated checkpoint state SHA-256 is `21e03e8115f4f27aa426bbe05d031028afb4303b2ddca32f30d6d6aee80c22c8`;
- production-shaped incremental rehearsal run `36581602886` passed on main `b41855ffcabbf7a275d61cf88970c9ad4d4a9891`;
- it seeded from active checkpoint ledger `5,678,037` with exactly `256` checkpoint shard reads and read only `300` post-checkpoint D3 generations/manifests to reach ledger `5,707,555`;
- incremental output contained `62,334` entries / `1,220` tombstones / `256` shards and independently matched source state SHA-256 `2273296f93e48f29fe18b8f6e6958b07ea1e32c5f39430e1de99633a2342b450`;
- recurrent compaction network traversal is therefore bounded by the fixed active-checkpoint shard set plus generations since the last checkpoint, rather than total project age;
- bounded provenance is now implemented on main through PRs #1731-#1733: checkpoint schema v2 replaces the project-age-sized `sourceGenerationIds` array with `rolling-sha256-v1` provenance containing generation count, first/last generation IDs, and one SHA-256 digest;
- production-shaped incremental rehearsal run `37020574615` migrated the legacy v1 active seed to schema v2, reached ledger `5,789,957` with `2,405` total generations / `1,155` incremental generations / `256` seed shard reads, and preserved exact source/checkpoint state equivalence;
- PR #1741 added the read-only exact-channel incremental activation preflight, replacing stale PR #1724's full-chain <=2048-generation assumption;
- PR #1743 added a separate read-only D4 exit qualification for the activated remote schema-v2 checkpoint, bounded reader tests, and retention contract;
- fresh exact-bound activation run `37275016536` passed on main `8630caad5d08e4dd2d13357e00235dcbf954e98c`, activating schema-v2 checkpoint `db-less-current-overlay-v1-5864075` at ledger `5,864,075`;
- activation used `1,916` post-checkpoint generations from seed ledger `5,678,037`, emitted `rolling-sha256-v1` provenance, uploaded `257` immutable assets, and activated D4 channel SHA-256 `4fc8294a48204ec087f8a073b7a3a04989654e2430dd0286ab739c183aa9c701`;
- remote exit qualification run `37343418614` passed: 18/18 bounded read/retention tests, remote manifest schema v2, no legacy `sourceGenerationIds`, manifest size `46,633` bytes at `3,166` generations, shard bounds preserved, and active manifest SHA-256 `c8121f42a1b51ebddaf8575dae13730befafd13fbf31df048b9e750eb00ada25`;
- D4 exit criteria are satisfied. D5 Static UI cutover is the next active stage.

Exit:

- normal browser reads are bounded independently of project age;
- compaction equivalence passes;
- D4 active-channel publication/activation is separately verified before D5 consumes it.

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