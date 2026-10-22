import assert from 'node:assert/strict'
import test from 'node:test'
import { computerActionRequiresApproval } from './policy'

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
