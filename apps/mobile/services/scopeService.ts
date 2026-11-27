import { appJson } from './appApi'

/** Resources that move between Personal and Workspace through `POST /api/v1/scope`. Notes and outputs are `files`. */
export type ScopedResource = 'files' | 'skills' | 'mcp-servers' | 'automations' | 'work'

/**
 * Moves a personal item into the workspace. Moves are one-way: nothing moves
 * back to Personal (`internal/develop/workspace-and-personal.md`).
 */
export async function moveToWorkspace(resource: ScopedResource, id: string, options: { withAgent?: boolean } = {}): Promise<void> {
  await appJson('/api/v1/scope', {
    method: 'POST',
    json: { resource, id, action: 'move', to: 'workspace', ...(options.withAgent ? { withAgent: true } : {}) },
  })
}
