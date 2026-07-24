import type { PaginationQuery } from '../shared/types'

export interface AutomationQuery extends PaginationQuery {
  automationId?: string
  includeRuns?: boolean
}
