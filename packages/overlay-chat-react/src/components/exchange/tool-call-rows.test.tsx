import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {buildAssistantVisualSequence, type ToolGroupItem} from '@overlay/chat-core'
import {ToolCallsCollapsedGroup} from './tool-call-rows'

function markup(items: ToolGroupItem[]) {
  return renderToStaticMarkup(<ToolCallsCollapsedGroup items={items} connectTop={false} connectBottom={false} />)
}

test('native terminal output belongs to its one running action', () => {
  const parts = [
    {type: 'tool-invocation', toolInvocation: {toolCallId: 'exec-1', toolName: 'remote_action', state: 'input-available', toolInput: {title: 'sleep 180'}}},
    {type: 'data-remote-agent-terminal', data: {key: 'exec-1', terminalId: 'exec-1', status: 'running', title: 'sleep 180', text: 'Retained output'}},
  ]
  const blocks = buildAssistantVisualSequence(parts).filter((block): block is ToolGroupItem => block.kind === 'tool' || block.kind === 'reasoning')
  assert.equal(blocks.length, 2, 'retain both the command and its terminal detail')
  assert.match(markup(blocks), /1 tool in progress/)
  assert.doesNotMatch(markup(blocks), /2 tools in progress/)
})

test('a completed action with an attached running terminal does not remain in progress', () => {
  const blocks = buildAssistantVisualSequence([
    {type: 'tool-invocation', toolInvocation: {toolCallId: 'finished', toolName: 'remote_action', state: 'output-available'}},
    {type: 'data-remote-agent-terminal', data: {key: 'finished', status: 'running', text: 'Retained output'}},
    {type: 'tool-invocation', toolInvocation: {toolCallId: 'live', toolName: 'remote_action', state: 'input-available'}},
    {type: 'data-remote-agent-terminal', data: {key: 'live', status: 'running'}},
    {type: 'data-remote-agent-status', data: {state: 'running'}},
  ]).filter((block): block is ToolGroupItem => block.kind === 'tool' || block.kind === 'reasoning')
  assert.match(markup(blocks), /2 tools · 1 running/)
  assert.match(markup(blocks.filter(block => block.key === 'finished')), /1 tool called/)
  assert.doesNotMatch(markup(blocks.filter(block => block.key === 'finished')), /in progress/)
})

test('completed terminal details count once, while distinct calls each count', () => {
  const items: ToolGroupItem[] = [
    {kind: 'tool', key: 'exec-1', name: 'remote_action', state: 'output-available'},
    {kind: 'tool', key: 'exec-1', name: 'remote_terminal', state: 'output-available'},
  ]
  assert.match(markup(items), /1 tool called/)
  assert.match(markup([...items, {kind: 'tool', key: 'exec-2', name: 'remote_action', state: 'output-available'}]), /2 tools called/)
  assert.match(markup(items.slice(1)), /1 tool called/, 'standalone terminal details remain visible work')
})


test('a cancelled single action and terminal detail use the singular completed label', () => {
  assert.match(markup([
    {kind: 'tool', key: 'exec-stop', name: 'remote_action', state: 'output-denied'},
    {kind: 'tool', key: 'exec-stop', name: 'remote_terminal', state: 'output-available'},
  ]), /1 tool called/)
})

test('mixed work reports the actual running count, including after an earlier interruption', () => {
  const items: ToolGroupItem[] = [
    {kind: 'tool', key: 'finished', name: 'remote_action', state: 'output-available'},
    {kind: 'tool', key: 'interrupted', name: 'remote_action', state: 'output-error'},
    {kind: 'tool', key: 'live', name: 'remote_action', state: 'input-available'},
    {kind: 'tool', key: 'live', name: 'remote_terminal', state: 'input-available'},
  ]
  assert.match(markup(items), /3 tools · 1 running/)
  assert.doesNotMatch(markup(items), /3 tools in progress/)
})
