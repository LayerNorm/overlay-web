import type { ResourceView } from '@overlay/app-core'
import type { PaginationQuery } from '../shared/types'

export interface IntegrationQuery extends PaginationQuery {
  action?: 'search' | string
  slug?: string
  q?: string
  /** `workspace` lists the workspace's own connector accounts. */
  view?: ResourceView
}
