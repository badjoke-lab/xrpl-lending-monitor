# D1 current-state command interface

Last updated: 2026-07-03.

This document defines the non-public local command interface used for D1 current-state bootstrap, verification, measurement, activation, rollback, and cleanup.

It is an implementation and operations interface. It is not an HTTP route, public API, scheduled task, or automatic deployment action.

## Safety boundary

- `--local` is mandatory.
- Wrangler remote bindings are disabled by the runner.
- Bootstrap, verification, measurement, activation, rollback, and cleanup are distinct actions.
- Bootstrap never activates a snapshot.
- A fixed Devnet ledger index and 64-character ledger hash are required for bootstrap.
- A bootstrap run is bounded to at most 25 pages, 80 decoded objects per page, 60 seconds, and two retries.
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
  "objectLimitPerPage": 80,
  "maxRetries": 1
}
```

The command begins a new inactive snapshot or resumes the matching snapshot from its exact stored marker. A changed snapshot, epoch, ledger index, or ledger hash is rejected.

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
- index-adjusted projected bytes;
- the 350,000,000-byte safety threshold and pass or fail result;
- recorded duration.

The projection is a conservative pre-remote gate, not a claim about billed storage.

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
7. Run `measure` and confirm the resource gate.
8. Run `activate` only as a separate explicit action.
9. Validate current APIs and UI against the manifest.
10. Build and activate a second snapshot before testing `restore`.
11. Exercise cleanup only with a controlled failed or superseded attempt.

Remote migration and production bootstrap remain outside this interface until the D1-5 local evidence gate is complete and reviewed.
