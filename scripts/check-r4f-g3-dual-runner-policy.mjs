import { readFile } from 'node:fs/promises'

const runnerPath = 'scripts/run-r4f-g3-dual-provider-verdict.sh'
const text = await readFile(runnerPath, 'utf8')

for (const required of [
  "^/r4f-g3-finalize run=",
  'verify-r4f-g3-after-sequence.mjs',
  'assemble-r4f-g3-provider-capture.mjs',
  'verify-r4f-revision4-provider-capture.mjs',
  'verify-r4f-g3-provider-capture-independent.mjs',
  'compare-r4f-g3-provider-verdicts.mjs',
  'r4f-g3-one-shot-evidence',
  'r4f-g3-concurrent-traffic-evidence',
  'profileSelected: false',
  'r5Authorized: false',
  'publicReaderUnchanged: true',
  'mainnetDisabled: true',
  "test \"$agreement\" = 'true'",
  "test \"$production\" = 'true'",
  "test \"$independent\" = 'true'",
  "test \"$qualified\" = 'true'",
]) {
  if (!text.includes(required)) throw new Error(`formal G3 runner missing required boundary: ${required}`)
}

for (const forbidden of [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_ID',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_SERVICE_ROLE_KEY',
  'supabase functions deploy',
  'supabase functions delete',
  'supabase secrets set',
  'supabase secrets unset',
  'supabase db',
  'cron.unschedule',
  'cron.schedule',
  'xrpl-r5-recovery-batch',
  "MAINNET_ENABLED: 'true'",
]) {
  if (text.includes(forbidden)) throw new Error(`formal G3 runner contains forbidden capability: ${forbidden}`)
}

process.stdout.write('R4F G3 dual-verdict runner policy passed.\n')
