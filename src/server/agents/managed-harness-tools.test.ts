import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { adaptToolsForHarness, harnessOverlayToolsInstructions, MCP_APPROVAL_REFUSAL } from './managed-harness-tools'

type Execute = (input: unknown, options: { toolCallId?: string; context?: unknown }) => Promise<unknown>

test('harness tools drop sandbox-duplicating tools and pass tool context explicitly', async () => {
  const seen: unknown[] = []
  const tools = adaptToolsForHarness({
    tools: {
      get_note: { description: 'n', inputSchema: {}, execute: async (input: unknown) => ({ input }) },
      computer_exec: { description: 'c', inputSchema: {}, execute: async () => 'no' },
      run_daytona_sandbox: { description: 'd', inputSchema: {}, execute: async () => 'no' },
      present_generated_ui: { description: 'u', inputSchema: {}, execute: async () => 'no' },
      search_mcp_tools: {
        description: 's',
        inputSchema: {},
        contextSchema: {},
        execute: async (_input: unknown, options: { context?: unknown }) => { seen.push(options.context); return 'ok' },
      },
    } as never,
    toolsContext: { search_mcp_tools: { userId: 'user_1' } },
  })
  assert.deepEqual(Object.keys(tools).sort(), ['get_note', 'search_mcp_tools'])
  assert.equal('contextSchema' in tools.search_mcp_tools!, false)
  await (tools.search_mcp_tools!.execute as unknown as Execute)({}, { toolCallId: 'c1' })
  assert.deepEqual(seen, [{ userId: 'user_1' }])
})

test('approval-required MCP calls are refused, not run', async () => {
  let ran = false
  const tools = adaptToolsForHarness({
    tools: {
      call_mcp_tool: { description: 'm', inputSchema: {}, execute: async () => { ran = true; return 'ran' } },
    } as never,
    toolApproval: ({ toolCall }) => (toolCall.input.toolName === 'delete_repo' ? 'user-approval' : undefined),
  })
  const execute = tools.call_mcp_tool!.execute as unknown as Execute
  assert.deepEqual(await execute({ serverId: 's', toolName: 'delete_repo' }, {}), { success: false, error: MCP_APPROVAL_REFUSAL })
  assert.equal(ran, false)
  assert.equal(await execute({ serverId: 's', toolName: 'list_repos' }, {}), 'ran')
})

test('instructions name the tools and are empty without tools', () => {
  assert.equal(harnessOverlayToolsInstructions([]), '')
  assert.match(harnessOverlayToolsInstructions(['get_note', 'edit_note']), /Available: get_note, edit_note\./)
})
