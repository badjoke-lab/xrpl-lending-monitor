# Architecture

## Target architecture

```text
                     XRPL Devnet
                         |
               validated ledger reads
                         |
                         v
                  GitHub Actions
                 bounded collector
                    /       \
                   /         \
                  v           v
        Current artifacts   History artifacts
          base + live       append-only events
                  \           /
                   \         /
                    v       v
                verified channel
                      |
                      v
              GitHub Release assets
                      |
                      v
                static React app
```

The architecture contains no canonical runtime database.

## Layers

### Protocol/domain layer

Retain and reuse:

- validated ledger parsing;
- Lending transaction classification;
- AffectedNodes normalization;
- Vault/LoanBroker/Loan normalization;
- lifecycle derivation;
- deleted-object derivation;
- cover/debt/loss derivation;
- relationship validation;
- exact decimal and asset semantics.

This layer must not depend on a persistence provider.

### Collection layer

Reads validated ledgers and emits deterministic records.

The collector knows:

- XRPL endpoint selection;
- ledger/hash cursor;
- bounded read window;
- continuity checks;
- derivation functions;
- artifact schema.

It does not know D1, Queue, Supabase, or public UI components.

### Publication layer

Owns:

- artifact encoding/compression;
- generation manifests;
- digests;
- upload verification;
- live channel switch;
- compaction.

Initial provider: GitHub Releases.

Provider-specific code stays behind an artifact publisher interface.

### UI data layer

Owns:

- channel loading;
- artifact integrity checks required for browser reads;
- base/live resolution;
- bounded index/page reads;
- history lookup;
- mapping to UI view models.

React pages consume this layer rather than calling legacy `/api/*` endpoints directly.

### Presentation layer

Existing React routes/components remain the baseline.

The migration should preserve behavior before redesigning the UI.

## Current base architecture

Full Current scan is expensive: the 2026-09-11 verified fresh build contained approximately 2.35 million relevant objects.

Therefore:

- a browser full ledger scan is prohibited;
- a browser full artifact scan is prohibited;
- complete Current scan occurs out of band;
- public reads use sharded/indexed artifacts.

The existing fresh snapshot and read-model builders are implementation evidence and reuse candidates. Workflow-time source patching used by the old emergency path must be replaced with normal source code before production use.

## Live overlay architecture

AffectedNodes provide sufficient information to derive upsert/deletion mutations for relevant Lending objects.

A live run publishes an ordered delta with:

- start/end ledger index;
- start parent hash;
- end ledger hash;
- event/object mutation counts;
- mutation records;
- history records;
- schema version;
- digest.

For scalable reads, deltas are periodically compacted into sharded overlay/index assets. The public channel references a bounded active overlay generation.

## History architecture

History is not reconstructed from Current.

It is derived directly from validated transaction metadata and contains independent immutable evidence.

Existing `history-data` remains a preserved historical generation, but it is not assumed continuous with a future DB-less live generation.

## Hosting

The application target is static hosting.

Cloudflare DNS may point to the selected host, but no Cloudflare stateful service is required.

The deployment provider is intentionally not hard-coded into the domain or UI data contracts.

## Security and trust

The public application is read-only.

No private key, seed, wallet session, privileged XRPL action, or write API is required.

GitHub publication credentials remain in GitHub Actions and are never exposed to the browser.

## Legacy boundary

The following are migration sources only, not target architecture:

- `src/worker/**` D1/Queue runtime;
- D1 migrations and repositories;
- fast-lane persistence;
- Supabase recovery/qualification machinery;
- Worker Cron collection;
- generated-data branches used as long-lived databases.

They are removed after replacement evidence exists.
