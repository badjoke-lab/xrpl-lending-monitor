import { verifyRetainedR5Qualifications } from './verify-supabase-retained-r5-qualification-evidence-v2.mjs'

export { verifyRetainedR5Qualifications }

if (process.argv[1]?.endsWith('verify-supabase-retained-r5-qualification-evidence.mjs')) {
  const retained = await verifyRetainedR5Qualifications()
  if (retained === null) {
    throw new Error('active R5 recovery ownership is required for retained qualification verification')
  }
  process.stdout.write(`${JSON.stringify(retained.combined)}\n`)
}
