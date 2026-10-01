import { describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const run = makeFunctionReference<'action'>('migrations/notesToMarkdown:run')

async function insertNote(convex: ReturnType<typeof convexTest>, content: string, updatedAt = 1) {
  return await convex.run(async (ctx) => ctx.db.insert('files', {
    userId: 'user_1',
    name: 'Note',
    type: 'file',
    kind: 'note',
    content,
    createdAt: 1,
    updatedAt,
  }))
}

describe('notes → Markdown backfill', () => {
  test('converts legacy HTML notes only, keeps updatedAt, and is idempotent', async () => {
    const convex = convexTest(schema, modules)
    const legacy = await insertNote(convex, '<h2>Plan</h2><p><strong>ship</strong> it</p>', 42)
    const markdown = await insertNote(convex, '# Already\n\nMarkdown\n')
    const empty = await insertNote(convex, '')

    expect(await convex.action(run, { dryRun: true })).toMatchObject({ scanned: 3, legacy: 1, converted: 0, done: true })

    expect(await convex.action(run, {})).toMatchObject({ scanned: 3, legacy: 1, converted: 1, failed: 0, done: true })
    const rows = await convex.run(async (ctx) => Promise.all([legacy, markdown, empty].map((id) => ctx.db.get(id))))
    expect(rows[0]).toMatchObject({ content: '## Plan\n\n**ship** it\n', updatedAt: 42 })
    expect(rows[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[1]?.content).toBe('# Already\n\nMarkdown\n')
    expect(rows[2]?.content).toBe('')

    expect(await convex.action(run, {})).toMatchObject({ legacy: 0, converted: 0 })
  })
})
