import type { ResourceView } from '@overlay/app-core'
import type { PaginationQuery } from '../shared/types'

export interface SkillQuery extends PaginationQuery {
  skillId?: string
  /** Personal, workspace, or archived. Omitted means everything active the caller can see. */
  view?: ResourceView
}
