import 'server-only'

export type SkillRecord = {
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

export type CreateSkillInput = {
  userId: string
  name: string
  description: string
  instructions: string
  enabled?: boolean
  workspaceId?: string
  scope?: 'personal' | 'workspace'
}

export type UpdateSkillInput = {
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
