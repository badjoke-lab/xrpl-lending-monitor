# R4C2c Supabase seven-class remote deployment evidence — 2026-08-02

Status: the seven-class remote executor was deployed and its schema-3 verifier passed on the cardless Supabase Free Devnet profile. This evidence does **not** complete R4C2c reader/transfer parity, prove non-empty remote observations for all seven semantic classes, select the profile, switch the public reader, start R5 recovery, enable Mainnet, or authorize soak.

## Deployment evidence

GitHub Actions workflow run `30735822415` completed successfully on main commit `fa275a6372cd8d9ee3a486b5e65b530ffc421eb1`.

Every deployment and verification step passed:

- required GitHub Secret bindings;
- Supabase CLI setup;
- exact Edge bundle generation;
- exact project linking;
- pending migration application;
- exact Devnet executor deployment;
- repeated remote portable phase execution verification;
- sanitized artifact upload;
- retained Issue #1109 run locator publication.

Artifact:

- name: `supabase-remote-probe-evidence`;
- artifact ID: `8829549604`;
- digest: `sha256:4f5b7bc6baed555e8d8857bd2cdf328486fbe85d35f06b55cb0fdd9277341296`;
- verifier evidence schema: `3`;
- verification timestamp: `2026-08-02T06:26:09.963Z`;
- verifier attempt: `10`.

Machine-readable retained evidence: [`r4c2c-supabase-seven-class-remote-evidence-2026-08-02.json`](r4c2c-supabase-seven-class-remote-evidence-2026-08-02.json).

## Portable Edge bundle

The exact checked-out executor was bundled before deployment.

- source: `supabase/functions/xrpl-collector-tick/index.ts`;
- bundle bytes: `103,351`;
- bundle SHA-256: `e7e4b58f5a841c3f5dd85cc024235f8f33b0db8a49d4956c00b056a4385139f8`;
- unresolved relative imports: `0`;
- Cloudflare runtime imports: `0`;
- `Deno.serve` entrypoint: present.

This closes the two deployment failures caused first by extensionless relative imports and then by the Supabase graph reaching `cloudflare:sockets`.

## Stream identity

- profile: `supabase-devnet`;
- network: `devnet`;
- phase epoch: `supabase-r4c2c-v1`;
- immutable base ledger: `4,132,417`;
- immutable base hash: `C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77`;
- base identity: `seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77`;
- stream status: `active`;
- terminal error classification: `null`;
- terminal error message: `null`.

The R4C2b message at the transition boundary was retained as `superseded_epoch`; it was not silently reused under the new epoch.

## Latest committed chain

The retained R4C2c work covers ledger `4,132,418`.

- previous ledger: `4,132,417`;
- expected parent hash: `C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77`;
- final ledger hash: `F19EAD766B2B052513A08A0131F40B41E77C6DA273CE9C775ECC380E2FB02072`;
- work status: `committed`;
- payload digest: `ec90ebc68b8f96a8c95edca434215db96c2dc2cd6e5a3e35cae0a00dc12e721a`;
- expected payload chunks: `1`;
- expected commit chunks: `1`;
- committed at: `2026-08-02T06:26:00.901Z`.

The exact retained sequence is:

1. scan completed with status `staged`;
2. scan reserved the deterministic commit message;
3. commit completed with one operation and one row mutation;
4. commit reserved the deterministic finalize message;
5. finalize completed with status `committed`;
6. finalize advanced the committed watermark;
7. finalize reserved the deterministic next scan;
8. the next scan remained `pending` with attempt count `0` at the evidence fence.

The commit and finalize messages each completed at attempt `1`. The scan message completed at attempt `241` after remaining pending across the deployment/epoch-transition interval. That count is retained as transition evidence and must not be represented as normal clean-retry qualification.

## Seven-class envelope and actual remote observations

The deployed executor and verifier use the complete seven-class semantic envelope:

- `validated-ledger`;
- `protocol-event`;
- `object-change`;
- `loan-lifecycle`;
- `archived-object`;
- `balance-history`;
- `current-projection`.

The verifier passed ordered commit, committed-only visibility, semantic-count parity, and successor-continuation checks for that envelope.

However, the retained Devnet ledger contained no Lending transaction. Actual committed counts were:

- validated-ledger: `1`;
- protocol-event: `0`;
- object-change: `0`;
- loan-lifecycle: `0`;
- archived-object: `0`;
- balance-history: `0`;
- current-projection: `0`.

Therefore this run proves deployment of the seven-class implementation and parity for zero-valued classes, but it does not prove non-empty remote persistence or identity/relationship preservation for the other six classes.

The committed-only view exposed one row:

- semantic class: `validated-ledger`;
- canonical key: `ledger:4132418`;
- source ledger index: `4,132,418`;
- source ledger hash: `F19EAD766B2B052513A08A0131F40B41E77C6DA273CE9C775ECC380E2FB02072`;
- tombstone: `false`.

No staged row was accepted as verification evidence.

## Runtime and transition observations

At the evidence fence:

- completed tick count: `573`;
- consecutive failures: `0`;
- last error: `null`;
- latest observed Devnet ledger: `4,138,592`;
- latest observed Devnet ledger hash: `5764D8667D346CAA5CBC16001FD695DC374C36EE1A4C879C5EAA5C9242D0B07F`;
- latest three retained Cron runs: completed;
- two immediately earlier retained Cron runs: failed with `base_mismatch: scan message scope is not R4C2b Devnet`.

The later successful runs and schema-3 verifier show that the narrow activation recovery reached the R4C2c epoch. The two transition failures remain retained evidence and prevent describing the transition as failure-free.

The runtime status was `stopped` because the short transactional tick lease is released after each Cron execution. The pending successor and repeated Cron history show that `pg_cron`, not GitHub Actions, remained the runtime clock.

## What this proves

This evidence proves remotely that:

- the exact seven-class executor bundle can be produced without relative or Cloudflare runtime imports;
- the bundle can be deployed to the cardless Supabase Free Devnet profile;
- the R4C2c epoch preserves exact stream and immutable-base identity;
- ordered scan, commit, finalize, watermark, and successor boundaries execute remotely;
- the seven-class count envelope is persisted and verified;
- committed-only visibility and semantic-count parity hold for the retained work;
- the prior epoch is explicitly superseded rather than silently mixed;
- unattended one-minute `pg_cron` execution resumes after the transition.

## What remains incomplete

R4C2c remains active. Required evidence still includes:

- non-empty real Devnet evidence for protocol events;
- non-empty real Devnet evidence for object changes;
- non-empty real Devnet evidence for loan lifecycle events;
- non-empty real Devnet evidence for archived objects;
- non-empty real Devnet evidence for balance history;
- non-empty real Devnet evidence for current projections;
- class-complete identity and relationship preservation;
- true multi-chunk remote work rather than a one-chunk empty semantic ledger;
- immutable Supabase reader fences;
- source/query/order-bound cursor parity;
- exact collection, scheduler, publication, and maintenance export;
- empty-target restore with canonical parity;
- post-restore continuation;
- remote interruption, retry, stale-reclaim, duplicate, and terminal-injection qualification.

G7 throughput and G8 sustained resource/quota qualification remain R4C2d work and must not start from a claim that R4C2c is complete.

## Current decision

The Supabase profile remains `remote_verified_conditional_candidate`, `not_selected`, and ineligible for public cutover or R5 recovery.

The next unit is the remaining R4C2c reader/transfer and non-empty semantic evidence work. No Mainnet, public-reader, recovery, stabilization, or soak boundary changes are authorized.
