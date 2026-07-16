import 'server-only'

import type { Id } from '../../../convex/_generated/dataModel'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { CreateSkillInput, SkillRecord, SkillRepository, UpdateSkillInput } from './SkillRepository'

type ConvexSkill = Omit<SkillRecord, 'version' | 'enabled'> & {
  enabled?: boolean
  version?: number
}

export class ConvexSkillRepository implements SkillRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async list(args: { userId: string; projectId?: string }): Promise<SkillRecord[]> {
    const rows = await convex.query<ConvexSkill[]>('integrations/skills:list', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
    return rows.map(normalizeSkill)
  }

  async get(args: { skillId: string; userId: string }): Promise<SkillRecord | null> {
    const row = await convex.query<ConvexSkill | null>('integrations/skills:get', {
      ...args,
      skillId: args.skillId as Id<'skills'>,
      serverSecret: this.serverSecret,
    })
    return row ? normalizeSkill(row) : null
  }

  async create(args: CreateSkillInput): Promise<string> {
    const id = await convex.mutation<string>('integrations/skills:create', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!id) throw new Error('Convex skill create returned no id')
    return id
  }

  async update(args: UpdateSkillInput): Promise<void> {
    await convex.mutation('integrations/skills:update', {
      ...args,
      skillId: args.skillId as Id<'skills'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async remove(args: { skillId: string; userId: string }): Promise<void> {
    await convex.mutation('integrations/skills:remove', {
      ...args,
      skillId: args.skillId as Id<'skills'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }
}

function normalizeSkill(row: ConvexSkill): SkillRecord {
  return {
    ...row,
    enabled: row.enabled !== false,
    version: row.version ?? 1,
  }
}
