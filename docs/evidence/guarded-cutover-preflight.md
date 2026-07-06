# Guarded production cutover preflight

- Canonical history range: `3371676..3432924`
- Canonical ledger count: `61,249`
- Canonical segment count: `123`
- Replacement base ledger: `3432924`
- Replacement base hash: `52C13CBFFC3433750DBBB986390C4C6E6F7CC82CF70B4B909C506536A8BD9218`
- Replacement snapshot: `devnet-3432924-canonical`
- Candidate source rehearsal: passed
- Live replacement-base D1 dry-run: `ready`, planned action `rebase`
- Old incremental cursor observed in dry-run: `3390079`
- Live validated head observed in dry-run: `3439652`
- Full-chain evidence shows ledger `3390080` produced an estimated 143 derived rows, consistent with the previous 128-row budget stop.
- The 2048 statement / 2048 row / 128 overlay ceiling candidate previously completed six live samples with zero failures.

Cutover sequence:

1. Enable immutable history source.
2. Disable superseded initial catch-up initialization.
3. Enable guarded replacement-base rebase.
4. Confirm D1 replacement-base replay/alignment through read-only runtime evidence.
5. Promote `current-state-data` to the verified replacement current-state candidate only after D1 alignment is observed.
6. Verify post-boundary live continuation from ledger `3432925` onward.
