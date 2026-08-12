// Qualification-only wrapper around the repository revision-4 R5 executor.
// It is deployed under a distinct temporary function name so the active
// xrpl-r5-recovery-batch deployment is never replaced by the proof run.
//
// The selection digest is SHA-256("r4f-revision4-r5-12-ledger-accounting-v1").
// The provider surface was formally declared unqualifiable, so this retained
// observation measures the application-side directional contract with no
// fabricated provider-delta uplift.
const qualificationRuntime = globalThis as typeof globalThis & {
  __XRPL_R5_REVISION4_QUALIFICATION_OVERRIDE__?: Readonly<{
    selectionDigest: string
    unexplainedDirectionalReserveBytes: string
  }>
}

if (qualificationRuntime.__XRPL_R5_REVISION4_QUALIFICATION_OVERRIDE__ !== undefined) {
  throw new Error('revision4 qualification runtime override already exists')
}
qualificationRuntime.__XRPL_R5_REVISION4_QUALIFICATION_OVERRIDE__ = Object.freeze({
  selectionDigest: '99a1f97fc17ed6023bc3075bffe963a260e99a4ed0e2d831b068826c7797222f',
  unexplainedDirectionalReserveBytes: '0',
})

await import('../xrpl-r5-recovery-batch/index.ts')
