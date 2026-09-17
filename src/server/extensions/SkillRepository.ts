import 'server-only'

export type SkillRecord = {
  _id: string
  userId: string
  name: string
  description: string
  instructions: string
  enabled: boolean
  version: number
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
  list(args: { userId: string; workspaceId?: string }): Promise<SkillRecord[]>
  get(args: { skillId: string; userId: string; workspaceId?: string }): Promise<SkillRecord | null>
  create(args: CreateSkillInput): Promise<string>
  update(args: UpdateSkillInput): Promise<void>
  remove(args: { skillId: string; userId: string; workspaceId?: string }): Promise<void>
}
