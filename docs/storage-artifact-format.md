# Current-state artifact format

The current-state prototype stores one fixed Devnet ledger as deterministic compressed artifacts before any production adapter is selected.

Each artifact is scoped by network, epoch, and snapshot:

```text
current-state/devnet/<epoch-id>/<snapshot-id>/
  data/<kind>/<page>-<chunk>.ndjson.gz
  manifest.json
```

`kind` is `vault`, `loan-broker`, or `loan`.

Records are canonical JSON lines sorted by object ID. Each record includes snapshot identity, object kind, object ID, the SHA-256 digest of the canonical object, and the retained ledger object.

A shard closes at the first configured boundary: object count or uncompressed bytes. Default local boundaries are 1,000 objects and 2 MiB.

Artifacts and manifests are immutable. Repeating the same input must produce the same record order, compressed bytes, keys, and digests. Reusing an existing key with different bytes is an integrity error.

This phase implements local generation and validation only. Production storage integration, remote migration, bootstrap, and activation remain separate work.
