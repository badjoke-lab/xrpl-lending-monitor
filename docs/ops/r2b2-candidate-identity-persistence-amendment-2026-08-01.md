# R2b2 candidate identity persistence amendment — 2026-08-01

Status: controlling correction before R2b2-D finalization.

This amendment is local and provider-neutral. It authorizes no remote deployment, production mutation, provider selection, Mainnet change, recovery, or soak work.

## Finding

The normalized candidate contract requires every committed candidate to preserve:

- `semanticClass`;
- `canonicalKey`;
- `sourceLedgerIndex`;
- `sourceLedgerHash`;
- `sourceTransactionHash`;
- `objectId`;
- sorted `relationshipIds`;
- `isTombstone`;
- canonical normalized value.

The R1 reference row originally stored only class, key, source ledger identity, tombstone, and value. The initial R2b2-C commit runtime therefore omitted transaction identity, object identity, and relationship identity from durable candidate rows.

That implementation cannot satisfy the R2b requirement to map every candidate to a work-scoped row without changing semantic identity. Finalization must not approve an incomplete persistence envelope.

## Required schema correction

Append a new migration. Do not rewrite the already merged R1 migration.

`collector_reference_rows` adds:

```text
source_transaction_hash TEXT NULL
object_id TEXT NULL
relationship_ids_json TEXT NOT NULL DEFAULT '[]'
```

`relationship_ids_json` is canonical portable JSON for the deduplicated, sorted relationship ID array.

The committed-only view exposes the same fields.

## Reference row contract

`PortableReferenceRow` carries:

```ts
interface PortableReferenceRow {
  workId: string
  semanticClass: string
  canonicalKey: string
  sourceLedgerIndex: number
  sourceLedgerHash: string
  sourceTransactionHash: string | null
  objectId: string | null
  relationshipIds: string[]
  valueJson: string | null
  isTombstone: boolean
  createdAt: string
}
```

Requirements:

- source hashes are canonical uppercase;
- nullable identities remain explicit `null`;
- relationship IDs are non-empty strings, deduplicated, sorted, and persisted as canonical JSON;
- idempotent row conflict checks include every identity field;
- typed reads and committed-only reads return the exact identity envelope;
- export and restore preserve the complete envelope byte for byte.

## Commit correction

The commit runtime must persist all identity fields from each verified `NormalizedCandidateV1`.

A duplicate `(semanticClass, canonicalKey)` with any changed ledger, transaction, object, relationship, tombstone, or value field is a conflict and cannot converge as success.

## Runtime export version

The complete runtime export schema advances from version `2` to version `3` because reference-row shape changes.

Version 3 restore requires and restores every new identity field. It rejects unsupported older export versions rather than silently inventing missing identities.

No production or user data migration is executed by this amendment. The migration is proved only through the complete local migration sequence and SQLite tests.

## Required tests

Before R2b2-D begins, the repository must prove:

1. the complete local migration sequence adds all identity columns and recreates the committed-only view;
2. stage/read/committed-read preserves transaction, object, and relationship identities exactly;
3. relationship ordering and duplicates normalize deterministically;
4. changed identity on an existing work/class/key conflicts;
5. commit runtime persists the complete normalized identity envelope;
6. runtime export version 3 restores identity fields byte for byte into a second SQLite database;
7. non-empty restore-target rejection remains atomic;
8. existing committed-only visibility and watermark rules remain unchanged;
9. lint, type-check, complete unit suite, all migrations, build, and browser smoke pass.

## Schedule effect

R2b2-C remains implemented but its completion record is conditional until this correction merges. R2b2-D finalization starts only after the identity persistence migration, store, commit mapping, and export/restore correction are on `main`.
