# Current-state artifact format

The current-state pipeline stores one fixed Devnet ledger as deterministic compressed artifacts before any production adapter is selected.

Each artifact is scoped by network, epoch, and snapshot:

```text
current-state/devnet/<epoch-id>/<snapshot-id>/
  data/<kind>/<page>-<chunk>.ndjson.gz
  indexes/<index-kind>/<page>-<chunk>.ndjson.gz
  pages/<page>/manifest.json
  catalogs/<catalog-kind>/<chunk>.ndjson.gz
  manifest.json
```

Data `kind` is `vault`, `loan-broker`, or `loan`.

Index kinds are:

- `object-id` — object identifier to immutable data shard;
- `account` — Account, Owner, and Borrower to object references;
- `relationship` — Vault to Loan Broker and Loan Broker to Loan references;
- `search` — exact object-identifier and account search terms.

Records are canonical JSON lines sorted deterministically. Data records include snapshot identity, object kind, object ID, the SHA-256 digest of the canonical object, and the retained ledger object.

A data shard closes at the first configured boundary: object count or uncompressed bytes. Default local boundaries are 1,000 objects and 2 MiB. Index and catalog shards use their own entry-count and uncompressed-byte limits.

Each page has one manifest covering its data and index shards. The scan marker advances only after all page artifacts and the page manifest pass digest and size verification.

A complete snapshot adds compressed shard catalogs. Catalogs let readers locate relevant data and index shards without loading every page manifest. The snapshot-level manifest references the page manifests and catalog shards and records aggregate payload and catalog sizes.

Reader operations are bounded by explicit result and shard-read limits. List pagination uses an opaque cursor. Detail, account, relationship, and exact-search paths use the catalog and only read candidate index and data shards.

Artifacts and manifests are immutable. Repeating the same input must produce the same record order, compressed bytes, keys, and digests. Reusing an existing key with different bytes is an integrity error.

Production storage integration, remote migration, snapshot activation, and public API wiring remain separate work.
