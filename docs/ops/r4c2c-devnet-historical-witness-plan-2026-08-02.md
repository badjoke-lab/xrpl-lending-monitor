# R4C2c Devnet historical witness discovery — 2026-08-02

Status: implementation proposed; remote read-only evidence pending.

## Purpose

The active Supabase R4C2c stream has remotely proved the seven-class envelope and committed-reader behavior for `validated-ledger`, but its retained work contained no Lending transaction. The other six semantic classes therefore still have zero-count remote evidence.

This unit discovers immutable historical Devnet ledgers containing real Lending transactions and passes them through the same canonical parser and seven-class normalizer used by the Supabase collector. It is a discovery and witness-selection unit, not a public cutover or a substitute for later committed persistence and reader proof.

## Immutable inputs

The fixed input set comes from the retained June 30 Devnet audit:

- audit generated at: `2026-06-30T16:38:10.748Z`;
- audit validated ledger: `3,270,064`;
- bounded audit window: `3,269,937` through `3,270,064`;
- known object `PreviousTxnLgrSeq` values:
  - `63,189`;
  - `1,801,434`;
  - `2,776,760`;
  - `2,980,845`;
  - `3,127,240`.

The window is read-only and fixed in source. A later expansion requires a reviewed source change.

## Execution

The workflow:

1. checks out the exact main commit;
2. installs the locked dependencies;
3. bundles `scripts/qualify-devnet-historical-witness.ts` for Node with Bun;
4. rejects unresolved relative imports and Cloudflare runtime imports;
5. reads the fixed historical Devnet ledgers through the public JSON-RPC endpoint;
6. parses expanded validated ledgers with `parseValidatedLedgerResult`;
7. filters canonical Lending transaction types;
8. passes each non-empty ledger through `buildPortableXrplNormalizedWork`;
9. records sanitized class counts, transaction hashes/types, canonical keys, and relationship IDs;
10. uploads the evidence artifact and publishes a run locator to Issue #1118.

## Resource bounds

- requested ledgers: `133`;
- concurrency: `6`;
- request timeout: `15,000 ms`;
- request attempts: `2`;
- workflow timeout: `20 minutes`;
- artifact retention: `14 days`.

Unavailable historical ledgers are retained as explicit failures. A partial result remains useful discovery evidence. The workflow fails only when no requested ledger is readable or the runner itself cannot produce valid evidence.

## Evidence result

The output records counts for:

- `validated-ledger`;
- `protocol-event`;
- `object-change`;
- `loan-lifecycle`;
- `archived-object`;
- `balance-history`;
- `current-projection`.

`completeSixClassWitness` is true only when every non-ledger class has at least one real Devnet record. A successful workflow run with `completeSixClassWitness: false` must be described as partial discovery, not R4C2c completion.

## Workflow replacement

The expired `complete-history-12-slot-qualification-995-v5.yml` workflow had a fixed July 28 schedule and stale identity validation. It is removed from the active Actions surface. Its plans, scripts, and retained historical evidence remain in the repository.

The replacement historical-witness workflow has no schedule. The repository continues to allow exactly eight workflow files, and the active R4 phase allows no scheduled GitHub Actions workflow.

## Prohibited effects

This unit performs none of the following:

- transaction creation or submission;
- faucet use or seed handling;
- Supabase or D1 mutation;
- Worker or Edge Function deployment;
- public-reader change;
- profile selection;
- R5 recovery;
- Mainnet enablement;
- stabilization or soak.

## Follow-up decision

After the first main-branch run:

- if all six classes are non-empty, freeze the smallest sufficient ledger set and implement isolated committed persistence plus reader parity;
- if only some classes are non-empty, freeze those witnesses and add a separately reviewed search for only the missing classes;
- if the historical ledgers are unavailable, retain the failure and choose controlled Devnet transaction generation as a separate unit rather than silently widening the scan.
