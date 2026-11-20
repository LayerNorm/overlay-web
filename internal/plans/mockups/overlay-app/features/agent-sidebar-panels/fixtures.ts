import { defineQueries } from '../../fixtures/convex'
import { DAY, MIN, ROOMS, agentRoom, message, text, tool } from '../../fixtures/rooms'
import { AGENTS, PEOPLE, VIEWER_PRINCIPAL } from '../../fixtures/agents'

export const RELAY_THREAD_ID = 'k17convrelaytest0000000000000000'

/**
 * The owner's multi-agent relay test. An earlier response has settled and assigned work (so its assignment row and
 * response controls show); the latest is mid-run, with the workspace Overlay waiting on Quill.
 */
export function installAgentWorkingFixtures() {
  // The viewer's own chief of staff inside this workspace: pinned beside the workspace Overlay in the Workspace tab.
  const mine = { ...AGENTS.find((entry) => entry.id === 'agent_chief')!, id: 'agent_my_chief', principalId: 'p_my_chief', name: 'My Overlay', chiefScope: 'workspace', visibility: 'workspace', isDefault: false, avatarShape: 'squircle', avatarColor: '#8b5cf6', description: 'Your chief of staff in Northwind: your threads, assignments and drafts in this workspace.' }
  AGENTS.splice(2, 0, mine)
  PEOPLE.push({ principalId: mine.principalId, type: 'agent', userId: null, displayName: mine.name, agentId: mine.id, avatarColor: mine.avatarColor, avatarShape: mine.avatarShape, isDefault: false, role: 'member' })
  ROOMS.push(agentRoom('k17convmychiefweek00000000000000', 'agent_my_chief', 'My week in Northwind', 40 * MIN, 'idle', (room, chief) => [
    message(room, VIEWER_PRINCIPAL, 42 * MIN, 'what do I owe people in this workspace this week?'),
    message(room, chief, 40 * MIN, 'Two things: the pricing review for Priya on Wednesday and the launch copy sign-off for Sam on Friday.'),
  ]))
  let settledId = ''
  ROOMS.unshift(agentRoom(RELAY_THREAD_ID, 'agent_overlay', 'Relay test through the personal Overlay', 1 * MIN, 'working', (room, chief) => {
    const settled = message(room, chief, 9 * MIN, '', [
      text('I\'ll split the launch prep across the team.'),
      tool('s1', 'list_agents', {}, { agents: [{ name: 'Scout' }, { name: 'Atlas' }] }),
      text('Scout is pulling the competitor pricing pages and Atlas is checking the release branch. I\'ll post both results here when they are back.'),
    ])
    settledId = settled.id
    return [
      message(room, VIEWER_PRINCIPAL, 10 * MIN, 'can you get the launch prep going? pricing research and a check of the release branch.'),
      settled,
      message(room, VIEWER_PRINCIPAL, 2 * MIN, 'i want to test something. you are the workspace overlay. can you ask my personal overlay to tell you to ask quill what it most recently did and then relay that to you?'),
      message(room, chief, 1 * MIN, '', [
        text('I\'ll check which agents are available, then pass the request along.'),
        tool('r1', 'list_agents', {}, { agents: [{ name: 'Overlay' }, { name: 'Quill' }] }),
        text('I found your personal Overlay and Quill. I\'ll ask your personal Overlay first.'),
        tool('r2', 'ask_agent', { agent: 'Overlay', message: 'Divyansh is testing how agents relay messages. What should I ask next?' }, { success: true, reply: 'Ask Quill what it most recently did.' }),
        text('Your personal Overlay sent back the instruction. I\'ll ask Quill.'),
        tool('r3', 'ask_agent', { agent: 'Quill', message: 'What did you most recently do? Reply in one or two sentences.' }, undefined, 'input-available'),
      ], { status: 'generating' }),
    ]
  }))
  // Enough older threads that the workspace Overlay and Atlas each pass the five a sidebar agent shows before "Load more".
  const older: Array<[string, string, string, number]> = [
    ['k17convoverlayolder1000000000000', 'agent_overlay', 'Board update draft', 2],
    ['k17convoverlayolder2000000000000', 'agent_overlay', 'Hiring plan for Q1', 4],
    ['k17convoverlayolder3000000000000', 'agent_overlay', 'Customer advisory board notes', 6],
    ['k17convoverlayolder4000000000000', 'agent_overlay', 'Offsite agenda', 9],
    ['k17convatlasolder100000000000000', 'agent_atlas', 'Flaky checkout test', 6],
    ['k17convatlasolder200000000000000', 'agent_atlas', 'Bump the Stripe SDK', 8],
    ['k17convatlasolder300000000000000', 'agent_atlas', 'Speed up the CI cache', 10],
    ['k17convatlasolder400000000000000', 'agent_atlas', 'Dark mode contrast fixes', 12],
  ]
  for (const [id, agentId, title, days] of older) {
    ROOMS.push(agentRoom(id, agentId, title, days * DAY, 'completed', (room, agent) => [
      message(room, VIEWER_PRINCIPAL, days * DAY + 2 * MIN, title.toLowerCase()),
      message(room, agent, days * DAY, 'Done. The summary is above.'),
    ]))
  }
  defineQueries({
    'collaboration/agentAssignments:forConversation': ({ conversationId }: Record<string, unknown>) => ({
      parent: null,
      assignments: conversationId !== RELAY_THREAD_ID ? [] : [
        { assignmentId: 'asg_scout', title: 'Competitor pricing pages', agentName: 'Scout', agentId: 'agent_scout', agent: { avatarShape: 'blob', avatarColor: '#7c8db5' }, status: 'completed', conversationId: 'k17convscoutpricing000000000000', scope: 'workspace', messageId: settledId },
        { assignmentId: 'asg_atlas', title: 'Check the release branch', agentName: 'Atlas', agentId: 'agent_atlas', agent: { avatarShape: 'hexagon', avatarColor: '#5b8c6e' }, status: 'running', conversationId: 'k17convatlasrelease000000000000', scope: 'workspace', messageId: settledId },
      ],
    }),
  })
}
