# R4F G5 revision-4 steady convergence contract

Date: 2026-08-07
Issue: #1261
Status: fail-closed verifier prepared and hardened; G5 remains unresolved

## Purpose

G5 must prove that revision 4 can process the steady Devnet arrival rate without exhausting the fixed no-charge rolling egress or invocation guards. A successful batch, a short burst, or execution throughput without directional accounting is not convergence evidence.

This unit prepares the offline evidence verifier only. It does not run a provider experiment, select revision 4, authorize R5 recovery, or mutate production.

## Locked policy

- required steady rate: at least `21` committed ledgers in every retained minute;
- minimum retained shape: `6` consecutive one-minute buckets;
- 31-day window: `44,640` minutes;
- required 31-day ledger volume: `937,440` ledgers;
- rolling billable-egress halt: `4,294,967,296` bytes;
- invocation halt: `400,000` per 31 days;
- memory halt: `234,881,024` bytes;
- claim cap: `12` ledgers.

The verifier rejects a changed guard instead of normalizing evidence to the changed value.

## Required prerequisites

A proof-ready G5 input requires:

1. G3 provider reconciliation already passed;
2. the retained provider-capture digest;
3. the selected unexplained-delta reserve expressed per retained minute;
4. a separately approved positive intervention reserve and rationale digest;
5. revision-4 directional application upper bounds for every minute.

Until G3 supplies real provider evidence and an intervention reserve is explicitly approved, G5 remains unresolved.

## Required minute evidence

Every minute must retain:

- exact UTC minute identity aligned to the UTC minute boundary;
- contiguous start and end ledger indexes;
- committed ledger count equal to the inclusive range;
- at least 21 committed ledgers;
- invocation count sufficient to cover all committed ledgers under the retained maximum claim size and the fixed 12-ledger cap;
- revision-4 application billable-egress upper bound;
- directional accounting digests;
- maximum process RSS;
- maximum claim size;
- committed state;
- parent-hash continuity result;
- zero skipped and duplicate ledgers.

The minute sequence must be exactly 60 seconds apart, every bucket must begin on an exact UTC minute boundary, and ledger ranges must continue from the prior end plus one. Average throughput cannot hide a sub-threshold minute. Invocation evidence cannot claim fewer executions than are physically required to cover the committed ledger count under the retained claim maximum.

## Projection

The verifier projects the observed application upper bound, selected unexplained-delta reserve, and invocation count from the retained consecutive minutes to the full 31-day window.

```text
projected rolling upper bound
  = projected application billable-egress upper bound
  + projected selected unexplained-delta reserve
  + approved intervention reserve
```

Both projected rolling egress and projected invocations must remain strictly below their fixed halts. Equality is not headroom.

Memory peaks must remain strictly below 224 MiB and no claim may exceed 12 ledgers.

## Fail-closed classes

G5 is not proof-ready when any of the following is present:

- synthetic or unbounded evidence;
- G3 unresolved;
- absent provider-capture or intervention-reserve evidence;
- fewer than six consecutive minutes;
- a retained bucket that is not aligned to an exact UTC minute boundary;
- any minute below 21 committed ledgers;
- an invocation count too small to cover the committed ledger count under the retained maximum claim size and fixed claim cap;
- a gap, duplicate, skipped ledger, or uncommitted minute;
- a changed 4 GiB, 400,000 invocation, 224 MiB, or 12-ledger guard;
- projected egress or invocation use at or above the halt;
- memory-halt recurrence or claim-cap bypass;
- production credentials or mutation;
- transaction submission, reader change, Mainnet, stabilization, or soak;
- secret-bearing evidence.

## Offline verification

```bash
bash scripts/test-r4f-revision4-steady-convergence-verifier.sh
```

The retained synthetic fixture exercises the contract and must exit with code `2` in proof-required mode. It can never satisfy G5.

A future evidence bundle uses:

```bash
node .tmp/r4f-revision4-steady-convergence-verifier.mjs \
  --input <bounded-steady-evidence.json> \
  --output <verified-steady-evidence.json> \
  --require-proof-ready
```

The proof-required CLI routes through the hardened verifier, which applies the base G5 contract plus UTC-bucket alignment and invocation-coverage invariants.

## Current conclusion

The verifier, hardening layer, and synthetic contract fixture are prepared. No qualifying steady replay has been performed. G3 remains unresolved, G5 remains unresolved, revision 4 remains `not_selected`, and R5 recovery mutation remains unauthorized.
