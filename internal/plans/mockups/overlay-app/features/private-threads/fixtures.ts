import { MIN, ROOMS, agentRoom, message, text, tool } from '../../fixtures/rooms'
import { VIEWER_PRINCIPAL } from '../../fixtures/agents'
import { addThreadWork, installLocalCloudFixtures } from '../local-and-cloud/fixtures'
import { HOST } from '../local-and-cloud/model'
import { PRIVATE_THREAD_ID } from './store'

/** The Local and Cloud sample data, plus one Atlas thread that is not synced. Browsers never see that thread. */
export function installPrivateThreadFixtures() {
  installLocalCloudFixtures()
  if (HOST === 'web') return
  const environmentId = 'env_macbook_pro'
  addThreadWork(PRIVATE_THREAD_ID, { computer: { kind: 'mac', environmentId }, folders: [{ source: 'mac', environmentId, path: '/Users/mercedes/code/northwind-web' }] })
  ROOMS.push(agentRoom(PRIVATE_THREAD_ID, 'agent_atlas', 'Upgrade the Stripe SDK', 9 * MIN, 'ready', (room, atlas) => [
    message(room, VIEWER_PRINCIPAL, 34 * MIN, 'Upgrade the Stripe SDK to the latest major version and fix whatever breaks.'),
    message(room, atlas, 9 * MIN, 'Upgraded to the latest major. Two call sites used the removed `charges` API; both now use Payment Intents, and the billing tests pass.', [
      tool('s1', 'web_search', { query: 'stripe-node latest major version migration guide' }, { results: [{ title: 'stripe-node migration guide', url: 'https://example.com/stripe-migration' }] }),
      tool('s2', 'computer_exec', { command: 'npm install stripe@latest' }, { success: true, exitCode: 0 }),
      tool('s3', 'computer_exec', { command: 'npm test -- billing' }, { success: false, exitCode: 1 }),
      tool('s4', 'computer_write_file', { path: '~/code/northwind-web/src/billing/charge.ts' }, { success: true, created: false, linesAdded: 14, linesRemoved: 9 }),
      tool('s5', 'computer_exec', { command: 'npm test -- billing' }, { success: true, exitCode: 0 }),
      text('Upgraded to the latest major. Two call sites used the removed `charges` API; both now use **Payment Intents**, and the billing tests pass.'),
    ]),
  ]))
}
