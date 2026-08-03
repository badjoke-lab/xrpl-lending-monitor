# R5 Supabase active recovery preparation — 2026-08-03

Status: dormant R5 preparation capability. This unit does not execute active recovery.

## Inputs

Preparation accepts only:

- one retained R5 checkpoint ID;
- its exact canonical state digest;
- one independently observed validated Devnet ledger index and hash;
- one deterministic R5 recovery run ID;
- the preparation timestamp.

The run remains bound to the selected `supabase_free_postgres_pgcron_edge` profile revision `3`, identity digest `3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67`, and R4E selection digest `13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667`.

## Checkpoint validity

The preparation function rereads the private checkpoint and rejects it unless:

- the checkpoint ID and supplied state digest match;
- recomputing the canonical JSONB digest produces the stored digest;
- profile, revision, identity, selection, source profile, network, and epoch are exact;
- the checkpoint state is still available in the private R5 schema.

## Current active-state validity

The function takes one transaction-wide advisory lock and share locks across collector runtime, phase stream, messages, successors, work, watermark, and checkpoint state.

It fails unless:

- collector runtime is stopped with no lease or error;
- the active phase stream is healthy;
- there is one pending successor scan and no leased or retry message;
- the predecessor finalize identifies the current watermark work, ledger, and hash;
- the current watermark work is committed;
- no planned, staged, committing, or finalizing work exists.

## Checkpoint descendant proof

The current watermark may equal the checkpoint watermark or may have advanced through the normal collector before R5 preparation.

When it advanced, every active-profile committed work after the checkpoint must prove:

- exactly one ledger per work;
- `start = previous + 1`;
- the first expected parent hash equals the checkpoint watermark hash;
- every later expected parent hash equals the preceding work's final ledger hash;
- the work count equals the exact ledger difference;
- the final work ID, ledger index, and hash equal the current active watermark.

A missing, duplicate, multi-ledger, reordered, or hash-divergent work prevents preparation.

## Prepared record

The private recovery record retains:

- checkpoint watermark;
- active start watermark;
- initial validated Devnet head;
- checkpoint-to-start ledger count;
- initial lag;
- exact descendant work count;
- fixed batch size `24`;
- zero completed batches and zero R5 committed ledgers;
- no accounting digest and no recovery error.

If initial lag is positive, status is `prepared`. If the active watermark already equals the observed head, status is `caught_up` with no recovery execution.

## Duplicate behavior

A repeated preparation converges only when checkpoint digest, active start watermark, observed head, and lag are exact. A changed parameter under the same run ID raises `r5_recovery_prepare_identity_conflict`.

## Boundary

This unit does not:

- start the recovery executor;
- mutate the active watermark or scheduler;
- change the public reader;
- enable Mainnet;
- authorize stabilization;
- start soak;
- restart the retired Cloudflare collector.

The next unit will invoke this preparation remotely from the frozen checkpoint evidence and then add a separately reviewed revision-3-accounted batch executor.
