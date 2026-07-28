/**
 * Per-project configuration: which model answers, and which capabilities the
 * agent may reach while working inside the project.
 *
 * Stored as one JSON blob on the project so both backends carry it without a
 * column per capability. Absent or malformed settings always read as "inherit
 * the account default", so a project written before this existed keeps working.
 *
 * The policy here is advisory to the UI and **authoritative at the tool layer**.
 * Phase 4 shipped a boundary that existed only on the retrieval path while the
 * agent's tools stayed unscoped, which let a knowledge base answer from unrelated
 * files. Project scoping must not repeat that: see `applyProjectToolPolicy`.
 */

export type ProjectToolPolicyMode =
  /** Inherit whatever the account allows for the turn. */
  | 'inherit'
  /** Only the listed tool ids may be used, intersected with account limits. */
  | 'allowlist'
  /** Everything the account allows except the listed tool ids. */
  | 'denylist'

export type ProjectSettings = {
  /** Preferred model for project chats when the request does not pick one. */
  preferredModelId?: string
  toolPolicy?: {
    mode: ProjectToolPolicyMode
    toolIds?: string[]
  }
  /** Skill ids usable in this project; omit to inherit all enabled skills. */
  enabledSkillIds?: string[]
  /** MCP server ids usable in this project; omit to inherit all. */
  enabledMcpServerIds?: string[]
  /** Connector slugs usable in this project; omit to inherit all. */
  enabledConnectorSlugs?: string[]
  /** When false, automations cannot be created or run from this project. */
  automationsEnabled?: boolean
  /** Marks the project as a reusable template rather than active work. */
  isTemplate?: boolean
}

export const EMPTY_PROJECT_SETTINGS: ProjectSettings = {}

const TOOL_POLICY_MODES: readonly ProjectToolPolicyMode[] = ['inherit', 'allowlist', 'denylist']
const MAX_LIST_ENTRIES = 200

/**
 * Parses stored settings defensively. Anything unrecognized is dropped rather
 * than trusted, so a hand-edited or partially-migrated row cannot widen access.
 */
export function readProjectSettings(value: unknown): ProjectSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_PROJECT_SETTINGS
  const raw = value as Record<string, unknown>
  const settings: ProjectSettings = {}

  const preferredModelId = optionalString(raw.preferredModelId)
  if (preferredModelId) settings.preferredModelId = preferredModelId

  const policy = raw.toolPolicy
  if (policy && typeof policy === 'object' && !Array.isArray(policy)) {
    const mode = (policy as Record<string, unknown>).mode
    if (typeof mode === 'string' && (TOOL_POLICY_MODES as readonly string[]).includes(mode)) {
      const toolIds = stringList((policy as Record<string, unknown>).toolIds)
      settings.toolPolicy = {
        mode: mode as ProjectToolPolicyMode,
        ...(toolIds.length > 0 ? { toolIds } : {}),
      }
    }
  }

  const skills = stringList(raw.enabledSkillIds)
  if (Array.isArray(raw.enabledSkillIds)) settings.enabledSkillIds = skills
  const mcp = stringList(raw.enabledMcpServerIds)
  if (Array.isArray(raw.enabledMcpServerIds)) settings.enabledMcpServerIds = mcp
  const connectors = stringList(raw.enabledConnectorSlugs)
  if (Array.isArray(raw.enabledConnectorSlugs)) settings.enabledConnectorSlugs = connectors

  if (typeof raw.automationsEnabled === 'boolean') settings.automationsEnabled = raw.automationsEnabled
  if (typeof raw.isTemplate === 'boolean') settings.isTemplate = raw.isTemplate

  return settings
}

/** Drops empty keys so a cleared setting reverts to inheriting, not to an empty allowlist. */
export function normalizeProjectSettings(input: ProjectSettings | undefined): ProjectSettings {
  if (!input) return EMPTY_PROJECT_SETTINGS
  return readProjectSettings(input)
}

/**
 * Narrows the account-allowed tool set to what this project permits.
 *
 * Only ever narrows. A project cannot grant a tool the account or deployment has
 * already withheld, so this is safe to apply after every other gate.
 */
export function applyProjectToolPolicy(
  allowedToolIds: readonly string[],
  settings: ProjectSettings | undefined,
): string[] {
  const policy = settings?.toolPolicy
  if (!policy || policy.mode === 'inherit') return [...allowedToolIds]
  const listed = new Set(policy.toolIds ?? [])
  if (policy.mode === 'allowlist') {
    // An allowlist with no entries means "no optional tools", not "all tools".
    return allowedToolIds.filter((id) => listed.has(id))
  }
  return allowedToolIds.filter((id) => !listed.has(id))
}

/** True when a skill/server/connector may be used inside this project. */
export function isProjectResourceEnabled(
  enabledIds: readonly string[] | undefined,
  id: string,
): boolean {
  // Undefined means inherit everything; an explicit empty list means none.
  if (enabledIds === undefined) return true
  return enabledIds.includes(id)
}

export function projectAutomationsEnabled(settings: ProjectSettings | undefined): boolean {
  return settings?.automationsEnabled !== false
}

/**
 * Settings that carry to a duplicate or template instantiation. Deliberately
 * excludes nothing today, but exists as the single place to decide what is
 * configuration versus private state as the shape grows.
 */
export function copyableProjectSettings(settings: ProjectSettings | undefined): ProjectSettings {
  const source = normalizeProjectSettings(settings)
  const { isTemplate: _isTemplate, ...rest } = source
  return rest
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of value) {
    const id = optionalString(entry)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_LIST_ENTRIES) break
  }
  return out
}
