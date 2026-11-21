import { defineQueries, notifyFixtures } from '../../fixtures/convex'
import { route } from '../../fixtures/fetch'
import { MOCK_USER } from '../../fixtures/data'
import { DAY, MIN, ROOMS, agentRoom, message, text } from '../../fixtures/rooms'
import { VIEWER_PRINCIPAL } from '../../fixtures/agents'

export const NEWS_THREAD_ID = 'k17convatlasnews0000000000000000'

/** What the computer stream shows: a stand-in desktop, since the mockup has no real machine. */
const DESKTOP = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><body style="margin:0;height:100vh;background:#1e2430;font:13px -apple-system,system-ui,sans-serif;color:#e8eaee;display:flex;flex-direction:column">
<div style="height:28px;background:#2b3240;display:flex;align-items:center;gap:6px;padding:0 10px"><span style="width:10px;height:10px;border-radius:50%;background:#ff5f57"></span><span style="width:10px;height:10px;border-radius:50%;background:#febc2e"></span><span style="width:10px;height:10px;border-radius:50%;background:#28c840"></span><span style="margin-left:12px;opacity:.7">Chromium — northwind.example/pricing</span></div>
<div style="flex:1;margin:18px;border-radius:8px;background:#fff;color:#111;padding:28px"><h2 style="margin:0 0 8px">Pricing</h2><p style="color:#555;margin:0 0 18px">Atlas's computer. Click and type here while you have control.</p>
<input placeholder="Search plans" style="padding:8px 10px;border:1px solid #ccc;border-radius:6px;width:240px"></div></body></html>`)

/** A thread with linked sources and a live reply, and Atlas's computer running so control can be taken. */
export function installPanelLinkFixtures() {
  ROOMS.unshift(agentRoom(NEWS_THREAD_ID, 'agent_atlas', "Today's biotech news roundup", 1 * MIN, 'working', (room, agent) => [
    message(room, VIEWER_PRINCIPAL, 12 * MIN, 'give me some biotech news of the day'),
    message(room, agent, 11 * MIN, '', [text([
      "Here are today's biotech headlines.",
      '',
      '**FDA and regulatory**',
      '',
      '- **GSK lung cancer drug approved.** Accelerated approval for adults with ALK-positive non-small cell lung cancer ([example.com](https://example.com/)).',
      '- **New FDA safety unit.** A council to track approved vaccines and cell and gene therapies ([wikipedia.org](https://en.wikipedia.org/wiki/Food_and_Drug_Administration)).',
      '',
      '**Deals**',
      '',
      '- **Pfizer enters in vivo CAR-T.** A $2.6B licensing deal where the therapy is produced inside the patient ([example.org](https://example.org/)).',
    ].join('\n'))]),
    message(room, VIEWER_PRINCIPAL, 1 * MIN, 'which of these matter most for our launch?'),
    message(room, agent, 0.2 * MIN, '', [], { status: 'generating' }),
  ]))
  ROOMS.find((entry) => entry.id === NEWS_THREAD_ID)!.lastModified = Date.now() - 1 * MIN

  const computer = {
    id: 'cmp_atlas', workspaceId: 'ws_northwind', ownerType: 'agent', ownerId: 'agent_atlas', provider: 'box',
    providerRef: 'box_atlas', size: 'standard', status: 'ready', name: "Atlas's computer", createdBy: MOCK_USER.id,
    createdAt: Date.now() - 3 * DAY, updatedAt: Date.now(), lastActiveAt: Date.now(),
  } as Record<string, unknown>
  defineQueries({ 'computers/browse:list': () => [{ ...computer }] })
  route('POST', /^\/api\/v1\/computers\/[^/]+\/desktop$/, () => ({ url: DESKTOP, expiresAt: Date.now() + DAY }))
  route('POST', /^\/api\/v1\/computers\/[^/]+\/control$/, ({ body }) => {
    const take = (body as { action?: string } | undefined)?.action === 'take'
    if (take) Object.assign(computer, { controlledByUserId: MOCK_USER.id, controlTakenAt: Date.now() })
    else { delete computer.controlledByUserId; delete computer.controlTakenAt }
    queueMicrotask(notifyFixtures)
    return { computer: { ...computer } }
  })
  route('GET', /^\/api\/v1\/link-preview$/, () => ({ embeddable: true }))
}
