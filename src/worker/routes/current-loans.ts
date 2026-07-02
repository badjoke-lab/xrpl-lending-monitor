import type { Hono } from 'hono'

import { resolveRuntimeConfig } from '../../shared/runtime-config'
import type { LoanOnLedgerStatus } from '../../domain/lending/current-projections'
import type { Bindings } from '../env'
import { getActiveSnapshot } from '../repositories/core-api-repository'
import {
  getCurrentLoanById,
  listCurrentLoans,
  type LoanScheduleStatus,
  type LoanSort,
} from '../repositories/current-state-loan-reader'
import { CurrentStateObjectReadError } from '../repositories/current-state-object-reader'
import { getCurrentEpoch } from '../repositories/network-status-repository'
import {
  serializeUnavailableEntityCollection,
  serializeUnavailableEntityDetail,
} from '../serializers/core-api'
import {
  serializeAvailableLoanCollection,
  serializeLoanDetail,
} from '../serializers/current-loans'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100
const MAX_QUERY_LENGTH = 128
const MAX_CURSOR_LENGTH = 1024
const RIPPLE_EPOCH_UNIX_SECONDS = 946_684_800

function parseLimit(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_LIMIT
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT ? parsed : null
}

function parseSort(value: string | undefined): LoanSort | null {
  if (value === undefined) return 'id_asc'
  return value === 'id_asc' || value === 'id_desc' ? value : null
}

function parseOnLedgerStatus(value: string | undefined): LoanOnLedgerStatus | undefined | null {
  if (value === undefined) return undefined
  return value === 'active' || value === 'impaired' || value === 'defaulted' ? value : null
}

function parseScheduleStatus(value: string | undefined): LoanScheduleStatus | undefined | null {
  if (value === undefined) return undefined
  return value === 'current' ||
    value === 'payment_due' ||
    value === 'default_eligible' ||
    value === 'complete' ||
    value === 'unknown'
    ? value
    : null
}

function currentRippleTime(): number {
  return Math.floor(Date.now() / 1000) - RIPPLE_EPOCH_UNIX_SECONDS
}

function publicReadError(error: CurrentStateObjectReadError) {
  if (error.code === 'invalid_cursor') {
    return {
      status: 400 as const,
      body: { error: 'invalid_cursor', message: error.message },
    }
  }
  return {
    status: 503 as const,
    body: {
      error: 'current_state_unavailable',
      code: error.code,
      message: 'The active current-state snapshot or its Loan relationships could not be verified for public reads.',
    },
  }
}

export function registerCurrentLoanRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/loans', async (context) => {
    resolveRuntimeConfig(context.env)
    const limit = parseLimit(context.req.query('limit'))
    if (limit === null) {
      return context.json(
        { error: 'invalid_limit', message: `limit must be an integer from 1 to ${MAX_LIMIT}` },
        400,
      )
    }
    const sort = parseSort(context.req.query('sort'))
    if (sort === null) {
      return context.json({ error: 'invalid_sort', message: 'sort must be id_asc or id_desc' }, 400)
    }
    const query = context.req.query('q')?.trim()
    if (query && query.length > MAX_QUERY_LENGTH) {
      return context.json(
        { error: 'invalid_query', message: `q must be at most ${MAX_QUERY_LENGTH} characters` },
        400,
      )
    }
    const cursor = context.req.query('cursor')
    if (cursor && cursor.length > MAX_CURSOR_LENGTH) {
      return context.json(
        { error: 'invalid_cursor', message: `cursor must be at most ${MAX_CURSOR_LENGTH} characters` },
        400,
      )
    }
    const onLedgerStatus = parseOnLedgerStatus(context.req.query('on_ledger_status'))
    if (onLedgerStatus === null) {
      return context.json(
        { error: 'invalid_filter', message: 'on_ledger_status must be active, impaired, or defaulted' },
        400,
      )
    }
    const scheduleStatus = parseScheduleStatus(context.req.query('schedule_status'))
    if (scheduleStatus === null) {
      return context.json(
        {
          error: 'invalid_filter',
          message: 'schedule_status must be current, payment_due, default_eligible, complete, or unknown',
        },
        400,
      )
    }

    const [epoch, snapshot] = await Promise.all([
      getCurrentEpoch(context.env.DB),
      getActiveSnapshot(context.env.DB),
    ])
    if (!snapshot || !context.env.CURRENT_STATE) {
      return context.json(
        serializeUnavailableEntityCollection({
          kind: 'loans',
          epoch,
          snapshot,
          page: { limit },
        }),
      )
    }

    try {
      const result = await listCurrentLoans(context.env.CURRENT_STATE, snapshot, {
        limit,
        sort,
        cursor,
        query: query || undefined,
        onLedgerStatus,
        scheduleStatus,
        evaluatedAtRippleTime: currentRippleTime(),
      })
      return context.json(
        serializeAvailableLoanCollection({
          epoch,
          snapshot,
          result,
          page: { limit },
          sort,
          query: query || undefined,
          onLedgerStatus,
          scheduleStatus,
        }),
      )
    } catch (error) {
      if (error instanceof CurrentStateObjectReadError) {
        const response = publicReadError(error)
        return context.json(response.body, response.status)
      }
      throw error
    }
  })

  app.get('/api/loans/:loanId', async (context) => {
    resolveRuntimeConfig(context.env)
    const loanId = context.req.param('loanId').toUpperCase()
    if (!/^[A-F0-9]{64}$/.test(loanId)) {
      return context.json(
        { error: 'invalid_identifier', message: 'loanId must be a 64-character hexadecimal ID' },
        400,
      )
    }

    const [epoch, snapshot] = await Promise.all([
      getCurrentEpoch(context.env.DB),
      getActiveSnapshot(context.env.DB),
    ])
    if (!snapshot || !context.env.CURRENT_STATE) {
      return context.json(
        serializeUnavailableEntityDetail({ kind: 'loan', epoch, snapshot }),
      )
    }

    try {
      const record = await getCurrentLoanById(
        context.env.CURRENT_STATE,
        snapshot,
        loanId,
        currentRippleTime(),
      )
      if (!record) {
        return context.json(
          { error: 'not_found', kind: 'loan', id: loanId, snapshot_id: snapshot.id },
          404,
        )
      }
      return context.json(serializeLoanDetail({ epoch, snapshot, record }))
    } catch (error) {
      if (error instanceof CurrentStateObjectReadError) {
        const response = publicReadError(error)
        return context.json(response.body, response.status)
      }
      throw error
    }
  })
}
