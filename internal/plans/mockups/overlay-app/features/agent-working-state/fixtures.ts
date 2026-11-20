import { MIN, ROOMS, agentRoom, message, text, tool } from '../../fixtures/rooms'
import { VIEWER_PRINCIPAL } from '../../fixtures/agents'

export const RELAY_THREAD_ID = 'k17convrelaytest0000000000000000'

/** The owner's multi-agent relay test, mid-run: the workspace Overlay is waiting on Quill through the personal Overlay. */
export function installAgentWorkingFixtures() {
  ROOMS.unshift(agentRoom(RELAY_THREAD_ID, 'agent_overlay', 'Relay test through the personal Overlay', 1 * MIN, 'working', (room, chief) => [
    message(room, VIEWER_PRINCIPAL, 2 * MIN, 'i want to test something. you are the workspace overlay. can you ask my personal overlay to tell you to ask quill what it most recently did and then relay that to you?'),
    message(room, chief, 1 * MIN, '', [
      text('I\'ll check which agents are available, then pass the request along.'),
      tool('r1', 'list_agents', {}, { agents: [{ name: 'Overlay' }, { name: 'Quill' }] }),
      text('I found your personal Overlay and Quill. I\'ll ask your personal Overlay first.'),
      tool('r2', 'ask_agent', { agent: 'Overlay', message: 'Divyansh is testing how agents relay messages. What should I ask next?' }, { success: true, reply: 'Ask Quill what it most recently did.' }),
      text('Your personal Overlay sent back the instruction. I\'ll ask Quill.'),
      tool('r3', 'ask_agent', { agent: 'Quill', message: 'What did you most recently do? Reply in one or two sentences.' }, undefined, 'input-available'),
    ], { status: 'generating' }),
  ]))
}
