# R4C2c Supabase complete-state transfer remote evidence — 2026-08-02

Status: **remote export and empty-target typed restore verified; post-restore continuation not yet proved**.

## Run identity

- workflow run: `30750389833`;
- main commit: `e200cab40e373d082791c010a5b9e8bc9f989835`;
- artifact: `8834256849`;
- artifact digest: `sha256:ad809b7834ef9ee5f204f92186260e83f65537e29d4835d95f78751346eaac3f`;
- verified at: `2026-08-02T13:40:33.276Z`.

The run first reverified the active executor and reader, the durable historical witness, and the isolated standard multi-chunk work. It then deployed and invoked the token-gated complete-state transfer verifier.

## Exact transfer identity

- source profile: `supabase-devnet-multichunk-witness`;
- export ID: `r4c2c-multichunk-complete-state-v1`;
- restore target: `supabase-devnet-transfer-restore-v1`;
- typed namespace: `xrpl_restore_v1`;
- canonical state digest: `fb9b7dda66802f18c18200b2991ff6293cd5b11b3dd04a91d5089524ea93dda2`;
- canonical state size: `300,890` bytes.

## Exact restored state

| Section | Table class | Rows |
| --- | --- | ---: |
| collection | streams | 1 |
| collection | work | 1 |
| collection | payload chunks | 3 |
| collection | reference rows | 116 |
| collection | commit chunks | 3 |
| collection | watermarks | 1 |
| scheduler | messages | 6 |
| scheduler | successors | 5 |
| publication | candidates | 1 |
| publication | work membership | 1 |
| publication | watermarks | 1 |
| maintenance | plans | 1 |
| maintenance | mutations | 2 |

Scheduler state was exactly five `completed` messages and one `pending` successor scan.

## Verified properties

- collection, scheduler, publication, and maintenance sections were all included;
- restore began against the dedicated empty typed target;
- rebuilt target canonical text matched the exported canonical text exactly;
- independently computed source and target SHA-256 digests matched;
- exact repeated restore converged with `duplicate: true`;
- a digest-tampered restore was rejected;
- a missing verifier token was rejected;
- a wrong verifier purpose was rejected;
- the active `supabase-devnet` watermark remained source-identical and non-regressing;
- no isolated transfer identity entered the active profile.

The active watermark before and after the transfer remained ledger `4,132,562`, hash `B53EB71938E6A696798E324B4896C49F28849DD2EF22B0F7E4B664C9B686AE68`, under the same work and active base identity.

## Corrected remote defect

The first connected remote run, `30750155887`, reached the transfer verifier but failed because both canonical builders ordered the scheduler successor table by nonexistent column `next_message_id`. The durable scheduler schema uses `successor_message_id`.

PR #1130 added a forward-only corrective migration, redefined both source and restored canonical builders against the deployed schema, and retained a contract test forbidding the invalid column. Run `30750389833` then passed the complete transfer verifier.

## Qualification boundary

This evidence closes the remote export, empty-target restore, canonical parity, duplicate convergence, digest-tamper rejection, credential rejection, and active-isolation portions of G6.

It does **not** prove post-restore collection continuation. The restored namespace retains one pending scan, but the next unit must execute controlled work from that restored pending message and prove the restored watermark advances without source or active-profile mutation.

It also does not prove remote interruption rollback, retry/backoff, stale-lease reclaim, duplicate phase replay, terminal halt, throughput, Free-plan resource headroom, profile selection, public-reader cutover, R5 recovery, Mainnet, stabilization, or soak.

Machine-readable evidence is retained in [`r4c2c-supabase-complete-state-transfer-remote-evidence-2026-08-02.json`](r4c2c-supabase-complete-state-transfer-remote-evidence-2026-08-02.json).
