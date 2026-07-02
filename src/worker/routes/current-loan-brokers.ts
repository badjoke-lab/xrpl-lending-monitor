import type { Hono } from 'hono'

import { resolveRuntimeConfig } from '../../shared/runtime-config'
import type { Bindings } from '../env'
import { getActiveSnapshot } from '../repositories/core-api-repository'
import {
  getCurrentLoanBrokerById,
  listCurrentLoanBrokers,
  type LoanBrokerSort,
} from '../repositories/current-state-loan-broker-reader'
import { CurrentStateObjectReadError } from '../repositories/current-state-object-reader'
import { getCurrentEpoch } from '../repositories/network-status-repository'
import {
  serializeAvailableLoanBrokerCollection,
  serializeLoanBrokerDetail,
  serializeUnavailableEntityCollection,
  serializeUnavailableEntityDetail,
} from '../serializers/core-api'
import { registerCurrentLoanRoutes } from './current-loans'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100
const MAX_QUERY_LENGTH = 128
const MAX_CURSOR_LENGTH = 1024

function parseLimit(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_LIMIT
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT ? parsed : null
}

function parseSort(value: string | undefined): LoanBrokerSort | null {
  if (value === undefined) return 'id_asc'
  return value === 'id_asc' || value === 'id_desc' ? value : null
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
      message: 'The active current-state snapshot or its Vault relationships could not be verified for public reads.',
    },
  }
}

export function registerCurrentLoanBrokerRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/loan-brokers', async (context) => {
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

    const [epoch, snapshot] = await Promise.all([
      getCurrentEpoch(context.env.DB),
      getActiveSnapshot(context.env.DB),
    ])
    if (!snapshot || !context.env.CURRENT_STATE) {
      return context.json(
        serializeUnavailableEntityCollection({
          kind: 'loan_brokers',
          epoch,
          snapshot,
          page: { limit },
        }),
      )
    }

    try {
      const result = await listCurrentLoanBrokers(context.env.CURRENT_STATE, snapshot, {
        limit,
        sort,
        cursor,
        query: query || undefined,
      })
      return context.json(
        serializeAvailableLoanBrokerCollection({
          epoch,
          snapshot,
          result,
          page: { limit },
          sort,
          query: query || undefined,
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

  app.get('/api/loan-brokers/:brokerId', async (context) => {
    resolveRuntimeConfig(context.env)
    const brokerId = context.req.param('brokerId').toUpperCase()
    if (!/^[A-F0-9]{64}$/.test(brokerId)) {
      return context.json(
        { error: 'invalid_identifier', message: 'brokerId must be a 64-character hexadecimal ID' },
        400,
      )
    }

    const [epoch, snapshot] = await Promise.all([
      getCurrentEpoch(context.env.DB),
      getActiveSnapshot(context.env.DB),
    ])
    if (!snapshot || !context.env.CURRENT_STATE) {
      return context.json(
        serializeUnavailableEntityDetail({ kind: 'loan_broker', epoch, snapshot }),
      )
    }

    try {
      const record = await getCurrentLoanBrokerById(
        context.env.CURRENT_STATE,
        snapshot,
        brokerId,
      )
      if (!record) {
        return context.json(
          { error: 'not_found', kind: 'loan_broker', id: brokerId, snapshot_id: snapshot.id },
          404,
        )
      }
      return context.json(serializeLoanBrokerDetail({ epoch, snapshot, record }))
    } catch (error) {
      if (error instanceof CurrentStateObjectReadError) {
        const response = publicReadError(error)
        return context.json(response.body, response.status)
      }
      throw error
    }
  })

  registerCurrentLoanRoutes(app)
}
