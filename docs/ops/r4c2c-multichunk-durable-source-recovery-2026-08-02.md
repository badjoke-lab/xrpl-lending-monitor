# R4C2c multi-chunk durable-source recovery — 2026-08-02

Status: implementation correction after remote run `30746739442` reached the standard-phase multi-chunk verifier and Devnet returned `ledgerNotFound` for fixed ledger `2,776,760`.

## Failure boundary

The failed run proved that:

- all six exact Edge bundles deployed;
- active collector verification passed;
- active committed-reader verification passed;
- committed historical-witness verification passed without re-fetching old Devnet ledgers;
- only the multi-chunk executor failed;
- no isolated multi-chunk phase message was claimed or completed before the failure;
- the active collector remained healthy and separate.

The failure was an external history-retention dependency, not a payload, phase-chain, commit, or reader failure.

## Durable source

The source ledger's `116` canonical rows are already retained inside the committed historical witness set:

- set ID: `r4c2c-devnet-historical-witness-v1`;
- set digest: `bac80ec90ba841b683ee9e4b154cf385ffd972ce636f9797cb8f6cff1cdd209a`;
- set status: `committed`;
- total set rows: `237`;
- source ledger: `2,776,760`;
- source ledger hash: `83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D`;
- source ledger parent hash: `E7E4E253C314D5EBD39E8C063415A99299E48FB23A0E613F1FE5CA534B0C0628`;
- source rows: `116`.

The executor now validates the exact committed set identity and digest, reads only the `116` rows for ledger `2,776,760`, validates canonical row values and relationships, validates unique semantic identities and exact per-class counts, and reconstructs the standard normalized collector payload with the shared builders.

No XRPL historical RPC is used by the multi-chunk executor.

## Standard phase remains unchanged

The durable source is only the input to the existing shared payload builder. The proof still requires the standard remote phase path:

1. `scan`;
2. `commit:0`;
3. `commit:1`;
4. `commit:2`;
5. `finalize`.

Expected payload, commit, and reader page sizes remain:

- `40`;
- `40`;
- `36`.

The executor still uses the standard phase tables and the existing portable scan, commit, and finalize completion RPCs. The reader still binds continuation to one committed work fence.

## Safety boundary

The correction does not:

- write to the active profile;
- claim an active phase message;
- replace or regress the active watermark;
- change the public reader;
- submit an XRPL transaction;
- enable Mainnet;
- select a profile;
- begin R5, stabilization, or soak.

Remote completion still requires a successful main-branch deployment and retained evidence for the five-phase sequence, `40/40/36` chunks, `116` committed rows, three-page reader continuation, and active-watermark isolation.
