import { readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const patchDir = 'ops/current-state-patches'

function sh(command, args, input) {
  return execFileSync(command, args, {
    input,
    stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
  })
}

async function decodePatch(output, parts) {
  const encoded = []
  for (const part of parts) encoded.push(await readFile(`${patchDir}/${part}`, 'utf8'))
  const decoded = Buffer.from(encoded.join(''), 'base64')
  await writeFile(`${patchDir}/${output}.gz`, decoded)
  sh('gzip', ['-d', '-f', `${patchDir}/${output}.gz`])
}

await decodePatch('worktree.patch', ['worktree.patch.gz.b64'])
await decodePatch('runtime-native-fix.patch', [
  'runtime-native-fix.patch.gz.b64.part00',
  'runtime-native-fix.patch.gz.b64.part01',
  'runtime-native-fix.patch.gz.b64.part02',
  'runtime-native-fix.patch.gz.b64.part03',
  'runtime-native-fix.patch.gz.b64.part04a',
  'runtime-native-fix.patch.gz.b64.part04b',
  'runtime-native-fix.patch.gz.b64.part04c',
  'runtime-native-fix.patch.gz.b64.part04d1',
  'runtime-native-fix.patch.gz.b64.part04d2',
])

sh('git', ['apply', '--check', `${patchDir}/worktree.patch`])
sh('git', ['apply', `${patchDir}/worktree.patch`])
sh('git', ['apply', '--check', `${patchDir}/runtime-native-fix.patch`])
sh('git', ['apply', `${patchDir}/runtime-native-fix.patch`])

await rm(patchDir, { recursive: true, force: true })
if (existsSync('.github/workflows/bootstrap-release-runtime.yml')) await rm('.github/workflows/bootstrap-release-runtime.yml')
