import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  evaluateM55BrowserExitEvidence,
  renderM55BrowserExitEvaluationMarkdown,
} from './m5-5-browser-exit-evaluation.mjs'

const inputDir = process.env.M5_BROWSER_OUTPUT_DIR ?? 'm5-5-browser-regression'
const outputDir = process.env.M5_EXIT_EVALUATION_OUTPUT_DIR ?? inputDir
const browserSummaryPath = process.env.M5_BROWSER_SUMMARY_PATH ?? path.join(inputDir, 'summary.json')
const d1SummaryPath = process.env.M5_D1_HEADROOM_SUMMARY_PATH ?? path.join(inputDir, 'd1-headroom-summary.json')
const collectorPreflightPath = process.env.M5_COLLECTOR_PREFLIGHT_PATH ?? path.join(inputDir, 'collector-preflight.json')

async function readJson(filePath, label) {
  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    throw new Error(`${label} could not be read from ${filePath}: ${error.message}`)
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} is not valid JSON at ${filePath}: ${error.message}`)
  }
}

const browserSummary = await readJson(browserSummaryPath, 'browser summary')
const d1Summary = await readJson(d1SummaryPath, 'D1 headroom summary')
const collectorPreflight = await readJson(collectorPreflightPath, 'collector preflight')

const evaluation = evaluateM55BrowserExitEvidence({
  browserSummary,
  d1Summary,
  collectorPreflight,
})
const markdown = renderM55BrowserExitEvaluationMarkdown(evaluation)

await mkdir(outputDir, { recursive: true })
await writeFile(
  path.join(outputDir, 'exit-evaluation.json'),
  `${JSON.stringify(evaluation, null, 2)}\n`,
  'utf8',
)
await writeFile(path.join(outputDir, 'exit-evaluation.md'), markdown, 'utf8')
console.log(markdown)

if (!evaluation.result.passed) process.exitCode = 1
