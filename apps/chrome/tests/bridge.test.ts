import { describe, expect, it } from 'vitest'
import { PAGE_TEXT_LIMIT } from '@overlay/chrome-bridge'
import { answerAppRequest, type BridgeHost } from '../src/sidepanel/bridge'

const tab = { id: 7, url: 'https://example.com/orders', title: 'Orders' }

function host(overrides: Partial<BridgeHost> = {}): BridgeHost {
  return {
    activeTab: async () => tab,
    readTab: async () => ({ url: tab.url, title: tab.title, selection: '  Late: #1042 ', text: 'All\n\n\n\norders' }),
    ...overrides,
  }
}

describe('answerAppRequest', () => {
  it('names the tab next to the panel', async () => {
    expect(await answerAppRequest({ type: 'page.current', id: '1' }, host())).toEqual({
      type: 'page.current',
      id: '1',
      page: { url: tab.url, title: tab.title },
    })
  })

  it("does not offer Chrome's own pages", async () => {
    const chromePage = host({ activeTab: async () => ({ id: 2, url: 'chrome://settings', title: 'Settings' }) })
    expect(await answerAppRequest({ type: 'page.current', id: '1' }, chromePage)).toMatchObject({ page: null })
    expect(await answerAppRequest({ type: 'page.context', id: '2' }, chromePage)).toMatchObject({
      context: null,
      error: 'Overlay can only read web pages.',
    })
  })

  it('reads the page text and selection, trimmed to the bridge limit', async () => {
    expect(await answerAppRequest({ type: 'page.context', id: '3' }, host())).toEqual({
      type: 'page.context',
      id: '3',
      context: { url: tab.url, title: tab.title, selection: 'Late: #1042', text: 'All\n\norders', truncated: false },
    })
    const long = host({ readTab: async () => ({ url: tab.url, title: '', selection: '', text: 'x'.repeat(PAGE_TEXT_LIMIT * 2) }) })
    const reply = await answerAppRequest({ type: 'page.context', id: '4' }, long)
    expect(reply).toMatchObject({ context: { truncated: true } })
  })

  it('reports a page it cannot script', async () => {
    const blocked = host({ readTab: async () => { throw new Error('Cannot access contents of the page') } })
    expect(await answerAppRequest({ type: 'page.context', id: '5' }, blocked)).toMatchObject({ context: null })
  })
})
