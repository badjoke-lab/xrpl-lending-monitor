# R4C2c Supabase committed reader remote evidence — 2026-08-02

Status: the qualification-only Supabase committed reader was deployed from the exact main commit and its remote immutable-fence and cursor verifier passed. This closes the retained `validated-ledger` committed-reader proof only. It does not complete R4C2c, select the profile, switch the public reader, start R5 recovery, enable Mainnet, or authorize stabilization or soak.

## Workflow evidence

GitHub Actions workflow run `30737493360` completed successfully on main commit `5b3a1843743c3cada0061ea51f00d5612651490a`.

Every deployment and verification step passed:

- required Secret bindings;
- Supabase CLI setup;
- exact collector and reader bundle generation;
- exact project linking;
- one-run committed-reader verifier-token rotation and masking;
- pending migration application;
- exact collector deployment;
- exact qualification-only reader deployment;
- remote collector phase-chain verification;
- remote immutable committed-reader verification;
- sanitized evidence upload;
- Issue #1109 run-locator publication.

Artifact:

- name: `supabase-remote-probe-evidence`;
- artifact ID: `8830107824`;
- bytes: `6,704`;
- digest: `sha256:7180041f65a341bc6b7d7f462af782c506b03d212fb872399b3ac542ebcd5ddf`;
- retained files: `bundle.json`, `reader-bundle.json`, `verified-health.json`, and `verified-reader.json`.

Machine-readable retained evidence: [`r4c2c-supabase-committed-reader-evidence-2026-08-02.json`](r4c2c-supabase-committed-reader-evidence-2026-08-02.json).

## Exact bundle identities

Collector:

- source: `supabase/functions/xrpl-collector-tick/index.ts`;
- bytes: `103,351`;
- SHA-256: `e7e4b58f5a841c3f5dd85cc024235f8f33b0db8a49d4956c00b056a4385139f8`;
- unresolved relative imports: `0`;
- Cloudflare runtime imports: `0`;
- `Deno.serve`: present.

Committed reader:

- source: `supabase/functions/xrpl-committed-reader/index.ts`;
- bytes: `17,636`;
- SHA-256: `cd58239dc91cfe61828216e7de3e0e711984b6d2c62295dad45bf083e7f04d03`;
- unresolved relative imports: `0`;
- Cloudflare runtime imports: `0`;
- `Deno.serve`: present.

The workflow generated a fresh 32-byte verifier token, registered it with Actions masking, replaced the Supabase project secret, and passed it only to the verifier. The token value was not retained in the artifact, Issue comment, repository, or evidence files.

## Source and immutable fence

- source ID: `supabase-r4c2c-qualification`;
- mode: `portable`;
- purpose: `r4-qualification-only`;
- profile: `supabase-devnet`;
- network: `devnet`;
- epoch: `supabase-r4c2c-v1`;
- base identity: `seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77`;
- fence ledger: `4,132,435`;
- fence hash: `CB19F0E00E3314DA18D4C17AFFEDF1C7F120D46FAC6634DDCFC81A259011CBB6`;
- fence work: `collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4132435:6029F4EEB9DAE4535A8DF02FA19D5DC5EEF8E0F96366ED67CF6F32D6ADFE5977`.

The collector verifier and reader verifier independently retained the same ledger, hash, and work identity.

## Remote reader proof

The verifier completed on attempt `1` at `2026-08-02T07:17:17.397Z`.

It read two consecutive committed `validated-ledger` rows under one immutable fence:

1. `ledger:4132418`
   - ledger hash: `F19EAD766B2B052513A08A0131F40B41E77C6DA273CE9C775ECC380E2FB02072`;
2. `ledger:4132419`
   - ledger hash: `F30F1A922A3EF374D1E99F76CCF6285C046EF8E3A39A101B5359CE97B3C723FC`.

Passed checks:

- immutable-fence cursor continuation;
- deterministic ordering;
- exact lookup parity;
- ledger-range parity;
- cursor digest-tamper rejection;
- query/order mismatch rejection;
- cross-source rejection using a correctly re-digested cursor;
- stale-fence rejection using a correctly re-digested cursor;
- bounded maximum page limit of `100`.

Rejection statuses were:

- digest tamper: HTTP `400`;
- query/order mismatch: HTTP `400`;
- source mismatch: HTTP `400`;
- stale fence: HTTP `409`.

This proves that a cursor cannot silently continue against another source, another query/order, a modified payload, or an advanced committed fence.

## Collector state at the reader fence

The collector verifier also passed on attempt `1` at `2026-08-02T07:17:14.085Z`.

- completed ticks: `624`;
- consecutive failures: `0`;
- last error: `null`;
- latest five retained Cron runs: completed;
- committed watermark: ledger `4,132,435` / hash `CB19F0E00E3314DA18D4C17AFFEDF1C7F120D46FAC6634DDCFC81A259011CBB6`;
- latest successor: `scan / pending / attempt 0`.

The latest committed work contained one `validated-ledger` record and zero records in the other six semantic classes.

## What this proves

This evidence remotely proves for the retained `validated-ledger` data that:

- the exact qualification-only reader bundle can be deployed without Cloudflare runtime leakage;
- access is guarded by a masked, rotated one-run verifier credential and qualification-purpose boundary;
- the service-role RPC exposes one exact committed stream/watermark/work fence;
- pagination continues under the same immutable fence;
- exact and range queries agree with the paginated row;
- ordering is deterministic;
- malformed, tampered, cross-source, cross-query/order, and stale cursors fail closed;
- the reader fence agrees with the collector's committed watermark;
- no public application reader change is required to obtain qualification evidence.

## What remains incomplete

R4C2c remains active. Required evidence still includes:

- non-empty remote reader evidence for protocol events;
- non-empty remote reader evidence for object changes;
- non-empty remote reader evidence for loan lifecycle events;
- non-empty remote reader evidence for archived objects;
- non-empty remote reader evidence for balance history;
- non-empty remote reader evidence for current projections;
- non-empty relationship-query evidence;
- class-complete identity and relationship preservation;
- true multi-chunk remote work and reader continuation;
- exact collection, scheduler, publication, and maintenance export;
- empty-target restore with canonical parity;
- post-restore continuation;
- remote interruption, retry, stale-lease, duplicate, and terminal-injection qualification.

G7 throughput and G8 sustained resource/quota qualification remain blocked on completion of the remaining R4C2c work.

## Current decision

The Supabase profile remains `remote_verified_conditional_candidate`, `not_selected`, and ineligible for public-reader cutover or R5 recovery.

No Mainnet, public-reader, production-recovery, stabilization, or soak boundary changes are authorized.
