import { readFileSync } from 'node:fs'

const runStatus = process.env.RUN_STATUS ?? 'unknown'
const runId = process.env.RUN_ID ?? 'unknown'
const runUrl = process.env.RUN_URL ?? 'unknown'
const headSha = process.env.HEAD_SHA ?? 'unknown'
const directory = 'supabase-remote-probe-evidence'

function read(name) {
  try {
    return JSON.parse(readFileSync(`${directory}/${name}`, 'utf8'))
  } catch {
    return null
  }
}

const success = read('verified-operator-independence.json')
const failure = read('failed-operator-independence.json')
const lines = [
  '',
  '## R4C2d G9 operator independence',
  '',
  `- run: [${runId}](${runUrl})`,
  `- commit: \`${headSha}\``,
  `- job status: \`${runStatus}\``,
]

if (success) {
  lines.push(
    '- operator-independence verifier: `success`',
    `- profile ID: \`${String(success.profileId ?? 'unknown')}\``,
    `- profile revision: \`${String(success.profileRevision ?? 'unknown')}\``,
    `- profile identity digest: \`${String(success.profileIdentityDigest ?? 'unknown')}\``,
    `- evidence digest: \`${String(success.evidenceDigest ?? 'unknown')}\``,
    `- deployment scripted: \`${String(success.checks?.deployScripted ?? 'unknown')}\``,
    `- credential rotation scripted: \`${String(success.checks?.credentialRotationScripted ?? 'unknown')}\``,
    `- checkpoint scripted and remotely proved: \`${String(success.checks?.checkpointScriptedAndRemotelyProved ?? 'unknown')}\``,
    `- export scripted and remotely proved: \`${String(success.checks?.exportScriptedAndRemotelyProved ?? 'unknown')}\``,
    `- restore scripted and remotely proved: \`${String(success.checks?.restoreScriptedAndRemotelyProved ?? 'unknown')}\``,
    `- rollback scripted and remotely proved: \`${String(success.checks?.rollbackScriptedAndRemotelyProved ?? 'unknown')}\``,
    `- halt scripted and remotely proved: \`${String(success.checks?.haltScriptedAndRemotelyProved ?? 'unknown')}\``,
    `- evidence publication scripted: \`${String(success.checks?.evidenceScripted ?? 'unknown')}\``,
    `- routine Dashboard or terminal operation required: \`${String(!(success.checks?.noRoutineDashboardOrTerminalOperation ?? false))}\``,
    `- exact profile revision bound: \`${String(success.checks?.exactProfileRevisionBound ?? 'unknown')}\``,
    `- active profile read only: \`${String(success.checks?.activeProfileReadOnly ?? 'unknown')}\``,
    `- G9 qualified: \`${String(success.checks?.g9Qualified ?? 'unknown')}\``,
    `- G8 qualified: \`${String(success.checks?.g8Qualified ?? 'unknown')}\``,
    `- profile selected: \`${String(success.checks?.profileSelected ?? 'unknown')}\``,
  )
} else if (failure) {
  lines.push(
    '- operator-independence verifier: `failed`',
    `- profile ID: \`${String(failure.profileId ?? 'unknown')}\``,
    `- profile revision: \`${String(failure.profileRevision ?? 'unknown')}\``,
    `- profile identity digest: \`${String(failure.profileIdentityDigest ?? 'unknown')}\``,
    `- failed at: \`${String(failure.failedAt ?? 'unknown')}\``,
    `- reason: \`${String(failure.reason ?? 'unknown').slice(0, 1_000)}\``,
    `- G9 qualified: \`${String(failure.checks?.g9Qualified ?? false)}\``,
    `- G8 qualified: \`${String(failure.checks?.g8Qualified ?? false)}\``,
    `- profile selected: \`${String(failure.checks?.profileSelected ?? false)}\``,
  )
} else {
  lines.push('- operator-independence verifier: `not reached or no sanitized evidence produced`')
}

process.stdout.write(`${lines.join('\n')}\n`)
await import('./publish-supabase-provider-metric-capability.mjs')