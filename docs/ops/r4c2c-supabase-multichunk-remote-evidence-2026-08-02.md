# R4C2c Supabase standard-phase multi-chunk remote evidence — 2026-08-02

Status: the isolated Supabase multi-chunk qualification profile remotely completed one real Devnet Lending work through the standard portable `scan -> commit -> finalize` phase chain as three payload and commit chunks, and the qualification reader continued across three pages under one immutable committed work fence.

This closes retained true multi-chunk standard-phase and committed-reader continuation evidence for the isolated qualification profile. It does not complete complete-state transfer, post-restore continuation, remote fault injection, throughput, Free-plan resource qualification, profile selection, public-reader cutover, R5 recovery, Mainnet, stabilization, or soak.

## Workflow and artifact

GitHub Actions run `30747137075` completed successfully on main commit `3f1d8b43e0100edba61f3016cd67d3f162d48be0`.

Every guarded deployment and verification step passed, including active collector regression, active committed-reader regression, historical-witness regression, isolated multi-chunk execution, isolated multi-chunk reader verification, sanitized artifact upload, and Issue #1109 publication.

Artifact:

- name: `supabase-remote-probe-evidence`;
- artifact ID: `8833246709`;
- bytes: `11,824`;
- digest: `sha256:f60bac39d64172cbbd243810ded37b7fb80872a224dbac753f1536b11514ca5e`;
- retained multi-chunk evidence: `verified-multichunk-witness.json`.

Machine-readable repository evidence: [`r4c2c-supabase-multichunk-remote-evidence-2026-08-02.json`](r4c2c-supabase-multichunk-remote-evidence-2026-08-02.json).

## Exact deployed bundles

Multi-chunk executor:

- source: `supabase/functions/xrpl-multichunk-witness/index.ts`;
- bytes: `47,746`;
- SHA-256: `89a210f5e7de7550c256d7b6589640810c0951143852707f2482ce2276e9e9de`;
- unresolved relative imports: `0`;
- Cloudflare imports: `0`;
- `Deno.serve`: present.

Multi-chunk reader:

- source: `supabase/functions/xrpl-multichunk-witness-reader/index.ts`;
- bytes: `18,636`;
- SHA-256: `094df2fac70c76e66b487dffc5b8b3124f23004d4667acf1341c7cbdfbce7156`;
- unresolved relative imports: `0`;
- Cloudflare imports: `0`;
- `Deno.serve`: present.

The active collector, active reader, historical loader, and historical reader bundles also redeployed and passed their existing verifiers in the same run.

## Durable real-ledger source

Devnet had pruned historical ledger `2,776,760` before this run. The exact normalized source rows were therefore reconstructed from the already committed historical-witness set rather than fetched again from the external endpoint.

Durable source identity:

- historical set: `r4c2c-devnet-historical-witness-v1`;
- retained set digest: `bac80ec90ba841b683ee9e4b154cf385ffd972ce636f9797cb8f6cff1cdd209a`;
- target ledger: `2,776,760`;
- target ledger hash: `83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D`;
- parent hash: `E7E4E253C314D5EBD39E8C063415A99299E48FB23A0E613F1FE5CA534B0C0628`;
- source rows: `116`.

The deployed executor validates the exact committed set, digest, source ledger identity, canonical values, canonical relationship arrays, unique semantic identities, and exact per-class counts before calling the shared normalized payload builders.

## Isolated profile and work fence

- profile: `supabase-devnet-multichunk-witness`;
- source: `supabase-r4c2c-multichunk-witness`;
- network: `devnet`;
- epoch: `supabase-r4c2c-v1`;
- base identity: `multichunk-witness-2776760`;
- work ID: `collector-work-v1:devnet:supabase-r4c2c-v1:multichunk-witness-2776760:2776760:E7E4E253C314D5EBD39E8C063415A99299E48FB23A0E613F1FE5CA534B0C0628`;
- committed fence ledger: `2,776,760`;
- committed fence hash: `83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D`.

## Standard phase execution

Exact completed sequence:

1. `scan` — attempt `1`;
2. `commit:0` — attempt `1`, `40` rows;
3. `commit:1` — attempt `1`, `40` rows;
4. `commit:2` — attempt `1`, `36` rows;
5. `finalize` — attempt `1`.

Every completion returned `duplicate: false` on the first successful run.

The scan completion retained:

- total records: `116`;
- payload chunks: `3`;
- exact successor: commit chunk `0`.

Each commit completion reserved only the exact next chunk or finalize message. Finalize advanced only the isolated profile watermark and reserved the isolated next scan.

## Payload and commit parity

| Chunk | Payload rows | Commit operations | Row mutations |
| ---: | ---: | ---: | ---: |
| 0 | 40 | 40 | 40 |
| 1 | 40 | 40 | 40 |
| 2 | 36 | 36 | 36 |

Payload digest and committed chunk digest matched for every chunk:

- chunk `0`: `287018a700ee063aefd365e3c8b50da578bca634bfe0488e5220c1efec973a62`;
- chunk `1`: `0f0f7879c8b735eebbbc2010cc8243d3b212f1e5dd6965f1fabcc8c6cdb84a6b`;
- chunk `2`: `4efffab41d60289237c474838665e76915cd51288ed3caec66088fc9dd08e934`.

Committed semantic counts:

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

## Committed-reader continuation

The reader returned all `116` unique committed rows under the exact work fence with page sizes:

1. `40`;
2. `40`;
3. `36`.

The verifier passed:

- immutable-fence continuation;
- deterministic ordering;
- exact `loan-lifecycle` lookup;
- semantic-count parity;
- cursor digest tamper rejection;
- query/order mismatch rejection;
- cross-source cursor rejection;
- stale-fence rejection;
- missing-token rejection;
- wrong-purpose rejection;
- bounded maximum limit `100`.

## Active profile isolation

The active Supabase watermark was identical before and after isolated execution:

- profile: `supabase-devnet`;
- epoch: `supabase-r4c2c-v1`;
- ledger: `4,132,531`;
- ledger hash: `DEC3F9DA7D10322A63DA4FD864779C198344F20AD8F7D5F19527A30781F7E7BF`;
- work: `collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4132531:CD7122C3F2B9881291EF635B543276C685E82D987618353BD7035B32A9103EBC`.

The verifier recorded:

- ledger advance during isolated work: `0`;
- isolated work excluded from active watermark: `true`;
- active watermark non-regressing: `true`.

The public reader was not changed.

## Active collector regression

The same run reverified the active collector and active committed reader:

- completed ticks: `914`;
- consecutive failures: `0`;
- active watermark ledger: `4,132,531`;
- collector verifier: success on attempt `1`;
- reader verifier: success on attempt `1`.

The historical-witness verifier also passed again with `237` rows, all seven classes, `100/100/37` pages, and `16` relationship rows.

## What this closes

For the isolated qualification profile, retained remote evidence now proves:

- real retained Lending rows can enter the standard portable phase chain;
- one work can require and complete three payload chunks and three commit chunks;
- chunk order and successor reservation are exact;
- finalize occurs only after all chunks are committed;
- one committed work can continue across three reader pages under one immutable fence;
- payload, commit, semantic-count, exact lookup, and row-count parity hold;
- the isolated work cannot contaminate or regress the active watermark.

## Remaining R4C2c work

Still required:

- exact complete-state export of collection, scheduler, publication, and maintenance state;
- empty-target restore with canonical parity;
- post-restore continuation;
- remote interruption rollback;
- remote retry and backoff;
- stale-lease reclaim;
- duplicate phase replay;
- terminal injection and fail-closed halt.

G7 throughput, G8 sustained Free-plan resource qualification, and remaining G9 scripted operations remain blocked on those items.

## Decision

The Supabase profile remains `remote_verified_conditional_candidate`, `not_selected`, and unavailable for public-reader cutover or R5 recovery.

No Mainnet, public-reader, production-recovery, stabilization, or soak boundary changed.
