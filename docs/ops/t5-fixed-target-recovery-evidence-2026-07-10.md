# T5 fixed-target recovery evidence — 2026-07-10

## Status

This document records retained non-production evidence for the fixed-target canonical catch-up path created after T5-1 identified D1 persistence as the active dense-backlog bottleneck.

This evidence does not authorize production cutover. Production remains on the protected four-hour WSS32 window-4 cadence. M5-5 remains incomplete. M6 has not started.

## Why this path exists

T5-1 retained artifact `8219138203` measured three dense-region WSS32 runs:

- 32 ledgers read per run;
- 9, 10, and 9 ledgers committed;
- persistence rows written: 2,493, 2,578, and 2,294;
- cursor delta `+19` while observed head delta was `+199`;
- lag delta `+180`;
- zero collector failures.

The result showed that higher transport capacity alone cannot solve dense backlog catch-up. The recovery design therefore moves immutable backlog processing to GitHub Actions/Git-backed history data, rebuilds current state at one fixed verified target, then plans to return D1 to bounded live-tail continuation after a guarded cutover.

## Evidence sequence

### 1. Source-bound fixed-target extension plan

PR #315 added `HistoryExtensionPlan` and its CLI.

The plan binds:

- source chain ID;
- source publication digest;
- source terminal ledger index/hash;
- source terminal segment ID;
- fixed target ledger index/hash;
- exact ordered extension segment ranges;
- predecessor anchor identity/hash.

Extension start is derived only as `source publication end + 1`. Generation is not allowed to reinterpret `validated` as a moving target after the plan is frozen.

### 2. Single-segment real Devnet extension rehearsal

PR #316 retained the first real fixed-target rehearsal.

- source terminal ledger: `3432924`;
- extension range: `3432925..3432928`;
- source binding verification: passed;
- fixed target capture: passed;
- segment generation: passed;
- source-terminal parent continuity: passed;
- generated terminal hash/frozen target hash match: passed.

Retained artifact: `8219635117`.

### 3. Plan-bound artifact verifier

PR #317 added an explicit verifier that requires generated manifests to exactly realize the frozen plan:

- manifest count;
- segment ID;
- network and epoch;
- start/end range;
- ledger count;
- predecessor ID/hash;
- complete chain terminal ledger/hash.

The real Devnet single-segment rehearsal passed with this verifier. Retained artifact: `8219753016`.

### 4. Multi-segment fixed-target extension rehearsal

PR #318 retained a three-segment real Devnet rehearsal.

- source terminal ledger: `3432924`;
- target ledger: `3432936`;
- extension range: `3432925..3432936`;
- extension ledgers: `12`;
- planned segments: `3`;
- segment size: `4` ledgers each;
- all three segments succeeded on attempt `1`;
- checkpoint next ledger: `3432937`;
- checkpoint completed segment count: `3`;
- plan-bound artifact verification: passed;
- source-terminal through fixed-target chain verification: passed.

Fixed target hash:

`754AFB3A2138B6303B4F89DC1F0F1405D32C1CE7665E1E4023E45068707C88B1`

Workflow run: `29073900381`.
Retained artifact: `8219936697`.

### 5. Extended full publication rehearsal

PR #319 added a source-bound extended publication builder. It verifies the existing source publication digest, requires exact source/plan identity binding, preserves the verified source segment descriptor prefix, verifies the extension suffix against the frozen plan, appends extension descriptors only, and computes a new publication digest.

A retained real-artifact rehearsal combined:

- source prefix: `123` segments / `61,249` ledgers;
- extension suffix: `3` segments / `12` ledgers;
- full result: `126` segments / `61,261` ledgers;
- start ledger: `3371676`;
- terminal ledger: `3432936`;
- terminal hash: `754AFB3A2138B6303B4F89DC1F0F1405D32C1CE7665E1E4023E45068707C88B1`;
- source prefix preserved: `true`.

New full publication digest:

`367eef037d22fe170acac57d61c89315116c5bc3ed7cecfe4f39bb7242f0719d`

Workflow run: `29074302912`.
Retained artifact: `8220094010`.

### 6. Extended exact-index rehearsal

A non-production retained rehearsal rebuilt the exact index against the complete 126-segment publication and then resolved real terms back to immutable history records.

- publication segment count: `126`;
- publication ledger count: `61,261`;
- terminal ledger: `3432936`;
- bucket count: `256`;
- exact-index records: `280,454`;
- index build elapsed time: `21s`;
- real term categories rehearsed: transaction, object, loan;
- all three terms returned at least one reference and at least one matching immutable record;
- publication digest binding: passed.

Exact-index manifest digest:

`d1f78231c221f55ab4f5bdf2c4a5788a9bd8663dea39f45ad73fee9342131a45`

Workflow run: `29074769867`.
Retained artifact: `8220285318`.

### 7. Extended replacement current-state rehearsal

A non-production retained rehearsal rebuilt replacement current state from the verified release-native base through the complete 126-segment publication.

- source snapshot: `devnet-3371675-0ba2ed766c19`;
- source ledger: `3371675`;
- source object count: `1,552,503`;
- publication segments: `126`;
- publication ledgers: `61,261`;
- target ledger: `3432936`;
- target hash: `754AFB3A2138B6303B4F89DC1F0F1405D32C1CE7665E1E4023E45068707C88B1`;
- replacement rebuild elapsed time: `441s`;
- mutation records: `5,776`;
- applied upserts: `5,682`;
- applied deletes: `94`;
- read-model page files: `31,103`;
- lookup files: `4,096`;
- target current object count: `1,555,061`.

Target object counts:

- Vaults: `799,002`;
- LoanBrokers: `528,988`;
- Loans: `227,071`.

Target snapshot ID:

`devnet-3432936-754afb3a2138`

Target manifest digest:

`3186d5600a644e74c04cf65ba09d59437c30cd9c7604a2e8c462170f5b5d1858`

Workflow run: `29074546460`.
Retained artifact: `8220315224`.

## What has been proved

The retained evidence proves the following non-production path at small extension scale:

1. freeze source identity and one target ledger/hash;
2. derive an exact contiguous extension plan;
3. generate multiple linked extension segments with bounded retries and checkpointing;
4. verify the generated artifact set against the frozen plan;
5. preserve the verified immutable prefix and append only the extension suffix;
6. build a complete publication ending exactly at the fixed target;
7. rebuild an exact index bound to that publication;
8. resolve real exact-history terms back to immutable records;
9. rebuild replacement current state to exactly the same target ledger/hash.

The result materially reduces the recovery uncertainty. The remaining uncertainty is operational orchestration and cutover safety at the real backlog scale, not whether the core transforms can produce mutually aligned history/index/current-state outputs.

## Still not proved

The following remain open and must not be claimed as complete:

- a real tens-of-thousands-ledger extension generation run through the current backlog;
- publication of the new fixed-target history/current-state pair to candidate branches and successful remote-reader rehearsal;
- production cutover preflight binding candidate commit identities, publication digest, current-state manifest digest, target ledger/hash, and expected D1 cursor/overlay identity;
- production history activation;
- guarded D1 same-epoch rebase to the new target;
- production current-state activation;
- bounded live-tail restart and freshness/D1 headroom verification;
- M5-5 browser evidence and exit reconciliation.

## Active next gate

The next active gate is the T5 candidate-pair rehearsal. It must publish dedicated non-production T5 history and current-state candidate branches at ledger `3432936`, then run the existing remote GitHub readers against those branches.

Required evidence:

- history/current epoch match;
- history/current terminal ledger/hash match;
- current Vault/Broker/Loan list reads;
- current Vault/Broker/Loan exact reads;
- three immutable exact-history lookups;
- bounded recent immutable history read.

Only after this gate passes should production cutover preflight tooling be finalized.
