import 'server-only'

export type SkillKind = 'skill' | 'domain_map'
export type SkillOrigin = 'user' | 'agent' | 'registry'
export type SkillProvenance = {
  kind: 'web' | 'registry' | 'workspace' | 'chat'
  ref: string
  title?: string
  retrievedAt?: number
}

/** Self-verticalization metadata a skill may carry. All optional: older skills have none. */
export type SkillVerticalFields = {
  domain?: string
  kind?: SkillKind
  triggers?: string[]
  origin?: SkillOrigin
  provenance?: SkillProvenance[]
}

export type SkillRecord = SkillVerticalFields & {
  _id: string
  userId: string
  name: string
  description: string
  instructions: string
  enabled: boolean
  version: number
  scope?: 'personal' | 'workspace'
  archivedAt?: number
  archivedFromScope?: 'personal' | 'workspace'
  createdAt: number
  updatedAt: number
}

export type CreateSkillInput = SkillVerticalFields & {
  userId: string
  name: string
  description: string
  instructions: string
  enabled?: boolean
  workspaceId?: string
  scope?: 'personal' | 'workspace'
}

export type UpdateSkillInput = Pick<SkillVerticalFields, 'domain' | 'triggers' | 'provenance'> & {
  skillId: string
  userId: string
  name?: string
  description?: string
  instructions?: string
  enabled?: boolean
  workspaceId?: string
}

export interface SkillRepository {
  list(args: { userId: string; workspaceId?: string; view?: 'personal' | 'workspace' | 'archived' }): Promise<SkillRecord[]>
  get(args: { skillId: string; userId: string; workspaceId?: string }): Promise<SkillRecord | null>
  create(args: CreateSkillInput): Promise<string>
  update(args: UpdateSkillInput): Promise<void>
  remove(args: { skillId: string; userId: string; workspaceId?: string }): Promise<void>
}
