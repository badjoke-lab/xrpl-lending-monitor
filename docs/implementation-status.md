# Implementation status

Last updated: 2026-07-06.

## Current phase

M1 incremental continuation is active. HYB-3 through HYB-6 are integrated into `main`, the guarded verified-base handover has completed, and production catch-up is advancing contiguously from ledger `3371676`. The remote Worker network-status path is healthy and observing Devnet through the standard-port primary endpoint. M1-HYB-7 live continuation verification and diagnostics are active. Live evidence has observed created-current, modified-current, deletion/archive/tombstone, ledger-continuity, and cursor/overlay-agreement paths; LoanPay, impairment, unimpairment, default, activity/lifecycle/balance consistency, and freshness remain incomplete. The production collector remains configured for a maximum of 40 ledgers per scheduled run with row, statement, overlay, transaction, RPC, and execution-time bounds.

Two live `ModifiedNode` metadata blockers have been reproduced from Devnet and fixed without weakening validation for known lending objects. M1 exit diagnostics use the configured catch-up base identity as the authoritative expected base and independently compare it with the active D1 overlay binding. Permanent read-only runtime monitoring samples collector progress, HYB-7 evidence and drilldown, HYB-7 path states, M1 exit evidence/gates, and handover replay state every 30 minutes. M5-5 and M6 remain gated behind M1 exit.

Dense-range live benchmarks showed that larger D1 collector budgets can restore negative lag slope, but sustained dense historical catch-up would exceed the Free D1 write envelope. The active architecture therefore separates dense historical backfill into deterministic immutable history segments while preserving D1 for bounded live continuation.

The following history architecture is integrated into `main`: segment generation, deterministic replay, chain verification, checkpoint/resume, publication contracts, exact-commit channel opening, bounded filtered reads, boundary-aware D1 reads, deterministic immutable-plus-live merge semantics, optional fail-closed hybrid route integration, explicit history-source diagnostics, the immutable exact-index foundation, and exact-index binding to the same exact data commit as the history publication.

PR #178 contains bounded hybrid Transaction Detail and cross-history Search integration. Its exact-index schema v2 carries minimal search-result metadata, keeps exact buckets newest-first within a term, applies reference-kind filters before limit, validates reference/file/search-kind mappings, performs bounded targeted segment-file reads, restricts D1 exact reads to rows after the immutable boundary, and routes verified hybrid exact reads before the general history override. PR #178 is ready, mergeable, and has passed normal CI plus Release-native CI, but remains unmerged because the connector safety gate blocked the merge operation. Production history vars remain intentionally unset.

PR #179 is stacked on PR #178 and adds an end-to-end exact-history rehearsal runner plus live evidence. The live workflow regenerated two linked Devnet segments covering ledgers `3389181 -> 3389190`, built a verified publication, built a 16-bucket schema-v2 exact index containing 1,522 records, and resolved three exact terms through targeted segment reads. Every referenced ledger resolved to matching underlying records. The evidence summary reports `passed: true`, 2 segments, 10 ledgers, and 3 successful terms. Normal CI, Release-native CI, and the live rehearsal workflow passed on the evidence-producing head.

## Verified base

The active Devnet base is fixed to ledger `3371675` and contains:

- 797,550 Vault records;
- 528,228 Loan Broker records;
- 226,725 Loan records;
- 1,552,503 total current-state records.

The exact base identity is:

- epoch: `devnet-3371675`;
- snapshot: `devnet-3371675-0ba2ed766c19`;
- ledger index: `3371675`;
- ledger hash: `0BA2ED766C190C733F8F26288785CBDF01D0FC26E1A6C03EDB7E9DFF6F8BCB90`.

## Completed continuation path

The implemented path now includes:

- verified immutable base read model publication;
- bounded D1 incremental history and current overlay;
- atomic history, overlay, watermark, and cursor advancement;
- base-plus-overlay current API resolution;
- bounded scheduled collection with deadline and work limits;
- retry and fallback request accounting;
- collector cursor, lag, freshness, and run-usage status;
- rehearsal evidence for interruption, resume, replay, and rejected gaps;
- cursor and overlay watermark checkpoint agreement;
- base-count plus create/delete delta reconciliation;
- relationship reconciliation issue propagation;
- deleted-object current exclusion and archive-presence checks;
- guarded one-time handover planning from the observation epoch to the verified base epoch;
- dry-run inspection, exact replay/no-op handling, and progressed-state no-op handling;
- pre/post sync, overlay, history, and epoch guards around the handover batch;
- fail-closed rejection for reset suspicion, unavailable network state, conflicting cursor/history/overlay state, and epoch mismatch;
- scheduled-path gating behind an explicit catch-up initialization flag;
- successful guarded handover to verified base epoch `devnet-3371675`;
- contiguous production catch-up beginning at ledger `3371676`;
- live remote evidence for created and modified current objects, deletion/archive/tombstone consistency, ledger continuity, and cursor/overlay agreement;
- read-only HYB-7 continuation verification and diagnostics;
- read-only M1 exit diagnostics with authoritative expected base identity and independently checked overlay binding;
- healthy remote Devnet network-status refresh with primary and fallback endpoints;
- live normalization coverage for observed sparse Devnet bookkeeping metadata shapes without weakening strict lending-object validation;
- bounded scheduled collector budgets and permanent 30-minute runtime monitoring;
- dense immutable history segments separated from bounded D1 live continuation;
- segment manifest validation with exact range identity, file digests, counts, and predecessor linkage;
- exact adjacent-segment index and parent-hash continuity checks;
- pure segment record generation reusing existing AffectedNodes, lifecycle, archive, balance-history, and current-projection derivations;
- bounded fixed-range segment generation with deterministic canonical JSON and deterministic gzip;
- ordered multi-segment chain verification with exact start and terminal anchors;
- segment-level checkpoint/resume state advancing only after complete validated manifests;
- atomic local checkpoint updates;
- local chain verification CLI;
- live adjacent-segment evidence over `3389181 -> 3389190` proving deterministic replay, checkpoint resume, exact parent-hash linkage, and terminal identity;
- verified-chain publication binding exact chain boundaries, ordered segment identities, manifest digests, predecessor linkage, and per-kind counts behind a semantic publication digest;
- cursor-based segment reads bounded by result count, segment reads, compressed bytes, decompressed bytes, records examined, and wall time;
- deterministic publication and channel builders;
- exact-commit runtime opening that reads publication, manifests, segment assets, and exact-index metadata only from the pinned immutable data commit;
- deterministic immutable-plus-live merge semantics with overlap suppression, stable API-specific ordering, defensive deduplication, and post-merge truncation;
- bounded predicate filtering with query scope bound into resume cursors;
- boundary-aware D1 history reads querying only ledgers after the immutable publication boundary;
- bounded hybrid history repositories for Activity, Object History, Loan lifecycle detail/explorer, Archives, and Balance History;
- optional history runtime configuration and explicit D1-only, verified-hybrid, and configured-but-unavailable source states;
- Worker-front hybrid route override using existing serializers for Activity, Object History, lifecycle, Archives, Balance History, activity exports, and feeds;
- fail-closed 503 behavior for incomplete bounded immutable scans;
- `/api/status/history-source` diagnostics;
- production history-source vars intentionally left unset until canonical chain activation review;
- immutable exact-index contract binding network, epoch, chain ID, publication digest, fixed bucket count, hash function, ordered bucket assets, source revision, generation time, and semantic manifest digest;
- exact-term normalization and SHA-256 first-u32 modulo bucket-count routing;
- bounded exact-index reader loading and verifying one bucket asset per lookup, validating record count, bucket identity, deterministic order, publication binding, and caching a small number of verified buckets;
- deterministic exact-index builder extracting transaction hashes, object IDs, loan/broker/vault relationships, account/owner/borrower values, asset keys, lifecycle terms, and balance-history terms;
- exact-index channel pointer carrying manifest path and byte digest under the same exact data commit as the history publication;
- exact-commit opener validation of exact-index byte digest, semantic manifest digest, and publication identity binding;
- runtime history-source resolution carrying the verified exact-index reader without reopening the source;
- history-source diagnostics exposing exact-index bucket count, record count, and manifest digest.

The following additional path is implemented and green in PR #178 but not yet integrated into `main`:

- schema-v2 searchable exact references with kind/file/search-result consistency checks;
- newest-first same-term exact-index ordering;
- reference-kind filtering before result limit;
- targeted segment/file reads bounded by published-segment identity, ledger range, asset reads, compressed bytes, decompressed bytes, records examined, digest, and record count;
- actual targeted asset-read usage reporting, including early-return paths;
- post-boundary D1 Transaction Detail and Search reads;
- hybrid Transaction Detail event/change merge;
- hybrid exact Search merge and deterministic ordering;
- exact-history route handling for `/api/transactions/:hash` and `/api/search` with D1-only passthrough and explicit unavailable behavior when configured hybrid exact indexes are absent or invalid.

The following additional path is implemented and green in stacked PR #179:

- local exact-history end-to-end rehearsal runner;
- read-only filesystem artifact store for rehearsal;
- publication and exact-index manifest integrity validation before lookup;
- exact-term lookup followed by grouped targeted reads of only referenced segment/file assets;
- per-reference-ledger verification that index references resolve to matching underlying records;
- canonical rehearsal summary including index/history asset reads, compressed/decompressed bytes, records examined, reference kinds, reference ledgers, and matched ledgers;
- live workflow evidence over Devnet ledgers `3389181 -> 3389190`;
- permanent evidence summary at `docs/evidence/hybrid-exact-history-rehearsal-3389181-3389190.json`.

Mainnet remains disabled.

## Latest live evidence

The first live metadata blocker stopped the collector at cursor `3375749` with `PreviousFields must be an object`. A bounded probe of ledgers `3375750` through `3375789` found successful `VaultCreate` transactions containing bookkeeping `AccountRoot` `ModifiedNode` entries with neither `PreviousFields` nor `FinalFields`. The normalizer now treats that no-material-field-delta shape as a no-op while retaining strict one-sided validation for known lending object types.

A later blocker stopped at cursor `3375895` with the same surfaced error text. A second bounded probe of ledgers `3375896` through `3375935` found sparse non-lending bookkeeping nodes such as `DirectoryNode` with `FinalFields` but no `PreviousFields`. The collector now ignores only sparse non-lending bookkeeping `ModifiedNode` shapes outside the Vault / LoanBroker / Loan object-change model. Known lending objects remain fail-closed.

After deployment of the second fix, the collector resumed advancing with zero sampled failures and null error state. The M1 expected-base fix was then deployed and verified live. At verification time:

- expected base and bound base matched exactly;
- `verifiedBaseBinding` was `observed`;
- `catchUpStart` was `observed`;
- processed-ledger evidence began at `3371676`;
- processed-ledger discontinuities were `0`;
- `validatedHeadReached` remained `missing` because catch-up was still behind the observed head;
- `liveContinuation` remained incomplete because required HYB-7 paths were still missing or inconsistent.

A six-sample one-minute post-recovery slope benchmark observed cursor `3380320 -> 3380520` (`+200`), head `3410616 -> 3410716` (`+100`), and lag `30296 -> 30196` (`-100`) with six of six zero-failure samples. The current 40-ledger Worker configuration remains unchanged for the live continuation path.

Dense-range budget experiments established that a 2048/2048 row/statement budget with 128 overlay mutations can process 40 ledgers per active run with strong negative lag slope, but the observed write volume is not suitable for sustained Free-plan D1 historical catch-up.

The first deterministic history-segment rehearsal over ledgers `3389181 -> 3389185` generated the same range twice and produced byte-identical output. It contained 5 ledger records, 14 protocol events, 213 object changes, 14 current-projection mutations, and no lifecycle/archive/balance rows.

The adjacent two-segment rehearsal covered `3389181 -> 3389190` as two five-ledger segments. Both segments reproduced byte-identically. The first terminal hash `11393A039387D5B420B2FE8791BF83D5449CA10F6B765DDB4F127D2879A8268E` exactly matched the second segment start parent hash. The final chain summary reported 2 segments, 10 ledgers, start ledger `3389181`, and end ledger `3389190` with terminal hash `C394CB53FE9D5F19D15470C45196A032A7612324146AB566BD0203EBF08803D9`. The checkpoint resumed after the first manifest and completed with `nextLedgerIndex = 3389191`. The second segment exercised non-zero derived history output: 4 loan-lifecycle rows and 2 balance-history rows.

The live exact-history rehearsal regenerated the same two linked ranges and built a schema-v2 exact index with 16 buckets and 1,522 records. It then resolved:

- one transaction hash with 25 references across `transaction_event` and `object_change`, all at ledger `3389182`;
- one object ID with 17 `object_change` references spanning ledgers `3389182`, `3389184`, and `3389186`;
- one loan ID with 18 references across `loan_lifecycle` and `object_change`, spanning ledgers `3389186`, `3389187`, and `3389188`.

All three terms resolved every referenced ledger to matching underlying records through bounded targeted reads. The exact-index manifest digest was `9a17f2f3e15676a66fe2f1c7650f62038d8c82919778335eccd183df8b2e69b9`, and the publication digest was `a89da47c9d6b63744e7a1c8d8332ea5f48a6f39605b957dd872e5bba520c5e44`.

## HYB-7 verification semantics

The verifier exposes each required live path as `observed`, `missing`, or `inconsistent`.

- zero required evidence remains `missing` and never passes by default;
- contradictory source/projection evidence is `inconsistent`;
- the overall report passes only when every required path is `observed`;
- processed-ledger gaps or parent-hash discontinuities fail continuity verification;
- archive and tombstone evidence is checked in both directions;
- cursor and overlay watermark must agree;
- freshness passes only at healthy zero reported lag.

The verification and diagnostics endpoints are read-only. They do not create live evidence or infer success from the target schedule.

## Active unit

HYB-6 live continuation remains bounded at the 40-ledger maximum configuration while dense historical catch-up is moved out of the D1 row-by-row path. The guarded handover remains complete and replays as a no-op guard before scheduled collection. Permanent runtime monitoring continues to sample progress, HYB-7 diagnostics, and raw M1 exit evidence every 30 minutes.

The active implementation sequence is now:

1. integrate the green hybrid exact Transaction Detail/Search unit from PR #178 when the merge operation is available;
2. integrate or retarget the green exact-history rehearsal unit from PR #179;
3. freeze the canonical dense-backfill range and segment sizing/checkpoint policy using current production cursor/head evidence;
4. generate and independently verify the canonical immutable history chain and schema-v2 exact index;
5. publish the exact-commit channel and rehearse configured runtime source opening plus public history routes before setting production history vars.

## Next order

1. Merge PR #178 when the connector merge gate permits the operation.
2. Merge or retarget PR #179 after the exact integration base lands.
3. Capture current production collector cursor/head and freeze the canonical historical gap boundary.
4. Define the canonical segment size, checkpoint cadence, source endpoint policy, retry envelope, and evidence retention policy.
5. Generate the dense historical gap into a canonical verified immutable segment chain and schema-v2 exact index.
6. Publish its exact-commit channel without enabling production history vars.
7. Run history-source diagnostics and bounded route rehearsal against the canonical channel.
8. Build and independently verify a replacement current-state base near the verified segment-chain end.
9. Execute guarded replacement-base handover and resume bounded D1 live continuation.
10. Re-evaluate HYB-7 diagnostics at the validated head and resolve only genuinely missing paths.
11. Complete M1 exit review and reconciliation, then M5-5 and M6 hardening.

## Remaining blockers

- PR #178 is green and mergeable but remains outside `main` because the connector merge operation is blocked.
- PR #179 is stacked on PR #178 and must be integrated or retargeted after the base unit lands.
- The current production cursor/head must be recaptured before freezing the canonical dense-backfill boundary.
- Dense historical catch-up is not yet covered by a canonical verified published segment chain.
- Canonical hybrid activation rehearsal against the published channel is not yet complete.
- Real HYB-7 live-path evidence is incomplete for LoanPay, impairment, unimpairment, default, activity/lifecycle/balance consistency, and freshness.
- M1 exit remains incomplete until validated-head reach and all required live continuation paths are observed and consistent.
- M5-5 and M6 remain incomplete.
