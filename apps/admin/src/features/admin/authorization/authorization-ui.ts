import type { AuthorizationCapabilityDefinition, AuthorizationGroup, AuthorizationRole } from '@overlay/authz-contracts'

export type CapabilitySection = {
  category: AuthorizationCapabilityDefinition['category']
  label: string
  capabilities: AuthorizationCapabilityDefinition[]
}

export function groupCapabilityDefinitions(definitions: readonly AuthorizationCapabilityDefinition[]): CapabilitySection[] {
  const sections = new Map<AuthorizationCapabilityDefinition['category'], AuthorizationCapabilityDefinition[]>()
  for (const definition of definitions) {
    const existing = sections.get(definition.category) ?? []
    existing.push(definition)
    sections.set(definition.category, existing)
  }
  return [...sections.entries()].map(([category, capabilities]) => ({
    category,
    label: category.charAt(0).toUpperCase() + category.slice(1),
    capabilities,
  }))
}

export function roleIsEditable(role: AuthorizationRole | null | undefined): boolean {
  return Boolean(role && !role.isSystem && !role.archivedAt)
}

export function groupIsEditable(group: AuthorizationGroup | null | undefined): boolean {
  return Boolean(group && group.source === 'local' && !group.archivedAt)
}

export function authorizationDescription(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}
