import { readFile } from 'node:fs/promises'

const workflow = await readFile('.github/workflows/r4f-g3-isolated-window.yml', 'utf8')
const manager = await readFile('scripts/manage-r4f-g3-isolated-window.mjs', 'utf8')
const verifier = await readFile('scripts/verify-r4f-g3-isolation-prepare-proposal.mjs', 'utf8')
const beforeVerifier = await readFile('scripts/verify-r4f-g3-before-sequence.mjs', 'utf8')
const afterVerifier = await readFile('scripts/verify-r4f-g3-after-sequence.mjs', 'utf8')

for (const required of [
  "github.event.issue.number == 1261",
  "github.event.comment.user.login == 'badjoke-lab'",
  "github.event.comment.body == '/r4f-g3-isolation-prepare'",
  "startsWith(github.event.comment.body, '/r4f-g3-dashboard-authorize ')",
  "scope=r4f_g3_dashboard_capture",
  "startsWith(github.event.comment.body, '/r4f-g3-isolation-pause ')",
  "startsWith(github.event.comment.body, '/r4f-g3-isolation-resume ')",
  "dashboard_auth=([0-9]+)",
  "one_shot_run=([0-9]+)",
  "before_comment=([0-9]+)",
  "after_comment=([0-9]+)",
  'node scripts/prepare-r4f-g3-isolated-window.mjs',
  'node scripts/verify-r4f-g3-isolation-prepare-proposal.mjs',
  'node scripts/verify-r4f-g3-after-sequence.mjs',
  'node scripts/manage-r4f-g3-isolated-window.mjs \\\n            --mode pause',
  'node scripts/manage-r4f-g3-isolated-window.mjs \\\n            --mode resume',
  'A database-local watchdog is installed before the collector is paused.',
  'The pause is bounded to at most 15 minutes.',
  'Dashboard capture scope:',
  'r4f-g3-isolated-window-pause-evidence',
  'r4f-g3-isolated-window-resume-evidence',
  'Verified Usage invocation delta',
]) {
  if (!workflow.includes(required)) throw new Error(`G3 isolation workflow missing bounded control:${required}`)
}

for (const forbidden of [
  '  push:',
  '  schedule:',
  'pull_request_target',
  'contents: write',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_SERVICE_ROLE_KEY',
  'supabase link',
  'supabase db',
  'supabase functions deploy',
  'supabase functions delete',
  'supabase secrets set',
  'supabase secrets unset',
  'cron.schedule(',
  'cron.unschedule(',
  'xrpl-r5-recovery-batch',
  "MAINNET_ENABLED: 'true'",
]) {
  if (workflow.includes(forbidden)) throw new Error(`G3 isolation workflow contains forbidden direct capability:${forbidden.trim()}`)
}

for (const required of [
  "const collectorJobName = 'xrpl-lending-monitor-minute'",
  "const collectorSchedule = '* * * * *'",
  'const quietSeconds = 65',
  'const pauseDeadlineSeconds = 15 * 60',
  'if (readOnly) payload.read_only = true',
  "'select cron.schedule($1::text, $2::text, $3::text) as job_id'",
  "'select cron.unschedule($1::bigint) as unscheduled'",
  'decodeCollectorCommandFromWatchdog',
  'automaticRestoreWatchdogInstalledFirst: true',
  'collectorSchedulerPaused: true',
  'recoveryMutationCommitted: false',
  'publicReaderUnchanged: true',
  'mainnetDisabled: true',
  'stabilizationAuthorized: false',
  'soakAuthorized: false',
]) {
  if (!manager.includes(required)) throw new Error(`G3 isolation manager missing bounded control:${required}`)
}
for (const forbidden of [
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_SERVICE_ROLE_KEY',
  'supabase link',
  'supabase db',
  'supabase functions deploy',
  'supabase secrets set',
  'xrpl-r5-recovery-batch',
  "MAINNET_ENABLED: 'true'",
  'read_only: readOnly',
]) {
  if (manager.includes(forbidden)) throw new Error(`G3 isolation manager contains forbidden capability:${forbidden}`)
}

const watchdogInstall = manager.indexOf("watchdogJobId = await scheduleJob(watchdogName, '* * * * *', watchdogCommand)")
const collectorPause = manager.indexOf('await unscheduleJob(expectedJobId)')
if (watchdogInstall < 0 || collectorPause <= watchdogInstall) {
  throw new Error('G3 isolation manager must install restore watchdog before collector pause')
}
const failureCatch = manager.indexOf('} catch (error) {')
const immediateRestore = manager.indexOf('await scheduleJob(collectorJobName, collectorSchedule, collectorCommand)', failureCatch)
const watchdogCleanup = manager.indexOf('await removeWatchdogs()', failureCatch)
if (failureCatch < 0 || immediateRestore <= failureCatch || watchdogCleanup <= immediateRestore) {
  throw new Error('G3 isolation manager must attempt collector restore before watchdog cleanup on failure')
}

for (const required of [
  "run.name !== 'R4F G3 Isolated Window'",
  "run.event !== 'issue_comment'",
  "run.conclusion !== 'success'",
  'Collector cron job: `xrpl-lending-monitor-minute`',
  'Dashboard capture scope: `r4f_g3_dashboard_capture`',
  'A database-local watchdog is installed before the collector is paused.',
  'The pause is bounded to at most 15 minutes.',
  'exact dashboard authorization command must appear once',
]) {
  if (!verifier.includes(required)) throw new Error(`G3 isolation proposal verifier missing binding:${required}`)
}

for (const required of [
  'dashboard authorization must precede pause authorization',
  'BEFORE capture must follow completed isolation pause',
  'one-shot prepare must follow the retained BEFORE capture',
  'dashboardAuthorizationPrecedesPause: true',
  'beforePrecedesOneShotPrepare: true',
]) {
  if (!beforeVerifier.includes(required)) throw new Error(`G3 BEFORE sequence verifier missing binding:${required}`)
}

for (const required of [
  'Supabase Usage is not fresh: AFTER invocations must increase by at least one',
  'AFTER capture must follow the completed one-shot run',
  'resume must follow the retained AFTER capture',
  'usageFresh: true',
  'afterPrecedesResume: true',
]) {
  if (!afterVerifier.includes(required)) throw new Error(`G3 AFTER sequence verifier missing binding:${required}`)
}

process.stdout.write('R4F G3 bounded isolation control policy passed.\n')
