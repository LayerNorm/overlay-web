/**
 * Lightweight sanity checks for unified tool policy vs bucket mapping.
 * Run: npx tsx scripts/unified-tools-sanity.ts   (or: node --experimental-strip-types)
 */
import { overlayToolIdSet } from '../../src/server/tools/tools/policy.ts'
import {
  shouldPersistToolInvocation,
  toolCostBucketForId,
} from '../../src/server/tools/tools/tool-buckets.ts'

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}

const overlayIds = [...overlayToolIdSet()]

const expectedOverlayBuckets: Record<string, ReturnType<typeof toolCostBucketForId>> = {
  browser_run_task: 'browser',
  interactive_browser_session: 'browser',
  run_daytona_sandbox: 'daytona',
  generate_image: 'image',
  generate_video: 'video',
  animate_image: 'video',
  generate_video_with_reference: 'video',
  apply_motion_control: 'video',
  edit_video: 'video',
}

for (const id of overlayIds) {
  const b = toolCostBucketForId(id)
  const expected = expectedOverlayBuckets[id] ?? 'internal'
  if (b !== expected) {
    fail(`Expected overlay tool "${id}" to map to ${expected} bucket, got ${b}`)
  }
  if (b === 'composio') {
    fail(`Overlay tool "${id}" should not fall through to composio bucket`)
  }
}

const mustRecord = [
  'perplexity_search',
  'parallel_search',
  'generate_image',
  'generate_video',
  'COMPOSIO_EXAMPLE_TOOL',
]
for (const id of mustRecord) {
  const b = toolCostBucketForId(id)
  if (!shouldPersistToolInvocation(b)) {
    fail(`Expected "${id}" (bucket ${b}) to be persisted`)
  }
}

if (shouldPersistToolInvocation(toolCostBucketForId('search_knowledge'))) {
  fail('search_knowledge should not persist to toolInvocations')
}

console.log('unified-tools-sanity: ok', { overlayCount: overlayIds.length })
