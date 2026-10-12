import type { ResourceView } from '@overlay/app-core'
import type { PaginationQuery } from '../shared/types'

export interface AutomationQuery extends PaginationQuery {
  automationId?: string
  includeRuns?: boolean
  view?: ResourceView
}
