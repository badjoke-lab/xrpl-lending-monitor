# R4F G4 bounded revision-4 memory replay

Date: 2026-08-06
Issue: #1261
Authorization comment: `5401115525`
Status before the run: G4 unresolved

## Why a new replay is required

The retained steady-memory fixture cannot qualify revision 4. It belongs to revision 3, uses the old 200 MiB halt, and records RSS as zero for all 36 samples. The exact production memory-halt and its twelve-ledger retry establish the historical workload shape, but the peak RSS values needed for strict revision-4 headroom were not retained.

No historical peak is inferred by this work.

## Bounded source shape

The one-shot runner captures public XRPL Devnet ledgers `4,138,468` through `4,138,491`. This range contains the exact twelve-ledger retry shape at `4,138,468` through `4,138,479` and twelve additional adjacent ledgers for the heavier retained sample.

Capture constraints:

- public Devnet reads only;
- 24 exact ledgers;
- two concurrent reads;
- one MiB response bound per ledger;
- no transaction submission;
- no database access or mutation;
- no Supabase, Cloudflare, or Mainnet credentials.

## Offline replay shapes

After capture, both replay processes run without network permission.

1. `exact_12_ledger_halt_shape`
   - claims and processes 12 ledgers;
   - retains exactly those 12 source ledgers.

2. `heavier_retained_sample`
   - keeps the claim and processing cap at 12 ledgers;
   - retains all 24 captured ledgers while normalizing the first 12.

Both processes execute the same read-parse, continuity, portable normalization, chunk/reference-row construction, canonical work serialization, and pre-commit retention shape used by the recovery executor. Process RSS is sampled at request start, after claim construction, after source-manifest validation, after source retention, after normalization, and before the simulated commit boundary.

## Fixed safety boundaries

- memory hard limit: 256 MiB;
- project memory halt: 224 MiB (`234881024` bytes);
- selected maximum ledgers per claim: 12;
- strict qualification comparison: peak RSS must be lower than the halt;
- production credentials: none;
- production mutation: none;
- retained R5 recovery mutation: none;
- public reader: unchanged;
- Mainnet: disabled;
- stabilization and soak: unauthorized.

## Execution and retention

The one-shot job is embedded in the existing CI workflow rather than adding a tenth workflow. It runs only on a main push that introduces the exact pinned marker, verifies the commit author, captures public Devnet source data, runs two separate network-disabled Deno replay processes, assembles the revision-4 evidence, and invokes the fail-closed verifier with `--require-proof-ready`.

The run uploads the source capture, replay outputs, assembled evidence, and verifier result for 14 days, then posts a sanitized measurement summary and artifact digest to Issue #1261.

If the source range is unavailable, RSS is zero, either peak reaches 224 MiB, the claim cap changes, the two source manifests differ, or the final verifier rejects the evidence, the job fails and G4 remains unresolved.
