import type { PaginationQuery } from '../shared/types'

export interface McpServerQuery extends PaginationQuery {
  mcpServerId?: string
}
