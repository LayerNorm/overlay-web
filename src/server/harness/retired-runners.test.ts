import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from 'vitest'

const root = process.cwd()
const retiredPaths = [
  'src/server/workflows/workspace-agent-turn.ts',
  'src/server/workflows/workspace-agent-approval.ts',
  'src/server/agents/workspace-agent-turn-loop.ts',
  'src/server/agents/workspace-agent-turn-lifecycle.ts',
  'src/server/agents/workspace-agent-durable.ts',
  'src/server/agents/workspace-agent-usage.ts',
  'src/server/agents/workspace-agent-turn-utils.ts',
  'src/server/workflows/personal-chat-work.ts',
  'src/server/agents/workspace-agent-turn-loop.test.ts',
  'src/server/agents/workspace-agent-durable.test.ts',
  'src/server/agents/workspace-agent-turn-utils.test.ts',
  'src/server/workflows/workspace-agent-turn.test.ts',
  'src/server/workflows/personal-chat-work.test.ts',
  'tests/workflow-runtime/native-agent-loop.ts',
  'tests/workflow-runtime/native-agent-loop.workflow.test.ts',
]

const retiredIdentifiers = [
  'runWorkspaceAgentTurn',
  'runWorkspaceAgentTurnLoop',
  'workspaceAgentTurnWorkflow',
  'personalChatWorkWorkflow',
  'startLegacyPersonalWorkflow',
]

async function listProductionSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return await listProductionSources(path)
    if (!/\.(?:ts|tsx|mts|cts)$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) return []
    return [path]
  }))
  return nested.flat()
}

test('retired runner implementations and tests are absent', async () => {
  const existing: string[] = []
  for (const path of retiredPaths) {
    try {
      await access(join(root, path))
      existing.push(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  assert.deepEqual(existing, [])
})

test('production server sources cannot reference retired runner entry points', async () => {
  const sources = await listProductionSources(join(root, 'src/server'))
  const pattern = new RegExp(`\\b(?:${retiredIdentifiers.join('|')})\\b`)
  const references: string[] = []
  for (const path of sources) {
    const contents = await readFile(path, 'utf8')
    const match = pattern.exec(contents)
    if (match) references.push(`${relative(root, path)}: ${match[0]}`)
  }
  assert.deepEqual(references, [])
})
