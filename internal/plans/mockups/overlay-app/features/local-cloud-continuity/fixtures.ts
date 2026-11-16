import { HOUR, MIN, ROOMS, agentRoom, message, text, tool } from '../../fixtures/rooms'
import { VIEWER_PRINCIPAL } from '../../fixtures/agents'
import { HANDOFF_THREAD_ID, DELEGATING_THREAD_ID, mockupMarker } from './model'

/**
 * Two Atlas threads on the northwind-web project:
 * - one that started on the Mac and was continued in the cloud (Phase 3),
 * - one on the Mac that delegated two pieces to cloud copies of Atlas (Phase 4).
 */
export function installContinuityFixtures() {
  const handoff = ROOMS.find((room) => room.id === HANDOFF_THREAD_ID)
  if (!handoff) throw new Error('[mockup] the Atlas pricing thread is missing')
  const agent = 'p_atlas'
  const room = handoff.id
  handoff.lastModified = Date.now() - 40 * MIN
  handoff.messages = [
    message(room, VIEWER_PRINCIPAL, 2 * HOUR, 'The pricing table overflows on phones. Fix it in northwind-web and open a PR.'),
    message(room, agent, 115 * MIN, 'Fixed on your Mac: below 640px the table now scrolls inside its card and the plan names stay pinned. The pricing unit tests pass.', [
      tool('h1', 'computer_exec', { command: 'rg -n "PricingTable" src', target: 'local' }, { success: true, exitCode: 0 }),
      tool('h2', 'computer_read_file', { path: 'src/components/PricingTable.tsx', target: 'local' }, { success: true }),
      tool('h3', 'computer_write_file', { path: 'src/components/PricingTable.tsx', target: 'local' }, { success: true, created: false, linesAdded: 24, linesRemoved: 9 }),
      tool('h4', 'computer_exec', { command: 'npm test -- pricing-table', target: 'local' }, { success: true, exitCode: 0 }),
      text('Fixed on your Mac: below 640px the table now scrolls inside its card and the plan names stay pinned. The pricing unit tests pass.'),
    ]),
    message(room, VIEWER_PRINCIPAL, 80 * MIN, 'I’m closing my laptop. Keep going in the cloud: run the full end-to-end suite and open the PR.'),
    mockupMarker(room, 79 * MIN, { kind: 'handoff', to: 'cloud', snapshot: 'overlay/handoff/pricing-mobile', files: 6 }),
    message(room, agent, 40 * MIN, 'All 214 end-to-end tests pass in the cloud, and PR #482 is open from fix/pricing-mobile. Should I also collapse the feature comparison into an accordion below 480px?', [
      tool('h5', 'computer_exec', { command: 'npm ci', target: 'cloud' }, { success: true, exitCode: 0 }),
      tool('h6', 'computer_exec', { command: 'npm run test:e2e', target: 'cloud' }, { success: true, exitCode: 0 }),
      tool('h7', 'computer_exec', { command: 'gh pr create --fill --base main', target: 'cloud' }, { success: true, exitCode: 0 }),
      text('All 214 end-to-end tests pass in the cloud, and PR #482 is open from `fix/pricing-mobile`.\n\nShould I also collapse the feature comparison into an accordion below 480px?'),
    ]),
  ]

  ROOMS.push(agentRoom(DELEGATING_THREAD_ID, 'agent_atlas', 'Upgrade checkout to Stripe v2', 6 * MIN, 'working', (thread, atlas) => [
    message(thread, VIEWER_PRINCIPAL, 32 * MIN, 'Upgrade checkout to the new Stripe API. Keep my Mac free, I’m working on the homepage.'),
    message(thread, atlas, 30 * MIN, 'This splits cleanly in two, so I sent both pieces to cloud copies of me with this project’s snapshot and context. Nothing runs on your Mac. I’ll review each branch before you bring it back.', [
      tool('d1', 'computer_exec', { command: 'rg -ln "stripe" src/checkout', target: 'local' }, { success: true, exitCode: 0 }),
      tool('d2', 'computer_read_file', { path: 'src/checkout/payment-intent.ts', target: 'local' }, { success: true }),
      text('This splits cleanly in two, so I sent both pieces to cloud copies of me with this project’s snapshot and context. Nothing runs on your Mac. I’ll review each branch before you bring it back.'),
    ]),
    mockupMarker(thread, 29 * MIN, { kind: 'delegation' }),
  ]))
}
