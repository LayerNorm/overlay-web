import type { ResourceView } from '@overlay/app-core'
import type { PaginationQuery } from '../shared/types'

export interface McpServerQuery extends PaginationQuery {
  mcpServerId?: string
  view?: ResourceView
}
