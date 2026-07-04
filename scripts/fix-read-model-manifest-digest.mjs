import { readFile, writeFile } from 'node:fs/promises'

const path = 'src/shared/current-state/github-read-model-reader.ts'
const source = await readFile(path, 'utf8')
const before = `    if (await sha256Hex(manifestBytes) !== channel.active.manifestSha256) throw new Error('Read-model manifest digest mismatch')
    const manifest = parseManifest(JSON.parse(new TextDecoder().decode(manifestBytes)))
`
const after = `    const manifestText = new TextDecoder().decode(manifestBytes)
    const manifest = parseManifest(JSON.parse(manifestText))
    const digestPayload = manifestText.replace(
      \`"manifestSha256":"\${manifest.manifestSha256}"\`,
      '"manifestSha256":null',
    )
    const semanticDigest = await sha256Hex(digestPayload)
    if (semanticDigest !== channel.active.manifestSha256 || manifest.manifestSha256 !== semanticDigest) {
      throw new Error('Read-model manifest digest mismatch')
    }
`
const matches = source.split(before).length - 1
if (matches !== 1) throw new Error(`Expected one manifest digest target, found ${matches}`)
await writeFile(path, source.replace(before, after), 'utf8')
