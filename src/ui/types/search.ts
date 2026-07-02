import type { Provenance } from './api'

export type SearchResultKind = 'transaction' | 'object_change' | 'archived_object' | 'loan_lifecycle'

export interface SearchResultRecord {
  kind: SearchResultKind
  epoch_id: string
  ledger_index: number | null
  transaction_hash: string | null
  object_type: string | null
  object_id: string | null
  loan_id: string | null
  provenance: Provenance
}

export interface SearchResponse {
  network: 'devnet'
  query: string
  data: SearchResultRecord[]
  page: {
    limit: number
    next_cursor: null
  }
}
