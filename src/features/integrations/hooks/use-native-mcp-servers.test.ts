import { expect, test } from 'vitest'
import type { OptimisticLocalStore } from 'convex/browser'
import { patchNativeMcpEnabled } from './use-native-mcp-servers'

test('optimistic MCP enable changes only the matching workspace entity in cached pages and get', () => {
  const target = { _id: 'server-a', enabled: false }
  const other = { _id: 'server-b', enabled: false }
  const foreign = { _id: 'server-a', enabled: false }
  const pages = [
    { args: { workspaceId: 'workspace-a', view: 'personal', paginationOpts: { cursor: null, numItems: 30 } }, value: { page: [target, other], continueCursor: 'next', isDone: false } },
    { args: { workspaceId: 'workspace-b', view: 'personal', paginationOpts: { cursor: null, numItems: 30 } }, value: { page: [foreign], continueCursor: null, isDone: true } },
  ]
  const getValues = new Map([
    ['workspace-a:server-a', { ...target, name: 'A' }],
    ['workspace-a:server-b', { ...other, name: 'B' }],
    ['workspace-b:server-a', { ...foreign, name: 'Foreign' }],
  ])
  const store = {
    getAllQueries: () => pages,
    getQuery: (_reference: unknown, args: { workspaceId: string; mcpServerId: string }) => getValues.get(`${args.workspaceId}:${args.mcpServerId}`),
    setQuery: (_reference: unknown, args: Record<string, unknown>, value: unknown) => {
      const page = pages.find((entry) => entry.args === args)
      if (page) page.value = value as typeof page.value
      else {
        const queryArgs = args as { workspaceId: string; mcpServerId: string }
        getValues.set(`${queryArgs.workspaceId}:${queryArgs.mcpServerId}`, value as { _id: string; enabled: boolean; name: string })
      }
    },
  } as unknown as OptimisticLocalStore

  patchNativeMcpEnabled(store, { workspaceId: 'workspace-a', mcpServerId: 'server-a', enabled: true })

  expect(pages[0]?.value.page).toEqual([{ ...target, enabled: true }, other])
  expect(pages[1]?.value.page).toEqual([foreign])
  expect(getValues.get('workspace-a:server-a')).toEqual({ ...target, enabled: true, name: 'A' })
  expect(getValues.get('workspace-a:server-b')).toEqual({ ...other, name: 'B' })
  expect(getValues.get('workspace-b:server-a')).toEqual({ ...foreign, name: 'Foreign' })
})
