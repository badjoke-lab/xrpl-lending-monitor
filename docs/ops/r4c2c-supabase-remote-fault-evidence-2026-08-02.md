# R4C2c Supabase remote fault qualification evidence — 2026-08-02

Status: **remote interruption, retry, stale-lease, and terminal-halt semantics verified in an isolated typed namespace**.

## Run identity

- workflow run: `30752742177`;
- main commit: `06c4ac9e7d39e9b7ffaa07fc076bd9705f1b86b4`;
- artifact: `8834977791`;
- artifact digest: `sha256:14f8f4e16ebe4f42b80502047479550a1d94593a7196a7cebf7672d8f8740267`;
- verified at: `2026-08-02T14:44:51.087Z`.

The same run first reverified the active executor and committed reader, the durable historical witness, the isolated multi-chunk work, complete-state transfer, and post-restore continuation. It then deployed and invoked the token-gated fault verifier.

## Isolated identity

- qualification schema: `xrpl_fault_v1`;
- qualification profile: `supabase-devnet-fault-qualification`;
- fixture: `r4c2c-remote-fault-qualification-v1`;
- active profile: `supabase-devnet`, read only for identity and isolation checks;
- network: `devnet`;
- epoch: `supabase-r4c2c-v1`.

No active-profile stream, message, successor, work, reference row, or watermark was mutated by the fault qualification.

## Interruption rollback

The rollback scenario performed these mutations in one PostgreSQL transaction:

1. inserted a rollback sentinel event;
2. inserted a synthetic successor message;
3. reserved the synthetic successor;
4. marked the current message completed;
5. raised `injected_interruption_rollback`.

The RPC returned HTTP `400`. A separate DB-side observation then required all of the following before normal completion:

- the original message remained `leased`;
- the rollback sentinel did not exist;
- the synthetic successor message did not exist;
- the successor reservation did not exist;
- the completion update did not escape the aborted transaction.

The message was then completed normally on attempt `1`. This proves that phase mutation, completion, and successor reservation roll back together when the transaction aborts.

## Retry and backoff

The transient retry scenario proved:

- exact backoff: `30` seconds;
- first claim: attempt `1`;
- claim one second before `available_at`: rejected with `not_ready`;
- claim exactly at `available_at`: accepted;
- accepted retry attempt: `2`;
- final state: `completed`.

The scheduler did not permit early execution and preserved the exact message identity across retry.

## Stale lease reclaim

The stale-lease scenario proved:

- first owner claimed attempt `1` with a ten-second lease;
- second owner was rejected one second before expiry with `lease_active`;
- second owner reclaimed exactly at expiry;
- reclaimed attempt: `2`;
- previous owner and previous expiry were retained in the claim evidence;
- final state: `completed`.

No grace-period guess or premature reclaim was accepted.

## Terminal fail-closed halt

The terminal integrity scenario proved:

- terminal message status: `error`;
- stream status: `halted`;
- classification: `integrity`;
- error: `injected terminal qualification failure`;
- successor message: absent;
- successor reservation: absent;
- exact terminal replay: converged with `duplicate: true`;
- a ready halt-probe message remained `pending` at attempt `0`;
- halt-probe claim was rejected with `stream_halted`.

This proves that an integrity failure halts the isolated stream without dispatching further work.

## Final state

| State | Count |
| --- | ---: |
| completed messages | 3 |
| error messages | 1 |
| pending messages | 1 |
| successor reservations | 0 |

Retained event types were exactly:

- `rollback-observed`;
- `retry-scheduled`;
- `terminal-halt`.

The rollback sentinel was absent, as required after the aborted transaction.

## Credential and active-profile boundaries

The verifier proved:

- missing verifier token rejected;
- wrong verifier purpose rejected;
- active source identity preserved;
- active watermark non-regressing;
- active watermark unchanged during the isolated run.

Active watermark before and after:

- ledger: `4,132,584`;
- hash: `33552E6118EEE7CB1C2366353733E1BDCD331432191365E5A1A0185FA4644B6B`;
- work ID unchanged;
- ledger advance caused by the fault verifier: `0`.

## Qualification effect

Together with the previously retained normal phase, committed-reader, multi-chunk, complete-state transfer, and post-restore continuation evidence, this closes the planned R4C2c remote behavioral qualification for:

- durable retry/backoff;
- exact stale-lease reclaim;
- duplicate terminal replay convergence;
- terminal fail-closed halt;
- transactional interruption rollback;
- active-profile isolation.

R4C2c completion does **not** select Supabase and does not authorize R5. Remaining qualification work moves to R4C2d and R4C2e:

- G7 sustained steady and catch-up throughput;
- G8 measured Free-plan resource headroom and fail-closed thresholds;
- G9 final operator-independence reconciliation;
- G1/G2 retained no-card and no-overage evidence reconciliation;
- final R4B evaluator revision and R4E selection or `no_profile_qualified`.

Public-reader cutover, Mainnet, controlled recovery, stabilization, and soak remain prohibited.

Machine-readable evidence is retained in [`r4c2c-supabase-remote-fault-evidence-2026-08-02.json`](r4c2c-supabase-remote-fault-evidence-2026-08-02.json).
