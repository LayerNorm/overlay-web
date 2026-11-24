import { MIN, ROOMS, agentRoom, message, text, tool } from '../../fixtures/rooms'
import { VIEWER_PRINCIPAL } from '../../fixtures/agents'
import { SLACK_ORIGINS } from './origin'

export const SLACK_GROWTH_THREAD = 'k17convslackgrowth00000000000000'
export const SLACK_DM_THREAD = 'k17convslackacme0000000000000000'

const GROWTH_REPLY = `Trial signups fell **18%** week over week (412 → 338). The drop is almost all from one place:

| Source | Last week | This week | Change |
| --- | ---: | ---: | ---: |
| Pricing page | 196 | 121 | −38% |
| Blog | 118 | 121 | +3% |
| Direct | 98 | 96 | −2% |

The pricing page started losing visitors on **Nov 14**, the day the new layout shipped. On phones, the *Start trial* button now sits below the comparison table, and mobile conversion on that page went from 4.1% to 2.3%.

I asked **Atlas** to move the button above the table on small screens. I'll post here when the fix is live.`

const DANA_REPLY = `Yes, that's the same change. Mobile visitors who reach the table scroll past it 62% of the time, so most never see the button. Desktop conversion didn't change.`

/** A #growth thread and a Slack DM, both started in Slack and owned by the Workspace Overlay. */
export function installSlackFixtures() {
  SLACK_ORIGINS[SLACK_GROWTH_THREAD] = { kind: 'channel', channel: '#growth', permalink: 'https://slack.com/' }
  SLACK_ORIGINS[SLACK_DM_THREAD] = { kind: 'dm', channel: 'Direct message', permalink: 'https://slack.com/' }

  ROOMS.unshift(
    agentRoom(SLACK_GROWTH_THREAD, 'agent_overlay', 'Why did trial signups drop?', 4 * MIN, 'ready', (room, agent) => [
      message(room, 'p_jonah', 40 * MIN, '@Overlay why did trial signups drop last week?'),
      message(room, agent, 37 * MIN, GROWTH_REPLY, [
        tool('s1', 'search_files', { query: 'weekly signups dashboard' }, { results: 3 }),
        tool('s2', 'ask_agent', { agent: 'Atlas', task: 'Move Start trial above the comparison table on small screens' }, { success: true }),
        text(GROWTH_REPLY),
      ]),
      message(room, 'p_slack_dana', 12 * MIN, 'Could the pricing page change explain the mobile drop too?', undefined, {
        importedAuthorName: 'Dana Reyes',
        importedAuthorStatus: 'not_invited',
      } as Record<string, unknown>),
      message(room, agent, 11 * MIN, DANA_REPLY),
    ]),
    agentRoom(SLACK_DM_THREAD, 'agent_overlay', 'Prep for the Acme renewal call', 2 * 60 * MIN, 'completed', (room, agent) => [
      message(room, VIEWER_PRINCIPAL, 130 * MIN, 'Prep me for the Acme renewal call at 3'),
      message(room, agent, 126 * MIN, 'Acme renews on Dec 1 at $48k/year. Usage is up 22% since August, and their open ask is SSO. Your personal agent pulled the last three emails with Priya at Acme: they want a two-year term if SSO ships this quarter. I sent the full brief only to you.'),
    ]),
  )
}
