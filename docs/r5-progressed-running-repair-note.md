# R5 progressed-running repair note

Updated: 2026-08-16 JST.

Production revision-4 activation has already committed one 12-ledger batch. The current repair must preserve that progress. The guarded prepared-head repair now accepts either the original zero-progress `prepared` lifecycle state or a quiescent progressed `running` state with no active batch, no error, valid accounting digest, restored one-minute collector scheduler, and canonical watermark at or ahead of the retained R5 watermark.

The repair changes only the revision-4 prepared-head function definition and the exact migration-history record. It does not delete or rewrite committed R5 history, mutate the scheduler, deploy Edge functions, enable Mainnet, or authorize stabilization/soak.
