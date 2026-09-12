import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'

/** Static agents for the logged-out product preview (no backend). */
export const SHOWCASE_AGENTS: WorkspaceAgentDirectoryItem[] = [
  ['showcase-research', 'Research partner', 'Finds primary evidence and challenges assumptions.', '#2563eb', 'droplet'],
  ['showcase-writer', 'Launch writer', 'Turns product decisions into clear customer-facing drafts.', '#7c3aed', 'cloud'],
  ['showcase-analyst', 'Product analyst', 'Synthesizes feedback, metrics, and experiment results.', '#059669', 'hexagon'],
].map(([id, name, description, avatarColor, avatarShape], index) => ({
  id, workspaceId: 'showcase-acme', principalId: `${id}-principal`, name, description,
  instructions: description, harness: 'overlay', modelId: 'openrouter/free', avatarColor,
  avatarShape: avatarShape as WorkspaceAgentDirectoryItem['avatarShape'],
  allowedToolIds: [], invocationPolicy: 'mention', visibility: 'workspace',
  createdByPrincipalId: 'showcase-divyansh',
  createdAt: Date.parse('2026-07-29T18:00:00.000Z') + index, updatedAt: Date.parse('2026-07-29T18:00:00.000Z') + index,
  teamIds: [], roomCount: 2 + index,
}))
