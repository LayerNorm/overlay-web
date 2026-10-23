import assert from 'node:assert/strict'
import test from 'node:test'
import { computerActionRequiresApproval, resolveMcpExecutionPolicy, toolRequiresApproval } from './policy'

test('computer approval policy requires approval only for consequential input actions', () => {
  const cases: Array<[string, unknown, boolean]> = [
    ['computer_input', { action: 'type', text: 'hello' }, true],
    ['computer_input', { action: 'key', keys: 'ctrl+l' }, true],
    ...['click', 'double_click', 'right_click']
      .map((action) => ['computer_input', { action, confirm: true }, true] as [string, unknown, boolean]),
    ...['click', 'double_click', 'right_click']
      .map((action) => ['computer_input', { action, confirm: false }, false] as [string, unknown, boolean]),
    ['computer_browser', { action: 'type', ref: 'r1', text: 'hello' }, true],
    ['computer_browser', { action: 'type', ref: 'r1', text: 'hello', submit: true }, true],
    ['computer_browser', { action: 'type', ref: 'r1', text: 'hello', submit: false }, true],
    ['computer_browser', { action: 'press', keys: 'Enter' }, true],
    ['computer_browser', { action: 'click', ref: 'r1', confirm: true }, true],
    ['computer_browser', { action: 'click', ref: 'r1' }, false],
    ...['click', 'double_click', 'right_click', 'move', 'drag', 'scroll', 'wait']
      .map((action) => ['computer_input', { action }, false] as [string, unknown, boolean]),
    ...['snapshot', 'tabs', 'navigate', 'back', 'forward', 'reload', 'scroll', 'click', 'switch_tab', 'new_tab']
      .map((action) => ['computer_browser', { action }, false] as [string, unknown, boolean]),
    ['computer_screenshot', {}, false],
    ['unrelated_tool', { action: 'type' }, false],
    ['computer_input', null, false],
  ]

  for (const [toolName, input, expected] of cases) {
    assert.equal(
      computerActionRequiresApproval(toolName, input),
      expected,
      `${toolName} ${JSON.stringify(input)}`,
    )
  }
})

test('Ask requires approval for command starts and Executor actions that are risky or unknown', () => {
  const cases: Array<[string, unknown, Parameters<typeof toolRequiresApproval>[2], boolean]> = [
    ['computer_exec', { command: 'ls' }, {}, true],
    ['computer_terminal', { action: 'start', command: 'ls' }, {}, true],
    ['computer_terminal', { action: 'read', id: 't-000000000000' }, {}, false],
    ['computer_terminal', { action: 'list' }, {}, false],
    ['computer_terminal', { action: 'cancel', id: 't-000000000000' }, {}, false],
    ['EXECUTOR_EXECUTE_TOOL', { toolAddress: 'mail.send' }, { executorRequiresApproval: true }, true],
    ['EXECUTOR_EXECUTE_TOOL', { toolAddress: 'mail.list' }, { executorRequiresApproval: false }, false],
    ['EXECUTOR_EXECUTE_TOOL', { toolAddress: 'unknown.address' }, {}, true],
    ['call_mcp_tool', { serverId: 's1', toolName: 'create_issue' }, { mcpPolicy: 'approval_required' }, true],
    ['call_mcp_tool', { serverId: 's1', toolName: 'list_repos' }, { mcpPolicy: 'allow' }, false],
  ]

  for (const [toolName, input, options, expected] of cases) {
    assert.equal(toolRequiresApproval(toolName, input, options), expected, toolName)
  }
})

test('Auto does not require approval for native actions, while MCP deny remains a separate execution policy', () => {
  const cases: Array<[string, unknown, Parameters<typeof toolRequiresApproval>[2]]> = [
    ['computer_input', { action: 'type', text: 'hello' }, {}],
    ['computer_exec', { command: 'rm file' }, {}],
    ['computer_terminal', { action: 'start', command: 'make' }, {}],
    ['EXECUTOR_EXECUTE_TOOL', { toolAddress: 'unknown.address' }, {}],
    ['call_mcp_tool', { serverId: 's1', toolName: 'write' }, { mcpPolicy: 'approval_required' }],
    ['call_mcp_tool', { serverId: 's1', toolName: 'write' }, { mcpPolicy: 'deny' }],
  ]

  for (const [toolName, input, options] of cases) {
    assert.equal(toolRequiresApproval(toolName, input, { ...options, approvalMode: 'auto' }), false, toolName)
  }
  assert.equal(resolveMcpExecutionPolicy('deny', { approvalMode: 'auto' }), 'deny')
  assert.equal(resolveMcpExecutionPolicy('approval_required', { approvalMode: 'auto' }), 'allow')
  assert.equal(resolveMcpExecutionPolicy('approval_required', { approvalMode: 'ask', approvalContext: 'automation' }), 'approval_required')
})
