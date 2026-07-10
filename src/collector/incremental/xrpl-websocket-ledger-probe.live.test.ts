import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'

import { XrplJsonRpcClient } from '../network/xrpl-rpc'
import { scanValidatedLedgerRange } from './scan-validated-ledgers'
import {
  createXrplWebSocketLedgerSession,
  type XrplWebSocketLedgerSession,
} from './xrpl-websocket-ledger-session'

interface ProbeEnvironment {
  RUN_XRPL_WSS_PROBE?: string
  XRPL_WSS_PROBE_HTTP_ENDPOINT?: string
  XRPL_WSS_PROBE_ENDPOINT?: string
  XRPL_WSS_PROBE_LEDGER_COUNT?: string
  XRPL_WSS_PROBE_READ_WINDOW?: string
  XRPL_WSS_PROBE_TIMEOUT_MS?: string
  XRPL_WSS_PROBE_OUTPUT?: string
}

interface ProbeEvidence {
  schema_version: 1
  status: 'passed' | 'failed'
  started_at: string
  completed_at: string | null
  http_endpoint: string
  wss_endpoint: string
  requested_range_ledgers: number
  read_window: number
  timeout_ms: number
  node_websocket_type: string
  validated_head: {
    ledger_index: number | null
    ledger_hash: string | null
  }
  range: {
    start_ledger_index: number | null
    end_ledger_index: number | null
    scanned_ledgers: number
    first_ledger_hash: string | null
    last_ledger_hash: string | null
  }
  transport: {
    connections: number
    logical_messages: number
    successful_ledgers: number
    response_failures: number
    reconnects: number
  }
  continuity: {
    passed: boolean
    expected_previous_hash: string | null
    first_parent_hash: string | null
    last_matches_validated_head: boolean
  }
  scan_metrics: {
    inspected_transactions: number
    lending_transactions: number
  }
  wall_time_ms: number | null
  error: string | null
}

const environment = ((globalThis as unknown as {
  process?: { env?: ProbeEnvironment }
}).process?.env ?? {}) as ProbeEnvironment

const liveProbeEnabled = environment.RUN_XRPL_WSS_PROBE === '1'

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseValidatedHead(result: Record<string, unknown>): {
  ledgerIndex: number
  ledgerHash: string
} {
  const ledger = isRecord(result.ledger) ? result.ledger : null
  const rawIndex = result.ledger_index ?? ledger?.ledger_index ?? ledger?.seqNum
  const ledgerIndex = typeof rawIndex === 'string' && /^\d+$/.test(rawIndex)
    ? Number(rawIndex)
    : rawIndex
  if (!Number.isSafeInteger(ledgerIndex) || Number(ledgerIndex) <= 0) {
    throw new Error('Validated head response did not include a positive ledger index')
  }

  const rawHash = result.ledger_hash ?? ledger?.ledger_hash ?? ledger?.hash
  if (typeof rawHash !== 'string' || rawHash.length === 0) {
    throw new Error('Validated head response did not include a ledger hash')
  }

  return {
    ledgerIndex: Number(ledgerIndex),
    ledgerHash: rawHash,
  }
}

async function writeEvidence(path: string, evidence: ProbeEvidence): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
}

describe.skipIf(!liveProbeEnabled)('live XRPL Devnet WebSocket ledger probe', () => {
  it('reads a bounded contiguous range through one read-only session', async () => {
    const httpEndpoint = environment.XRPL_WSS_PROBE_HTTP_ENDPOINT
      ?? 'https://s.devnet.rippletest.net:51234/'
    const wssEndpoint = environment.XRPL_WSS_PROBE_ENDPOINT
      ?? 'wss://s.devnet.rippletest.net:51233/'
    const ledgerCount = positiveInteger(
      environment.XRPL_WSS_PROBE_LEDGER_COUNT,
      64,
      'XRPL_WSS_PROBE_LEDGER_COUNT',
    )
    const readWindow = positiveInteger(
      environment.XRPL_WSS_PROBE_READ_WINDOW,
      1,
      'XRPL_WSS_PROBE_READ_WINDOW',
    )
    const timeoutMs = positiveInteger(
      environment.XRPL_WSS_PROBE_TIMEOUT_MS,
      15_000,
      'XRPL_WSS_PROBE_TIMEOUT_MS',
    )
    const outputPath = environment.XRPL_WSS_PROBE_OUTPUT
      ?? 'artifacts/wss-probe/evidence.json'

    if (readWindow > ledgerCount) {
      throw new Error('XRPL_WSS_PROBE_READ_WINDOW must not exceed XRPL_WSS_PROBE_LEDGER_COUNT')
    }

    const evidence: ProbeEvidence = {
      schema_version: 1,
      status: 'failed',
      started_at: new Date().toISOString(),
      completed_at: null,
      http_endpoint: httpEndpoint,
      wss_endpoint: wssEndpoint,
      requested_range_ledgers: ledgerCount,
      read_window: readWindow,
      timeout_ms: timeoutMs,
      node_websocket_type: typeof globalThis.WebSocket,
      validated_head: {
        ledger_index: null,
        ledger_hash: null,
      },
      range: {
        start_ledger_index: null,
        end_ledger_index: null,
        scanned_ledgers: 0,
        first_ledger_hash: null,
        last_ledger_hash: null,
      },
      transport: {
        connections: 0,
        logical_messages: 0,
        successful_ledgers: 0,
        response_failures: 0,
        reconnects: 0,
      },
      continuity: {
        passed: false,
        expected_previous_hash: null,
        first_parent_hash: null,
        last_matches_validated_head: false,
      },
      scan_metrics: {
        inspected_transactions: 0,
        lending_transactions: 0,
      },
      wall_time_ms: null,
      error: null,
    }

    const startedAtMs = Date.now()
    let session: XrplWebSocketLedgerSession | null = null

    try {
      const httpClient = new XrplJsonRpcClient({
        endpoint: httpEndpoint,
        timeoutMs,
      })
      const headResult = await httpClient.call<Record<string, unknown>>('ledger', {
        ledger_index: 'validated',
        transactions: false,
        expand: false,
        owner_funds: false,
      })
      const head = parseValidatedHead(headResult)
      evidence.validated_head = {
        ledger_index: head.ledgerIndex,
        ledger_hash: head.ledgerHash,
      }

      const startLedgerIndex = head.ledgerIndex - ledgerCount + 1
      if (startLedgerIndex <= 1) {
        throw new Error('Validated head is too low for the requested probe range')
      }
      evidence.range.start_ledger_index = startLedgerIndex
      evidence.range.end_ledger_index = head.ledgerIndex

      session = createXrplWebSocketLedgerSession({ endpoint: wssEndpoint })
      const anchor = await session.reader({
        endpoint: wssEndpoint,
        ledgerIndex: startLedgerIndex - 1,
        timeoutMs,
      })
      evidence.continuity.expected_previous_hash = anchor.ledgerHash

      const scan = await scanValidatedLedgerRange({
        endpoint: wssEndpoint,
        timeoutMs,
        startLedgerIndex,
        latestValidatedLedger: head.ledgerIndex,
        maxLedgers: ledgerCount,
        expectedPreviousHash: anchor.ledgerHash,
        reader: session.reader,
        readWindowSize: readWindow,
      })

      const first = scan.ledgers.at(0)
      const last = scan.ledgers.at(-1)
      evidence.range.scanned_ledgers = scan.ledgers.length
      evidence.range.first_ledger_hash = first?.ledgerHash ?? null
      evidence.range.last_ledger_hash = last?.ledgerHash ?? null
      evidence.transport = {
        connections: session.usage.connections,
        logical_messages: session.usage.logicalMessages,
        successful_ledgers: session.usage.successfulLedgers,
        response_failures: 0,
        reconnects: 0,
      }
      evidence.continuity = {
        passed: true,
        expected_previous_hash: anchor.ledgerHash,
        first_parent_hash: first?.parentHash ?? null,
        last_matches_validated_head: last?.ledgerHash === head.ledgerHash,
      }
      evidence.scan_metrics = {
        inspected_transactions: scan.metrics.inspectedTransactions,
        lending_transactions: scan.metrics.lendingTransactions,
      }

      expect(scan.ledgers).toHaveLength(ledgerCount)
      expect(first?.ledgerIndex).toBe(startLedgerIndex)
      expect(first?.parentHash).toBe(anchor.ledgerHash)
      expect(last?.ledgerIndex).toBe(head.ledgerIndex)
      expect(last?.ledgerHash).toBe(head.ledgerHash)
      expect(scan.completeToLatest).toBe(true)
      expect(session.usage.connections).toBe(1)
      expect(session.usage.logicalMessages).toBe(ledgerCount + 1)
      expect(session.usage.successfulLedgers).toBe(ledgerCount + 1)

      evidence.status = 'passed'
    } catch (error) {
      evidence.transport.response_failures += 1
      evidence.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      if (session) {
        evidence.transport.connections = session.usage.connections
        evidence.transport.logical_messages = session.usage.logicalMessages
        evidence.transport.successful_ledgers = session.usage.successfulLedgers
        session.close()
      }
      evidence.wall_time_ms = Date.now() - startedAtMs
      evidence.completed_at = new Date().toISOString()
      await writeEvidence(outputPath, evidence)
      console.log(`XRPL_WSS_PROBE_EVIDENCE=${JSON.stringify(evidence)}`)
    }
  }, 120_000)
})
