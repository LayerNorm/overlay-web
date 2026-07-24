import type { PaginationQuery } from '../shared/types'

export interface SkillQuery extends PaginationQuery {
  skillId?: string
  projectId?: string
}
