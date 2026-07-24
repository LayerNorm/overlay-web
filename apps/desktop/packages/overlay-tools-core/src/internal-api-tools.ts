import type { ToolDefinition } from './definitions'
import { toolCostBucketForId } from './buckets'
import { OVERLAY_TOOL_IDS } from './policy'

function categoryForToolId(toolId: string): ToolDefinition['category'] {
  if (toolId.includes('automation')) return 'automation'
  if (toolId.includes('memory')) return 'memory'
  if (toolId.includes('note')) return 'notes'
  if (toolId.includes('knowledge') || toolId.includes('files')) return 'knowledge'
  if (toolId.includes('browser')) return 'browser'
  if (toolId.includes('image') || toolId.includes('video') || toolId.includes('motion')) return 'media'
  if (toolId.includes('daytona')) return 'developer'
  return 'internal'
}

function riskForToolId(toolId: string): ToolDefinition['risk'] {
  if (
    toolId.startsWith('delete_') ||
    toolId === 'run_daytona_sandbox' ||
    toolId === 'interactive_browser_session' ||
    toolId.includes('video') ||
    toolId.includes('image')
  ) {
    return 'high'
  }
  if (toolId.startsWith('create_') || toolId.startsWith('update_') || toolId.startsWith('pause_')) return 'medium'
  return 'low'
}

export const INTERNAL_API_TOOL_DEFINITIONS = OVERLAY_TOOL_IDS.map((toolId) => ({
  id: toolId,
  category: categoryForToolId(toolId),
  costBucket: toolCostBucketForId(toolId),
  risk: riskForToolId(toolId),
  source: 'overlay',
})) satisfies readonly ToolDefinition[]
