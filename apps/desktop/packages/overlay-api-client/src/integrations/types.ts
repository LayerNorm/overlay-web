import type { PaginationQuery } from '../shared/types'

export interface IntegrationQuery extends PaginationQuery {
  action?: 'search' | string
  slug?: string
  q?: string
}
