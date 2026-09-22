type ToolOutputLike = Record<string, unknown>

function asRecord(value: unknown): ToolOutputLike | null {
  return value && typeof value === 'object' ? (value as ToolOutputLike) : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function listArtifactNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const record = asRecord(entry)
      return readString(record?.fileName)
    })
    .filter((name): name is string => Boolean(name))
}

export function summarizeToolResultForTranscript(params: {
  toolName?: string
  toolOutput?: unknown
  toolInput?: unknown
  state?: string
}): string | null {
  const toolName = params.toolName?.trim() || 'tool'
  const output = asRecord(params.toolOutput)
  const input = asRecord(params.toolInput)
  if (output?._overlayGatedFeature === true) {
    return readString(output.message) || 'This capability requires a paid plan.'
  }
  const toolMessage = readString(output?.message)
  const toolError = readString(output?.error) || readString(output?.errorMessage)

  if (toolName === 'run_daytona_sandbox') {
    const success = output?.success === true
    const artifacts = listArtifactNames(output?.artifacts)
    const missingExpected = Array.isArray(output?.missingExpectedOutputs)
      ? output?.missingExpectedOutputs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : []

    if (success) {
      if (artifacts.length > 0) {
        return `Daytona sandbox completed successfully and exported ${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'} to Outputs: ${artifacts.join(', ')}.`
      }
      return toolMessage || 'Daytona sandbox completed successfully.'
    }

    if (artifacts.length > 0 || missingExpected.length > 0) {
      const artifactSuffix = artifacts.length > 0 ? ` Imported: ${artifacts.join(', ')}.` : ''
      const missingSuffix = missingExpected.length > 0 ? ` Missing declared outputs: ${missingExpected.join(', ')}.` : ''
      return `Daytona sandbox did not complete cleanly.${artifactSuffix}${missingSuffix}`.trim()
    }

    return toolError || toolMessage || 'Daytona sandbox failed.'
  }

  if (toolName === 'generate_image') {
    if (output?.success === true) {
      return 'Generated an image and saved it to Outputs.'
    }
    return toolError || 'Image generation failed.'
  }

  if (toolName === 'generate_video') {
    const status = readString(output?.status)
    if (status === 'completed') return 'Generated a video and saved it to Outputs.'
    if (status === 'pending') return 'Started video generation. The result will appear in Outputs when it finishes.'
    if (status === 'failed') return toolError || 'Video generation failed.'
  }

  if (toolName === 'browser_run_task' || toolName === 'interactive_browser_session') {
    return toolMessage || (output?.success === true ? 'Browser task completed successfully.' : toolError || 'Browser task failed.')
  }

  if (toolName === 'perplexity_search' || toolName === 'web_search') {
    const query = readString(input?.query)
      ?? (Array.isArray(input?.query)
        ? input?.query.filter((q): q is string => typeof q === 'string').join('; ')
        : undefined)
    if (query) return `Searched the web for: ${query}.`
    return 'Completed a web search.'
  }

  if (toolName === 'parallel_search' || toolName === 'deep_search') {
    const objective = readString(input?.objective)
    if (objective) return `Deep web research: ${objective.length > 120 ? `${objective.slice(0, 120)}…` : objective}`
    return 'Completed deep web research.'
  }

  if (toolName === 'web_fetch') {
    const urls = Array.isArray(input?.urls) ? input.urls.filter((u): u is string => typeof u === 'string') : []
    if (urls.length === 1) return `Fetched: ${urls[0]}`
    if (urls.length > 1) return `Fetched ${urls.length} pages.`
    return 'Fetched page content.'
  }

  if (toolMessage) return toolMessage
  if (output?.success === true) return `The ${toolName} tool completed successfully.`
  if (toolError) return toolError
  return null
}
