# D1 current-state command interface

Last updated: 2026-07-03.

This document defines the non-public local command interface used for D1 current-state bootstrap, verification, measurement, capacity gating, activation, rollback, and cleanup.

It is an implementation and operations interface. It is not an HTTP route, public API, scheduled task, or automatic deployment action.

## Safety boundary

- `--local` is mandatory.
- Wrangler remote bindings are disabled by the runner.
- Bootstrap, verification, measurement, capacity gating, activation, rollback, and cleanup are distinct actions.
- Bootstrap never activates a snapshot.
- A fixed Devnet ledger index and 64-character ledger hash are required for bootstrap.
- A bootstrap run is bounded to at most 25 RPC pages, 2,048 decoded ledger objects per page, 60 seconds, and two retries.
- Relevant Vault, Loan Broker, and Loan rows from one RPC page are persisted in D1 batches of at most 80 objects.
- The continuation marker advances only after the final D1 batch for the RPC page is durable.
- Capacity gating requires a verified manifest-backed snapshot.
- Evidence reports whether an opaque continuation marker exists but never emits the marker value.
- Evidence must not contain credentials, private endpoints, provider account identifiers, or secrets.
- Mainnet remains disabled.

## Build and run

The standard application build also validates the Node-targeted D1 command bundle.

```bash
pnpm build
```

Run one explicit action with a JSON input file:

```bash
pnpm d1:tools -- \
  --local \
  --input ./local-input.json \
  --persist ./.wrangler/d1-tools \
  --output ./artifacts/d1-result.json
```

Optional arguments:

- `--config`: Wrangler configuration path. Defaults to `wrangler.d1-test.jsonc`.
- `--persist`: local workerd persistence directory. Defaults to `.wrangler/d1-tools`.
- `--output`: writes the same public-safe JSON evidence printed to stdout.

The persistence directory must be reused when successive actions operate on the same local D1 database.

## Actions

### Status

```json
{
  "action": "status",
  "snapshotId": "local-devnet-001"
}
```

Returns snapshot state, fixed ledger identity, batch progress, scan completion, marker presence, accumulated scan metrics, manifest metadata, and active or rollback-pointer membership.

### Bootstrap or resume

```json
{
  "action": "bootstrap",
  "identity": {
    "snapshotId": "local-devnet-001",
    "epochId": "epoch-local-001",
    "endpoint": "https://s.devnet.rippletest.net:51234",
    "ledgerIndex": 0,
    "ledgerHash": "REPLACE_WITH_64_HEX_CHARACTERS"
  },
  "timeoutMs": 30000,
  "maxPagesPerRun": 25,
  "objectLimitPerPage": 2048,
  "maxRetries": 1
}
```

The command begins a new inactive snapshot or resumes the matching snapshot from its exact stored marker. A changed snapshot, epoch, ledger index, or ledger hash is rejected.

Each RPC page may decode up to 2,048 ledger objects. Only relevant lending objects are normalized, and those relevant rows are split into D1 write batches of at most 80 objects. Intermediate write batches do not advance the stored continuation marker.

A terminal scan returns `complete`, not `verified` or `active`.

### Verify

```json
{
  "action": "verify",
  "snapshotId": "local-devnet-001"
}
```

Verification requires a complete scan. It recomputes batch, object, count, manifest, and same-snapshot relationship evidence. It does not activate the snapshot.

### Measure

```json
{
  "action": "measure",
  "snapshotId": "local-devnet-001"
}
```

The measurement report includes:

- pages and requests;
- decoded and relevant object counts;
- Vault, Loan Broker, and Loan rows;
- raw, projection, normalized, and logical bytes;
- maximum row and batch size;
- estimated written rows and measurement queries;
- recorded duration.

Measurement describes the selected snapshot. It does not replace the retained-snapshot capacity gate.

### Capacity gate

```json
{
  "action": "capacity",
  "snapshotId": "local-devnet-001",
  "historyReserveBytes": 50000000,
  "retainedSnapshots": 2,
  "includedSnapshots": 1,
  "enforce": true
}
```

Capacity gating requires a verified snapshot and reports:

- current local D1 size from D1 query metadata;
- verified snapshot normalized bytes and manifest bytes;
- object and batch row counts;
- maximum row, object batch, and normalized batch sizes;
- one additional retained-snapshot estimate including row and index overhead;
- explicit history reserve;
- projected total database bytes;
- headroom below the 350,000,000-byte bootstrap stop threshold and the project database budget;
- acceptance state and all rejection reasons.

`retainedSnapshots` defaults to `2`. `includedSnapshots` defaults to `1` because the measured snapshot is already present in the current database. Set `includedSnapshots` to `2` only after both intended retained snapshots are already stored in that same local database.

`enforce` defaults to `true`. A rejected report is still printed and written to `--output`, then the command exits with status `2`. Set `enforce` to `false` only for diagnostic measurement; it does not authorize remote work.

### Activate

```json
{
  "action": "activate",
  "snapshotId": "local-devnet-001"
}
```

Only a verified manifest-backed snapshot can activate. Activation updates the D1 active pointer separately and retains the prior same-epoch active snapshot as rollback.

### Restore previous snapshot

```json
{
  "action": "restore"
}
```

Restore requires a verified manifest-backed rollback snapshot in the active epoch and aligned `sync_state`.

### Mark cleanup eligibility

```json
{
  "action": "mark_cleanup",
  "snapshotId": "local-devnet-failed-001",
  "eligibleAt": "2026-07-04T00:00:00.000Z",
  "reason": "failed local bootstrap attempt"
}
```

Only failed or superseded snapshots may become eligible. Active, rollback, and resumable attempts remain protected.

### Remove eligible attempt

```json
{
  "action": "remove_cleanup",
  "snapshotId": "local-devnet-failed-001",
  "removeAt": "2026-07-05T00:00:00.000Z"
}
```

Removal succeeds only after the eligibility time and only while all pointer and checkpoint protections still pass.

## Required local sequence

1. Apply all local migrations.
2. Create or identify the local current epoch and `sync_state` row.
3. Fix one validated Devnet ledger index and hash.
4. Repeat `bootstrap` until `scanComplete` is true.
5. Run `status`.
6. Run `verify`.
7. Run `measure`.
8. Run `capacity` with an explicit history reserve and confirm `accepted: true`.
9. Run `activate` only as a separate explicit action.
10. Validate current APIs and UI against the manifest.
11. Build and verify a second snapshot, then rerun `capacity` with `includedSnapshots: 2`.
12. Activate the second snapshot before testing `restore`.
13. Exercise cleanup only with a controlled failed or superseded attempt.

Remote migration and production bootstrap remain outside this interface until the D1-5 local evidence gate is complete and reviewed.
