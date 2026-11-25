/** Sample data for the Workspace and Personal mockup: a renamed Personal Chief, a creator-only agent and one-way moves. */
import { defineQueries, queryResolver } from '../../fixtures/convex'
import { AGENTS, PEOPLE, VIEWER_PRINCIPAL } from '../../fixtures/agents'
import { MIN, ROOMS, agentRoom, message } from '../../fixtures/rooms'
import { PERSONAL_CHIEF_NAME, PROPOSED, moved } from './model'

const USER = 'user_mercedes'
export const CHIEF_THREAD_ID = 'k17convchiefweek'.padEnd(32, '0')

const WEEK_PLAN = `Here’s your week.

- **Tuesday:** reply to Sam about the pricing copy. Northwind’s launch plan needs your sign-off by Friday.
- **Wednesday, 2–4 pm:** blocked for the investor update draft in your Personal files.
- **Thursday:** board meeting at 10. I put the three numbers from this week’s metrics digest at the top of your notes.

Nothing here was shared with the workspace.`

type Row = Record<string, unknown> & { _id: string; scope?: string }

/** Wraps a list query so an item moved during this visit shows in Workspace mode, not Personal. */
function withMoves(name: string) {
  const original = queryResolver(name)
  if (!original) return
  defineQueries({
    [name]: (args: Record<string, unknown>) => {
      if (args.view === 'archived') return original(args)
      const all = original({ ...args, view: undefined })
      if (!Array.isArray(all)) return all
      const rows = (all as Row[]).map((row) => ({ ...row, userId: row.userId ?? USER, scope: moved.has(row._id) ? 'workspace' : row.scope }))
      return args.view ? rows.filter((row) => row.scope === args.view) : rows
    },
  })
}

export function installWorkspacePersonalFixtures() {
  // Scout is creator-only, so it is a Personal agent; Atlas is visible to the workspace, so it is a Workspace agent.
  const scout = AGENTS.find((agent) => agent.id === 'agent_scout')
  if (scout) scout.visibility = 'creator'
  if (!PROPOSED) return
  // P3: the personal chief has its own name and avatar; "Overlay" is the workspace's chief only.
  const chief = AGENTS.find((agent) => agent.agentRole === 'personal_chief')
  if (chief) {
    const look = { isDefault: false, avatarShape: 'squircle', avatarColor: '#6d8a96' }
    Object.assign(chief, { name: PERSONAL_CHIEF_NAME, ...look })
    const person = PEOPLE.find((entry) => entry.agentId === chief.id)
    if (person) Object.assign(person, { displayName: PERSONAL_CHIEF_NAME, ...look })
  }
  ROOMS.push(agentRoom(CHIEF_THREAD_ID, 'agent_chief', 'Plan my week', 25 * MIN, 'completed', (room, agent) => [
    message(room, VIEWER_PRINCIPAL, 30 * MIN, 'Plan my week around the board meeting and the launch.'),
    message(room, agent, 25 * MIN, WEEK_PLAN),
  ]))
  withMoves('files/browse:list')
  withMoves('automations/browse:list')
  withMoves('integrations/skillsBrowse:list')
  withMoves('integrations/mcpBrowse:servers')
}
