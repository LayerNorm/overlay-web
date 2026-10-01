'use node'

import { createHash } from 'node:crypto'
import { v } from 'convex/values'
import { isLegacyNoteHtml, editorHtmlToNoteMarkdown } from '@overlay/app-core/note-markdown'
import { internal } from '../_generated/api'
import { internalAction } from '../_generated/server'

/**
 * Backfill: rewrite notes still stored as TipTap HTML as Markdown.
 * Idempotent and resumable; reads already convert legacy HTML, so it can run
 * any time after the Markdown release.
 *
 *   npx convex run migrations/notesToMarkdown:run '{"dryRun": true}'
 *   npx convex run migrations/notesToMarkdown:run '{}'
 */
export const run = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let cursor = args.cursor ?? null
    const totals = { scanned: 0, legacy: 0, converted: 0, changed: 0, failed: 0 }
    const failures: Array<{ fileId: string; error: string }> = []
    for (let page = 0; page < (args.maxPages ?? 1_000); page += 1) {
      const result = await ctx.runQuery(internal.migrations.notesToMarkdownData.notePage, {
        paginationOpts: { numItems: args.pageSize ?? 100, cursor },
      })
      for (const note of result.notes) {
        totals.scanned += 1
        if (!isLegacyNoteHtml(note.content)) continue
        totals.legacy += 1
        if (args.dryRun) continue
        try {
          const content = editorHtmlToNoteMarkdown(note.content)
          const outcome = await ctx.runMutation(internal.migrations.notesToMarkdownData.writeConvertedNote, {
            fileId: note._id,
            expectedUpdatedAt: note.updatedAt,
            expectedContent: note.content,
            content,
            contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
          })
          totals[outcome] += 1
        } catch (error) {
          totals.failed += 1
          if (failures.length < 20) {
            failures.push({ fileId: note._id, error: error instanceof Error ? error.message : String(error) })
          }
        }
      }
      cursor = result.continueCursor
      if (result.isDone) return { ...totals, failures, done: true, cursor: null }
    }
    return { ...totals, failures, done: false, cursor }
  },
})
