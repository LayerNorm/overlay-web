import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolSet } from '@/server/ai/sdk'
import { ASSIGNED_TASK_TOOL_IDS, assignedTaskToolIdsToAdd, scopeAssignedTaskTools } from './assigned-task-tools'

function recordingTools() {
  const calls: Array<{ toolId: string; input: unknown }> = []
  const tools = Object.fromEntries(['get_task', 'update_task', 'comment_on_task', 'list_tasks'].map((toolId) => [toolId, {
    description: toolId,
    inputSchema: {},
    execute: async (input: unknown) => {
      calls.push({ toolId, input })
      return { success: true }
    },
  }])) as unknown as ToolSet
  return { calls, tools }
}

async function run(tools: ToolSet, toolId: string, input: Record<string, unknown>) {
  const execute = tools[toolId]!.execute as (input: unknown, options: unknown) => Promise<{ success: boolean; error?: string }>
  return execute(input, { toolCallId: 'call', messages: [] })
}

test('an agent without the Tasks group gets exactly the read, status, and comment tools for its assignment', () => {
  assert.deepEqual(assignedTaskToolIdsToAdd([]), [...ASSIGNED_TASK_TOOL_IDS])
  assert.deepEqual(assignedTaskToolIdsToAdd(['get_task', 'list_notes']), ['update_task', 'comment_on_task'])
  assert.deepEqual(assignedTaskToolIdsToAdd(['list_tasks', 'get_task', 'create_task', 'update_task', 'comment_on_task']), [])
})

test('assignment-granted tools work on the assigned task: read it, move it to progress and review, and comment', async () => {
  const { calls, tools } = recordingTools()
  const scoped = scopeAssignedTaskTools(tools, { taskId: 'task_1', addedToolIds: ASSIGNED_TASK_TOOL_IDS })

  assert.equal((await run(scoped, 'get_task', { taskId: 'task_1' })).success, true)
  assert.equal((await run(scoped, 'update_task', { taskId: 'task_1', revision: '5', status: 'progress' })).success, true)
  assert.equal((await run(scoped, 'update_task', { taskId: ' task_1 ', revision: '6', status: 'review' })).success, true)
  assert.equal((await run(scoped, 'comment_on_task', { taskId: 'task_1', body: 'Ready for review.' })).success, true)
  assert.deepEqual(calls.map((call) => call.toolId), ['get_task', 'update_task', 'update_task', 'comment_on_task'])
})

test('assignment-granted tools refuse other tasks and fields beyond status and blocked', async () => {
  const { calls, tools } = recordingTools()
  const scoped = scopeAssignedTaskTools(tools, { taskId: 'task_1', addedToolIds: ASSIGNED_TASK_TOOL_IDS })

  const otherRead = await run(scoped, 'get_task', { taskId: 'task_2' })
  assert.equal(otherRead.success, false)
  assert.match(otherRead.error ?? '', /assigned task \(task_1\)/)
  assert.equal((await run(scoped, 'comment_on_task', { taskId: 'task_2', body: 'x' })).success, false)
  const reassign = await run(scoped, 'update_task', { taskId: 'task_1', assignee: 'me', status: 'done' })
  assert.equal(reassign.success, false)
  assert.match(reassign.error ?? '', /not assignee/)
  assert.equal(calls.length, 0)
})

test('tools the agent already held keep their full reach, and tools outside the assignment are untouched', async () => {
  const { calls, tools } = recordingTools()
  const scoped = scopeAssignedTaskTools(tools, { taskId: 'task_1', addedToolIds: ['update_task'] })

  assert.equal(scoped.get_task, tools.get_task)
  assert.equal(scoped.list_tasks, tools.list_tasks)
  assert.equal((await run(scoped, 'get_task', { taskId: 'task_2' })).success, true)
  assert.equal((await run(scoped, 'update_task', { taskId: 'task_2', status: 'review' })).success, false)
  assert.deepEqual(calls.map((call) => call.toolId), ['get_task'])
  assert.equal(scopeAssignedTaskTools(tools, { taskId: 'task_1', addedToolIds: [] }), tools)
})
