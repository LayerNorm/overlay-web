import { SKILL_FIELD_LIMITS } from '@/shared/integrations/native-skill-fields'

export const SKILL_INVALID_MESSAGE = `Add a name, description and instructions. Names can be up to ${SKILL_FIELD_LIMITS.name} characters, descriptions up to ${SKILL_FIELD_LIMITS.description.toLocaleString('en-US')} and instructions up to ${SKILL_FIELD_LIMITS.instructions.toLocaleString('en-US')}. Your draft is preserved.`

const ACCESS_CODES = ['SKILL_ACCESS_DENIED', 'SKILL_SCOPE_DENIED', 'WORKSPACE_ACCESS_DENIED', 'CAPABILITY_ACCESS_DENIED', 'UNAUTHENTICATED']

// Production Convex redacts plain error text, so unknown failures fall back to neutral copy.
export function nativeSkillErrorMessage(error: unknown, verb: 'create' | 'update'): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (message.includes('INVALID_SKILL')) return SKILL_INVALID_MESSAGE
  if (message.includes('SKILL_REVISION_CONFLICT')) return 'This skill changed elsewhere. Your draft is preserved. Close and reopen to load the latest version.'
  if (message.includes('RATE_LIMITED')) return `Too many skill changes. Wait a few minutes and try again. Your draft is preserved.`
  if (ACCESS_CODES.some(code => message.includes(code))) return `Could not ${verb} this skill because your access changed. Your draft is preserved.`
  return `Could not ${verb} this skill. Try again. Your draft is preserved.`
}
