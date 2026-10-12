import 'server-only'

import { unwrapPaginatedData } from '@/shared/api/pagination'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getInternalApiBaseUrl } from '@/server/web/app-url'
import { callInternalApiGet } from '@/server/tools/tools/internal-api'
import type { McpPrompt, McpPromptContent, McpPromptSource } from './mcp-jsonrpc'

type Skill = { _id?: string; id?: string; name: string; description?: string; instructions: string; enabled?: boolean }

/** A prompt name clients accept everywhere (Claude turns it into `/mcp__overlay__<name>`). */
export function skillPromptName(skill: Pick<Skill, 'name'>): string {
  const slug = skill.name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return slug || 'skill'
}

/** Prompt names for a set of skills; two skills that slug alike get a numbered suffix so none is hidden. */
export function skillPrompts(skills: readonly Skill[]): Array<McpPrompt & { text: string }> {
  const seen = new Map<string, number>()
  return skills.filter((skill) => skill.enabled !== false && skill.instructions.trim()).map((skill) => {
    const base = skillPromptName(skill)
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return {
      name: count === 1 ? base : `${base}-${count}`,
      description: skill.description?.trim() || `The "${skill.name}" skill from Overlay`,
      text: `Follow this Overlay skill, "${skill.name}".\n\n${skill.instructions.trim()}`,
    }
  })
}

/**
 * The person's Overlay skills as MCP prompts, so any client that shows prompts (Claude Desktop and
 * Claude Code as slash commands, Cursor) can use them without Overlay writing into the client's own
 * skill folders. Read-only: a prompt is text the person chooses to run.
 */
export function overlaySkillPrompts(args: { userId: string; workspaceId: string }): McpPromptSource {
  const load = async () => {
    const res = await callInternalApiGet(
      '/api/v1/skills?limit=100', undefined, getInternalApiBaseUrl(), undefined,
      getInternalApiSecret(), args.userId, args.workspaceId,
    )
    return res.ok ? skillPrompts(unwrapPaginatedData<Skill>(await res.json())) : []
  }
  return {
    list: async () => (await load()).map(({ name, description }) => ({ name, description })),
    get: async (name): Promise<McpPromptContent | null> => {
      const prompt = (await load()).find((candidate) => candidate.name === name)
      return prompt ? { description: prompt.description, text: prompt.text } : null
    },
  }
}
