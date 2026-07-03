# Local current-state artifact measurement

This command builds and measures the compressed current-state artifact format against one fixed Devnet ledger.

It writes only to a local directory. The directory contains:

- `run.json` — the fixed ledger and snapshot identity;
- `artifacts/` — immutable compressed data, index, page-manifest, and snapshot-manifest files;
- `checkpoints/` — the resumable scan checkpoint;
- `evidence.json` — capacity and runtime evidence for the latest invocation.

## Bounded sample

```bash
pnpm artifact:measure -- \
  --local \
  --root .local/current-state-measurement \
  --page-budget 500
```

When `run.json` does not exist, the command resolves one validated Devnet ledger and stores that fixed identity before scanning.

Running the same command again with the same root resumes from the last durable page manifest. The checkpoint marker advances only after all data shards, index shards, and the page manifest for that page pass digest and size verification.

## Complete traversal

Omit `--page-budget` to continue until the fixed ledger is complete:

```bash
pnpm artifact:measure -- \
  --local \
  --root .local/current-state-measurement
```

A completed run also verifies every page manifest and writes the snapshot-level `manifest.json`.

## Explicit ledger identity

A known validated ledger can be supplied explicitly. Both fields are required together:

```bash
pnpm artifact:measure -- \
  --local \
  --root .local/current-state-measurement \
  --ledger-index 123456 \
  --ledger-hash ABCDEF...64_HEX_CHARACTERS
```

Once `run.json` exists, it remains the authority for that root. Use a different root for a different ledger or snapshot.

## Evidence fields

The evidence report includes:

- decoded and relevant object counts;
- data and secondary-index shard counts;
- compressed and uncompressed data and index bytes;
- page-manifest and snapshot-manifest bytes;
- total stored bytes and largest artifact;
- compression ratio and compressed index share;
- page progress, cumulative scan time, invocation wall time, and maximum observed heap use.

The manual GitHub Actions workflow defaults to a 500-page bounded sample. A complete traversal requires selecting `full_run` explicitly.
