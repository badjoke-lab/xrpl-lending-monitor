# R4C2c Supabase historical witness remote evidence — 2026-08-02

Status: the isolated Supabase historical-witness profile was deployed from the exact main commit, atomically retained the fixed three-ledger real Devnet witness set, and passed committed-only reader verification across all seven semantic classes and a non-empty Loan relationship query. This closes the retained non-empty seven-class and relationship reader evidence for the isolated qualification profile only. It does not prove the active stream's true multi-chunk continuation, complete-state transfer, remote fault qualification, throughput, resource envelope, profile selection, public-reader cutover, R5 recovery, Mainnet, stabilization, or soak.

## Workflow evidence

GitHub Actions workflow run `30742455945` completed successfully on main commit `11c0c472aedb7cc58248d9b83f429aa3f26cdf8f`.

Every deployment and verification step passed:

- required Secret bindings;
- Supabase CLI setup;
- exact four-function bundle generation;
- exact project linking;
- one-run verifier-token rotation and masking;
- pending migration application;
- active Devnet phase-executor deployment;
- active qualification-only committed-reader deployment;
- isolated historical-witness loader deployment;
- isolated historical-witness reader deployment;
- active remote phase-chain verification;
- active immutable committed-reader verification;
- isolated historical persistence and reader verification;
- sanitized evidence upload;
- Issue #1109 run-locator publication.

Artifact:

- name: `supabase-remote-probe-evidence`;
- artifact ID: `8831750466`;
- bytes: `8,857`;
- digest: `sha256:374588770f45b433ee6303ce4070e2d6600b4b676023eda5effb4df565ea2a63`;
- retained files: `bundle.json`, `reader-bundle.json`, `historical-loader-bundle.json`, `historical-reader-bundle.json`, `verified-health.json`, `verified-reader.json`, and `verified-historical-witness.json`.

Machine-readable retained evidence: [`r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.json`](r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.json).

## Exact bundle identities

Active collector:

- source: `supabase/functions/xrpl-collector-tick/index.ts`;
- bytes: `103,351`;
- SHA-256: `e7e4b58f5a841c3f5dd85cc024235f8f33b0db8a49d4956c00b056a4385139f8`;
- unresolved relative imports: `0`;
- Cloudflare runtime imports: `0`;
- `Deno.serve`: present.

Active committed reader:

- source: `supabase/functions/xrpl-committed-reader/index.ts`;
- bytes: `17,636`;
- SHA-256: `cd58239dc91cfe61828216e7de3e0e711984b6d2c62295dad45bf083e7f04d03`;
- unresolved relative imports: `0`;
- Cloudflare runtime imports: `0`;
- `Deno.serve`: present.

Historical loader:

- source: `supabase/functions/xrpl-historical-witness/index.ts`;
- bytes: `83,636`;
- SHA-256: `a75045dff21c2a34fd9604d9a3958b9a4da819de9ce585417d77904d5239b09f`;
- unresolved relative imports: `0`;
- Cloudflare runtime imports: `0`;
- `Deno.serve`: present.

Historical reader:

- source: `supabase/functions/xrpl-historical-witness-reader/index.ts`;
- bytes: `18,923`;
- SHA-256: `027454f6299e96b6ded2cd23e6b2dbda9b9c9dee7de00925ddac732a2db20dbd`;
- unresolved relative imports: `0`;
- Cloudflare runtime imports: `0`;
- `Deno.serve`: present.

The workflow generated a fresh 32-byte verifier token, registered it with Actions masking, replaced the Supabase project secret, and passed it only to the verification steps. The token value was not retained in the artifact, Issue comment, repository, or evidence files.

## Isolated profile identity and atomic persistence

- profile: `supabase-devnet-historical-witness`;
- source ID: `supabase-r4c2c-historical-witness`;
- purpose: `r4c2c-historical-witness-remote-verification`;
- network: `devnet`;
- epoch: `supabase-r4c2c-historical-witness-v1`;
- base identity: `historical-witness-2776760-2980845-3127240`;
- set ID: `r4c2c-devnet-historical-witness-v1`;
- work ID: `historical-witness-work-v1:2776760:2980845:3127240`;
- ledger set: `2,776,760`, `2,980,845`, and `3,127,240`;
- fence ledger: `3,127,240`;
- fence hash: `6CDB77504546BE14D226CFFDFC61082EC73BF95191E5326536254903D87692B3`;
- canonical records digest: `sha256:bac80ec90ba841b683ee9e4b154cf385ffd972ce636f9797cb8f6cff1cdd209a`.

The first commit returned `duplicate: false`. Repeating the exact loader input returned `duplicate: true`. This proves exact duplicate convergence for the isolated set while conflicting identity or content remains fail-closed by the commit contract.

The isolated tables and RPCs do not insert into the active `xrpl_phase_streams`, advance the active `xrpl_phase_watermarks`, change the active collector epoch, or alter the public application reader.

## Seven-class remote reader proof

The historical verifier completed at `2026-08-02T09:48:19.019Z`.

It read all `237` committed rows under one immutable fence with page sizes:

1. `100`;
2. `100`;
3. `37`.

All `237` row identities were unique.

Exact semantic counts:

| Semantic class | Rows |
| --- | ---: |
| `validated-ledger` | 3 |
| `protocol-event` | 13 |
| `object-change` | 197 |
| `loan-lifecycle` | 3 |
| `archived-object` | 1 |
| `balance-history` | 2 |
| `current-projection` | 18 |
| **Total** | **237** |

The verifier performed an exact lookup for at least one retained row in every semantic class and matched the expected source ledger and canonical key.

## Relationship evidence

Relationship ID:

`loan:FBD9559FBC50D3274AAD6495454E83E0FDB97DCE497D0423C1666641B2288718`

The relationship query returned `16` committed rows spanning:

- `object-change`;
- `loan-lifecycle`;
- `archived-object`;
- `current-projection`.

This proves that the normalized relationship IDs survive atomic persistence and are queryable across lifecycle, archive, projection, and object-change records under one committed fence.

## Cursor, source, purpose, and credential rejection

Passed fail-closed checks:

- cursor digest tamper rejected;
- query/order mismatch rejected;
- cross-source cursor rejected;
- stale-fence cursor rejected;
- missing verifier token rejected;
- wrong verification purpose rejected.

The reader also retained deterministic ordering, source/query/order/fence-bound cursor continuation, bounded pages of at most `100`, and exact semantic-count parity.

## Active collector regression state

The same workflow independently reverified the active `supabase-devnet` collector and committed reader.

At `2026-08-02T09:47:56.573Z`:

- completed ticks: `774`;
- consecutive failures: `0`;
- last error: `null`;
- latest five `pg_cron` runs: completed;
- active watermark ledger: `4,132,485`;
- active watermark hash: `5C3C23C7A175CC3948B21C9B02794F0897DA2540988334B3ABBA3ED2120F9E64`;
- active watermark work: `collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4132485:35E46F77D9DBF41F8B2BD97C2D72985805588D39947535D2B9E4D6FF6A5DB24B`;
- latest successor: `scan / pending / attempt 0`.

The active reader passed again at `2026-08-02T09:48:02.246Z` against that exact active fence. The historical fence remained separate at ledger `3,127,240`.

## What this proves

This evidence remotely proves for the isolated qualification profile that:

- a fixed real Devnet witness can be atomically persisted as one canonical set;
- exact replay converges without duplicating rows;
- all seven semantic classes are non-empty and readable;
- exact lookup and semantic-count parity hold for every class;
- pagination continues deterministically across three pages under one immutable fence;
- relationship IDs survive persistence and return a non-empty cross-class Loan relationship;
- tampered, cross-query/order, cross-source, stale-fence, missing-token, and wrong-purpose requests fail closed;
- the isolated qualification work does not disturb the active stream or public reader;
- the active collector and active reader retain their prior successful behavior after deployment.

## What remains incomplete

R4C2c remains active. Required evidence still includes:

- true multi-chunk remote phase execution in the active collector;
- true multi-chunk committed-reader continuation bound to one active work item;
- exact collection, scheduler, publication, and maintenance export;
- empty-target restore with canonical parity;
- post-restore continuation;
- remote interruption rollback;
- remote retry and backoff;
- stale-lease reclaim;
- duplicate phase replay;
- terminal-injection and fail-closed halt evidence.

G7 throughput, G8 sustained Free-plan resource/quota qualification, and the remaining G9 scripted operations remain blocked on completion of those R4C2c items.

## Current decision

The Supabase profile remains `remote_verified_conditional_candidate`, `not_selected`, and ineligible for public-reader cutover or R5 recovery.

No Mainnet, public-reader, production-recovery, stabilization, or soak boundary changes are authorized.
