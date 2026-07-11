# Current-state relation batching

Loan Broker and Loan collection materialization resolves related current-state objects through the batched three-layer detail resolver.

The resolver:

- deduplicates object IDs;
- reads the fast-lane binding once per batch;
- fetches fast-lane and canonical-overlay precedence rows in batches;
- bounds concurrent canonical detail reads;
- preserves input ordering at collection materialization;
- fails closed when any required related current object is absent or tombstoned.
