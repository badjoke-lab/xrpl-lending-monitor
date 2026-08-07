# R4F G6 revision-4 moving-head catch-up convergence contract

Date: 2026-08-07
Issue: #1261
Status: fail-closed verifier prepared; G6 remains unresolved

## Purpose

G6 must prove that one bounded revision-4 catch-up mode closes a real backlog faster than Devnet creates new ledgers while preserving the same fixed rolling egress, invocation, memory, and claim guards used by G5.

The older R4C2d isolated throughput evidence is not sufficient by itself because it replays a fixed 64-work source window. G6 requires a moving source head and an advancing committed watermark in the same consecutive minute buckets.

This unit prepares only an offline verifier, synthetic non-qualifying fixture, and regression tests. It does not run a provider experiment, qualify G6, select revision 4, authorize R5 recovery, or mutate production.

## Locked policy

- steady reference rate: `21` ledgers/minute;
- catch-up throughput floor: `30` committed ledgers/minute;
- minimum retained moving-head shape: `6` consecutive UTC-minute buckets;
- rolling window: `44,640` minutes / 31 days;
- rolling billable-egress halt: `4,294,967,296` bytes;
- invocation halt: `400,000` per 31 days;
- memory halt: `234,881,024` bytes / 224 MiB;
- claim cap: `12` ledgers.

A changed policy value is rejected instead of normalizing evidence to the change.

## Prerequisites

A proof-ready G6 bundle requires:

1. G3 provider reconciliation already passed;
2. G5 steady convergence already passed;
3. the retained G3 provider-capture digest;
4. the retained G5 evidence digest;
5. the selected unexplained-delta reserve per minute;
6. an approved intervention reserve and rationale digest;
7. a retained G5 steady billable-egress upper bound per minute;
8. a retained G5 steady invocation upper bound per minute.

Therefore the current unresolved G3 and G5 gates make any present G6 evidence non-qualifying by construction.

## Required moving-head minute evidence

Every retained minute must include:

- an exact UTC-minute boundary;
- source-head ledger index at the beginning and end of the minute;
- committed-watermark ledger index at the beginning and end of the minute;
- committed ledger count equal to the committed-watermark advance;
- at least 30 committed ledgers;
- invocation count sufficient to cover those ledgers under the retained maximum claim size and fixed 12-ledger cap;
- revision-4 application billable-egress upper bound;
- maximum process RSS;
- accounting digests;
- committed state;
- parent-hash continuity;
- zero duplicates and zero skipped ledgers.

Across adjacent buckets, the next source-head start must equal the prior source-head end, the next committed-watermark start must equal the prior committed-watermark end, and timestamps must be exactly 60 seconds apart.

## Convergence definition

For each minute:

```text
backlog_start = source_head_start - committed_watermark_start
backlog_end   = source_head_end   - committed_watermark_end
head_advance  = source_head_end   - source_head_start
watermark_advance = committed_watermark_end - committed_watermark_start
backlog_reduction = backlog_start - backlog_end
```

Proof-ready evidence requires:

- `head_advance > 0` — Devnet really moved during the observation;
- `backlog_start > 0` — the sample is genuinely in catch-up mode;
- `backlog_end >= 0` — the committed watermark never claims to be ahead of the observed source head;
- `backlog_reduction > 0` in every retained minute;
- `committed_ledgers > head_advance` in every retained minute.

A high throughput number against a static source window cannot satisfy G6.

## Rolling resource blend

The verifier uses the maximum observed catch-up application egress and invocation count per retained minute. It adds the selected unexplained-delta reserve to the catch-up egress minute upper bound.

It conservatively estimates catch-up duration from the initial retained backlog and the minimum observed per-minute backlog reduction:

```text
projected_catchup_minutes
  = ceil(initial_backlog / minimum_observed_backlog_reduction_per_minute)
```

For the 31-day rolling guard, the projected catch-up portion is capped at the rolling-window length. Any remaining minutes use the already-qualified G5 steady upper bounds. The approved intervention reserve is then added once to projected rolling egress.

Both projected rolling egress and projected rolling invocations must remain strictly below the unchanged project halts. Memory peaks must remain strictly below 224 MiB and no claim may exceed 12 ledgers.

## Fail-closed classes

G6 is not proof-ready when any of the following is present:

- synthetic or static-source evidence;
- G3 or G5 unresolved;
- missing prerequisite digests or approved reserve evidence;
- fewer than six consecutive UTC-minute buckets;
- a source head that does not advance;
- a discontinuity in the source-head or committed-watermark sequence;
- a missing backlog or a watermark ahead of the observed source head;
- any minute whose backlog does not shrink;
- catch-up work that does not outrun source-head advance;
- any minute below 30 committed ledgers;
- invocation evidence that cannot cover the committed ledger count under the claim cap;
- changed 4 GiB, 400,000 invocation, 224 MiB, or 12-ledger guards;
- rolling egress or invocation projection at or above the halt;
- memory-halt recurrence or claim-cap bypass;
- gaps, duplicates, skipped ledgers, uncommitted evidence, or failed parent-hash continuity;
- production credentials or mutation;
- R5 mutation, public-reader change, transaction submission, Mainnet, stabilization, or soak;
- secret-bearing evidence.

## Offline verification

```bash
bash scripts/test-r4f-revision4-catchup-convergence-verifier.sh
```

The retained synthetic fixture is intentionally non-qualifying and must exit with code `2` in proof-required mode.

A future bounded evidence bundle uses:

```bash
node .tmp/r4f-revision4-catchup-convergence-verifier.mjs \
  --input <bounded-moving-head-catchup.json> \
  --output <verified-moving-head-catchup.json> \
  --require-proof-ready
```

## Current conclusion

The G6 fail-closed verifier contract is prepared only. No moving-head catch-up proof run has been performed. G3 remains unresolved, G5 remains unresolved, G6 remains unresolved, revision 4 remains `not_selected`, and R5 recovery mutation remains unauthorized.
