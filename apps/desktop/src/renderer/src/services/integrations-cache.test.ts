import { beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopAppJson } from './app-api-client'
import { fetchDesktopIntegrations } from './integrations-cache'

vi.mock('./app-api-client', () => ({
  desktopAppJson: vi.fn()
}))

const providerCapabilities = {
  provider: 'composio' as const,
  hosted: true,
  selfHosted: false,
  oauthOwnership: 'provider-managed' as const,
  connectionSetup: 'in-app-oauth' as const,
  connectionLifecycle: 'overlay-managed' as const,
  supportsApprovals: true,
  supportsDisconnect: true,
  supportedSchemas: ['native' as const]
}

describe('desktop integrations cache', () => {
  beforeEach(() => {
    vi.mocked(desktopAppJson).mockReset()
  })

  it('preloads one alphabetized provider catalog and reuses it', async () => {
    vi.mocked(desktopAppJson).mockImplementation(async (path) => {
      if (path.includes('action=search')) {
        return {
          items: [
            {
              slug: 'notion',
              providerKey: 'notion',
              name: 'Notion',
              description: 'Notes',
              logoUrl: 'https://example.com/notion.svg',
              provider: 'composio',
              capabilities: providerCapabilities
            },
            {
              slug: 'asana',
              providerKey: 'asana',
              name: 'Asana',
              description: 'Tasks',
              logoUrl: 'https://example.com/asana.svg',
              provider: 'composio',
              capabilities: providerCapabilities
            }
          ]
        } as never
      }
      return {
        connected: ['notion'],
        items: []
      } as never
    })

    const first = await fetchDesktopIntegrations({ force: true })
    const second = await fetchDesktopIntegrations()

    expect(first.catalog.map((item) => item.name)).toEqual(['Asana', 'Notion'])
    expect(first.connected.has('notion')).toBe(true)
    expect(second).toBe(first)
    expect(desktopAppJson).toHaveBeenCalledTimes(2)
    expect(desktopAppJson).toHaveBeenCalledWith('/api/v1/integrations?action=search&limit=100')
  })
})
