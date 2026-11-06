export const SKILL_FIELD_LIMITS = { name: 500, description: 10_000, instructions: 200_000 } as const

export interface SkillFieldValues { name: string; description: string; instructions: string; enabled: boolean }

export function normalizeSkillFields<T extends SkillFieldValues>(values: T): SkillFieldValues | null {
  const result = { name: values.name.trim(), description: values.description.trim(), instructions: values.instructions.trim(), enabled: values.enabled }
  if (!result.name || !result.description || !result.instructions) return null
  if (result.name.length > SKILL_FIELD_LIMITS.name || result.description.length > SKILL_FIELD_LIMITS.description
    || result.instructions.length > SKILL_FIELD_LIMITS.instructions) return null
  return result
}
