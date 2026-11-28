import { MIN, ROOMS, agentRoom, message, text, tool } from '../../fixtures/rooms'
import { VIEWER_PRINCIPAL } from '../../fixtures/agents'

export const CHROME_THREAD_ID = 'k17convatlaschromeorders00000000'

const PORTAL = 'https://northwind-supply.example'

const REPLY = [
  'I downloaded **orders-november.csv** (148 orders) from the Northwind Supply portal. Three are past their promised ship date:',
  '',
  '| Order | Customer | Promised | Status |',
  '| --- | --- | --- | --- |',
  '| #1042 | Harbor Coffee | Nov 18 | Packed, not shipped |',
  '| #1043 | Lumen Studio | Nov 20 | Waiting on stock |',
  '| #1051 | Fieldnote Co. | Nov 22 | Packed, not shipped |',
  '',
  'Everything else shipped on time.',
].join('\n')

/** An agent thread in which Atlas uses the person's own Chrome through the extension. */
export function installChromeExtensionFixtures() {
  ROOMS.unshift(agentRoom(CHROME_THREAD_ID, 'agent_atlas', 'Late November orders', 0.5 * MIN, 'working', (room, agent) => [
    message(room, VIEWER_PRINCIPAL, 9 * MIN, 'Download November’s orders from the Northwind Supply portal and tell me which ones are late.'),
    message(room, agent, 7 * MIN, REPLY, [
      tool('c1', 'chrome_browser', { action: 'new_tab', url: `${PORTAL}/orders` }, { success: true }),
      tool('c2', 'chrome_browser', { action: 'snapshot' }, { success: true, title: 'Orders · Northwind Supply' }),
      tool('c3', 'chrome_browser', { action: 'select', ref: 'e14', label: 'Month', value: 'November 2026' }, { success: true }),
      tool('c4', 'chrome_browser', { action: 'click', ref: 'e21', label: 'Export CSV', confirm: true }, { success: true }),
      tool('c5', 'chrome_browser', { action: 'download', ref: 'e22' }, { success: true, filename: 'orders-november.csv', bytes: 48_213 }),
      text(REPLY),
    ]),
    message(room, VIEWER_PRINCIPAL, 1 * MIN, 'Open the three late ones and check whether they have tracking numbers yet.'),
    message(room, agent, 0.3 * MIN, '', [
      tool('c6', 'chrome_browser', { action: 'click', ref: 'e31', label: '#1042' }, { success: true }),
      tool('c7', 'chrome_browser', { action: 'read_text' }, { success: true, title: 'Order #1042 · Northwind Supply' }),
      tool('c8', 'chrome_browser', { action: 'back' }, { success: true }),
      tool('c9', 'chrome_browser', { action: 'click', ref: 'e32', label: '#1043' }, undefined, 'input-available'),
    ], { status: 'generating' }),
  ]))
  ROOMS.find((entry) => entry.id === CHROME_THREAD_ID)!.lastModified = Date.now() - 0.5 * MIN
}
