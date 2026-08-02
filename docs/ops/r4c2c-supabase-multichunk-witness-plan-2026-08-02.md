# R4C2c Supabase standard-phase multi-chunk witness plan — 2026-08-02

Status: implementation unit for true multi-chunk phase execution and committed-reader continuation in an isolated Supabase qualification profile.

## Purpose

The isolated historical-witness profile proved atomic persistence and committed reads for all seven semantic classes, but it used a direct qualification loader rather than the standard `scan -> commit -> finalize` phase chain.

This unit proves that a real Devnet Lending ledger producing more than one normalized payload chunk can pass through the standard phase tables and standard portable completion RPCs without changing the active `supabase-devnet` stream.

## Fixed witness

- profile: `supabase-devnet-multichunk-witness`
- source: `supabase-r4c2c-multichunk-witness`
- network: `devnet`
- epoch: `supabase-r4c2c-v1`
- base identity: `multichunk-witness-2776760`
- immutable base ledger: `2,776,759`
- immutable base hash: `E7E4E253C314D5EBD39E8C063415A99299E48FB23A0E613F1FE5CA534B0C0628`
- target ledger: `2,776,760`
- target hash: `83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D`

The retained read-only discovery evidence establishes that ledger `2,776,760` normalizes to `116` records:

| Semantic class | Rows |
| --- | ---: |
| `validated-ledger` | 1 |
| `protocol-event` | 8 |
| `object-change` | 94 |
| `loan-lifecycle` | 1 |
| `archived-object` | 0 |
| `balance-history` | 2 |
| `current-projection` | 10 |
| **Total** | **116** |

The portable payload limit is `40` records per chunk, so the exact expected payload and commit shape is:

1. chunk `0`: `40` rows;
2. chunk `1`: `40` rows;
3. chunk `2`: `36` rows.

## Standard phase proof

The token-gated executor must use:

- `xrpl_phase_streams`;
- `xrpl_phase_messages`;
- `xrpl_phase_successors`;
- `xrpl_phase_work`;
- `xrpl_phase_payload_chunks`;
- `xrpl_phase_reference_rows`;
- `xrpl_phase_commit_chunks`;
- `xrpl_phase_watermarks`;
- `xrpl_complete_portable_scan_phase`;
- `xrpl_complete_portable_commit_phase`;
- `xrpl_complete_portable_finalize_phase`.

Required completed message sequence:

1. `scan`;
2. `commit:0`;
3. `commit:1`;
4. `commit:2`;
5. `finalize`.

The work is not committed until all three payload chunks, all three commit chunks, and all `116` reference rows exist and match the semantic-count envelope.

## Reader proof

The qualification-only reader is bound to:

- one exact source ID;
- one exact profile;
- one exact epoch and base identity;
- the committed watermark and work ID;
- one immutable ledger fence;
- `pcr1` SHA-256 cursor envelopes;
- source, query, order, fence, and offset.

The full ledger-range read must return:

- page `1`: `40` rows;
- page `2`: `40` rows;
- page `3`: `36` rows;
- total: `116` unique rows;
- one unchanged work ID and fence on every page.

The verifier also checks semantic-count parity, exact lookup, cursor digest tamper rejection, query/order mismatch rejection, cross-source rejection, stale-fence rejection, missing-token rejection, and wrong-purpose rejection.

## Isolation

This unit must not:

- claim an active `supabase-devnet` phase message;
- change the active stream epoch or base identity;
- insert a work under the active profile;
- advance or replace the active watermark;
- change the public reader;
- submit an XRPL transaction;
- enable Mainnet;
- select a profile;
- begin R5 recovery, stabilization, or soak.

The executor records the active watermark before and after the isolated work and fails if canonical equality changes.

## Deployment

The existing single guarded Supabase deployment workflow:

1. bundles all six exact Edge entries;
2. rotates one masked per-run verifier token;
3. applies the pending migration;
4. deploys the two new qualification functions;
5. re-runs the active collector, active reader, and historical verifiers;
6. runs the multi-chunk executor and reader verifier;
7. uploads one sanitized artifact;
8. publishes one Issue #1109 run locator.

No new workflow or schedule is added.

## Completion rule

Merging implementation does not close the unit. Completion requires a successful main-branch deployment with retained evidence proving:

- exact `scan -> commit:0 -> commit:1 -> commit:2 -> finalize` execution;
- payload chunk counts `40 / 40 / 36`;
- commit mutation counts `40 / 40 / 36`;
- committed row count `116`;
- reader page sizes `40 / 40 / 36` under one work fence;
- active watermark unchanged;
- all required fail-closed checks.

After that evidence is retained, R4C2c still requires complete-state export/restore, post-restore continuation, and remote interruption, retry, stale-lease, duplicate-phase, and terminal-injection qualification.
