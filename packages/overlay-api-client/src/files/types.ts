import type { PaginationQuery } from '../shared/types'

export interface FileQuery extends PaginationQuery {
  fileId?: string
  kind?: 'folder' | 'note' | 'upload' | 'output' | string
  parentId?: string | null
  conversationId?: string
  outputType?: string
  page?: boolean
  type?: string
  summary?: boolean
}
