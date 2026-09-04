import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'

/** Static agents for the logged-out product preview (no backend). */
export const SHOWCASE_AGENTS: WorkspaceAgentDirectoryItem[] = [
  ['showcase-research', 'Research partner', 'Finds primary evidence and challenges assumptions.', '#2563eb'],
  ['showcase-writer', 'Launch writer', 'Turns product decisions into clear customer-facing drafts.', '#7c3aed'],
  ['showcase-analyst', 'Product analyst', 'Synthesizes feedback, metrics, and experiment results.', '#059669'],
].map(([id, name, description, avatarColor], index) => ({
  id, workspaceId: 'showcase-acme', principalId: `${id}-principal`, name, description,
  instructions: description, harness: 'overlay', modelId: 'openrouter/free', avatarColor,
  allowedToolIds: [], invocationPolicy: 'mention', visibility: 'workspace',
  platforms: ['slack', 'msteams'] as Array<'slack' | 'msteams'>,
  createdByPrincipalId: 'showcase-divyansh',
  createdAt: Date.parse('2026-07-29T18:00:00.000Z') + index, updatedAt: Date.parse('2026-07-29T18:00:00.000Z') + index,
  teamIds: [], roomCount: 2 + index,
}))

const SHOWCASE_ARCHIVED: WorkspaceAgentDirectoryItem[] = [
  ['showcase-retired-research', 'Retired researcher', 'Former evidence-gathering agent.', '#64748b', 'workspace'],
  ['showcase-retired-scout', 'Retired scout', 'Former personal drafting agent.', '#d97706', 'creator'],
].map(([id, name, description, avatarColor, visibility], index) => ({
  id, workspaceId: 'showcase-acme', principalId: `${id}-principal`, name, description,
  instructions: description, harness: 'overlay', modelId: 'openrouter/free', avatarColor,
  allowedToolIds: [], invocationPolicy: 'mention', visibility,
  platforms: (visibility === 'creator' ? [] : ['slack', 'msteams']) as Array<'slack' | 'msteams'>,
  createdByPrincipalId: 'showcase-divyansh',
  createdAt: Date.parse('2026-06-01T18:00:00.000Z') + index, updatedAt: Date.parse('2026-06-02T18:00:00.000Z') + index,
  archivedAt: Date.parse('2026-07-01T18:00:00.000Z') + index,
  teamIds: [], roomCount: 0,
})) as WorkspaceAgentDirectoryItem[]

export const SHOWCASE_ALL_AGENTS: WorkspaceAgentDirectoryItem[] = [...SHOWCASE_AGENTS, ...SHOWCASE_ARCHIVED]
