# R5 Supabase active checkpoint plan — 2026-08-03

Status: first R5 implementation unit. This unit creates the exact rollback source boundary before any active catch-up mutation.

## Authorization

The only authorized recovery profile is:

- profile: `supabase_free_postgres_pgcron_edge`;
- revision: `3`;
- identity digest: `3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67`;
- R4E selection digest: `13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667`.

R5 recovery is authorized. Public-reader cutover, Mainnet, stabilization, soak, and the retired Cloudflare collector remain prohibited.

## Why a new checkpoint is required

R4 proved export, restore, continuation, rollback, and quota-state transfer using isolated qualification namespaces. Those proofs establish the mechanism, but they are not a snapshot of the live `supabase-devnet` phase stream.

R5 must not mutate the active stream until it has an exact rollback source containing the actual active watermark, scheduler continuation, committed phase state, and rolling revision-3 resource accounting.

## Quiescent transaction boundary

`xrpl_create_r5_active_checkpoint` acquires one advisory lock and PostgreSQL share locks across:

- collector runtime;
- phase stream;
- phase messages;
- phase successors;
- phase work;
- payload chunks;
- committed reference rows;
- commit chunks;
- phase watermark;
- revision-3 attempt reservations;
- revision-3 tick accounting.

The checkpoint fails closed unless:

- the collector runtime is stopped with no lease, no last error, and zero consecutive failures;
- the active phase stream is healthy and identity-exact;
- there is exactly one pending message and no leased or retry message;
- the pending message is the successor scan for the current watermark;
- the preceding completed finalize message identifies the same watermark work, ledger, and hash;
- the watermark work is committed and identity-exact;
- no planned, staged, committing, or finalizing work remains.

Historical terminal rows are retained and counted. They are not silently deleted from the checkpoint.

## Captured state

The canonical schema-v1 checkpoint stores:

1. collector runtime;
2. active phase stream;
3. active watermark;
4. all active-profile phase messages;
5. all active-profile successor links;
6. all active-profile work rows;
7. all active-profile payload chunks;
8. all active-profile reference rows;
9. all active-profile commit chunks;
10. the complete rolling 31-day revision-3 attempt and tick-accounting state;
11. exact row counts;
12. one SHA-256 digest for every state section;
13. one SHA-256 digest for the complete canonical JSONB state.

The full state remains in the private `xrpl_r5_v1` schema. The read function returns only the identity, watermark, counts, section digests, state size, and whole-state digest.

## Duplicate and conflict behavior

Reusing a checkpoint ID converges only when the complete state, whole-state digest, counts, and section digests are exact. Any difference raises `r5_checkpoint_identity_conflict`.

## Next unit

After this migration is applied and its dormant contract passes, the next R5 unit will:

1. invoke the checkpoint remotely through an existing token-gated qualification surface;
2. independently read the current Devnet validated head;
3. retain the exact checkpoint watermark and starting lag;
4. prove the stored digest can be reread unchanged;
5. publish the sanitized checkpoint locator to Issue `#1175`;
6. authorize active recovery execution only from that retained checkpoint ID and digest.
