import { defineQueries } from '../../fixtures/convex'
import { HOUR, MIN, ROOMS, agentRoom, message, text, tool } from '../../fixtures/rooms'
import { VIEWER_PRINCIPAL } from '../../fixtures/agents'
import { ASSIGNMENTS, CHANNEL_ID, CHIEF_THREAD_ID, DM_ID, MODE, assignmentsForConversation, type Assignment } from './model'

const R1 = `I set up a **Drug Discovery Tutor** and split the first week across the team. The syllabus and the reading list are already back; the glossary is still being written.

1. Week 1: how a drug goes from target to clinic.
2. Week 2: target identification and validation.
3. Week 3: hit finding, lead optimisation and ADMET.
4. Week 4: preclinical work, trials and approval.`

const R2_PROPOSED = `The Friday quiz is being written now.

The second opinion did not start. **Syllabus Reviewer** is set to a model that runs on your own Anthropic key, and that key is not connected in this workspace. Nothing was charged. Switch the Reviewer to a model Overlay offers, or connect the key, and I will assign it again.

So you are not blocked, I reviewed the syllabus myself: week 3 is too dense. I would move ADMET into week 4.`

const R2_TODAY = 'Overlay hit an internal error and stopped this task. Send your message again. If it keeps happening, report the diagnostic ID; its cause is in the server logs. Diagnostic ID: hd_1k945igxpm6ya'

const R3 = 'Tonight, read the first two sections of the week 1 syllabus and the 2011 Paul et al. paper on R&D productivity from the reading list. About 40 minutes.'

function assign(conversationId: string, messageId: string, items: Array<Omit<Assignment, 'assignmentId' | 'conversationId' | 'messageId'>>) {
  for (const item of items) ASSIGNMENTS.push({ ...item, conversationId, messageId, assignmentId: 'asg_' + (ASSIGNMENTS.length + 1) })
}

export function installChiefAssignmentFixtures() {
  const delegate = (id: string, agent: string, title: string) => tool(id, 'harness_delegate', { agent, title }, { success: true })
  let first = '', second = ''
  ROOMS.unshift(agentRoom(CHIEF_THREAD_ID, 'agent_overlay', 'Learn drug discovery', 2 * MIN, 'ready', (room, chief) => {
    const r1 = message(room, chief, 38 * MIN, R1, [
      tool('c1', 'create_agent', { name: 'Drug Discovery Tutor' }, { success: true }),
      delegate('c2', 'Drug Discovery Tutor', 'Draft a four-week drug discovery syllabus'),
      delegate('c3', 'Scout', 'Collect ten landmark papers on target identification'),
      delegate('c4', 'Quill', 'Build a glossary of 60 core terms'),
      text(R1),
    ])
    const r2Text = MODE === 'today' ? R2_TODAY : R2_PROPOSED
    const r2 = message(room, chief, 9 * MIN, r2Text, [
      delegate('c5', 'Drug Discovery Tutor', 'Write the week 1 Friday quiz'),
      tool('c6', 'harness_delegate', { agent: 'Syllabus Reviewer', title: 'Review the syllabus for gaps' }, MODE === 'today' ? undefined : { success: false, error: 'not_started' }, MODE === 'today' ? 'output-error' : 'output-available'),
      text(r2Text),
    ])
    first = r1.id; second = r2.id
    return [
      message(room, VIEWER_PRINCIPAL, 40 * MIN, 'I want to learn drug discovery from scratch. Set up a tutor and a plan for the next four weeks.'),
      r1,
      message(room, VIEWER_PRINCIPAL, 10 * MIN, 'Quiz me on week 1 every Friday, and get a second opinion on the syllabus.'),
      r2,
      message(room, VIEWER_PRINCIPAL, 3 * MIN, 'Thanks. What should I read tonight?'),
      message(room, chief, 2 * MIN, R3),
    ]
  }))
  assign(CHIEF_THREAD_ID, first, [
    { title: 'Draft a four-week drug discovery syllabus', agentName: 'Drug Discovery Tutor', status: 'completed', when: '38 min ago' },
    { title: 'Collect ten landmark papers on target identification', agentName: 'Scout', agentId: 'agent_scout', threadId: 'k17convscoutpricing0000000000000', status: 'completed', when: '38 min ago' },
    { title: 'Build a glossary of 60 core terms', agentName: 'Quill', agentId: 'agent_quill', threadId: 'k17convquillpost0000000000000000', status: 'running', when: '38 min ago' },
  ])
  assign(CHIEF_THREAD_ID, second, [
    { title: 'Write the week 1 Friday quiz', agentName: 'Drug Discovery Tutor', status: 'running', when: '9 min ago' },
    {
      title: 'Review the syllabus for gaps', agentName: 'Syllabus Reviewer', status: 'failed', when: '9 min ago',
      reason: 'Did not start. Its model runs on your own Anthropic key, which is not connected in this workspace. Nothing was charged.',
      actions: ['Change model', 'Assign again'],
    },
  ])

  const channel = ROOMS.find((room) => room.id === CHANNEL_ID)!
  const channelReply = message(CHANNEL_ID, 'p_overlay', 5 * MIN, 'On it. Atlas is checking the flag on staging and Quill is updating the launch post with the final pricing. I will post here when both are back.')
  channel.messages.push(message(CHANNEL_ID, VIEWER_PRINCIPAL, 6 * MIN, '@Overlay staging is up. Can you get the launch checklist verified before standup?'), channelReply)
  channel.lastModified = channelReply.createdAt
  assign(CHANNEL_ID, channelReply.id, [
    { title: 'Verify the homepage flag on staging', agentName: 'Atlas', agentId: 'agent_atlas', threadId: 'k17convatlastable000000000000000', status: 'running', when: '5 min ago' },
    { title: 'Update the launch post with final pricing', agentName: 'Quill', agentId: 'agent_quill', threadId: 'k17convquillpost0000000000000000', status: 'waiting_for_input', reason: 'Waiting for the pricing decision.', when: '5 min ago' },
  ])

  const dm = ROOMS.find((room) => room.id === DM_ID)!
  dm.participants.push('p_overlay')
  const dmReply = message(DM_ID, 'p_overlay', 20 * MIN, 'Ledger is updating the forecast with October actuals. It will be in Files before 3pm.')
  dm.messages.push(message(DM_ID, VIEWER_PRINCIPAL, 22 * MIN, '@Overlay can you have the forecast refreshed before Sam and I meet?'), dmReply)
  dm.lastModified = dmReply.createdAt - HOUR / 60
  assign(DM_ID, dmReply.id, [
    { title: 'Refresh the forecast with October actuals', agentName: 'Ledger', agentId: 'agent_ledger', threadId: 'k17convledgerclose00000000000000', status: 'completed', when: '20 min ago' },
  ])

  // Today the app shows one box for the whole conversation under the last message.
  if (MODE === 'today') {
    defineQueries({
      'collaboration/agentAssignments:forConversation': ({ conversationId }: Record<string, unknown>) => ({
        parent: null,
        assignments: assignmentsForConversation(String(conversationId)).map((item) => ({
          assignmentId: item.assignmentId, title: item.title, agentName: item.agentName, status: item.status,
          agentId: item.agentId ?? 'agent_overlay', conversationId: item.threadId ?? CHIEF_THREAD_ID, scope: 'workspace',
        })),
      }),
    })
  }
}
