import type { PaginationQuery } from '../shared/types'

export interface FileQuery extends PaginationQuery {
  fileId?: string
  projectId?: string | null
  kind?: 'folder' | 'note' | 'upload' | 'output' | string
  parentId?: string | null
  conversationId?: string
  outputType?: string
  page?: boolean
  type?: string
  summary?: boolean
}
