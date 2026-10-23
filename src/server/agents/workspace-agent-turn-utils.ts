import type { ToolResultOutput } from '@ai-sdk/provider-utils'

export type WorkspaceAgentToolResult = {
  output: ToolResultOutput
  display: unknown
  error?: string
  refusedApproval?: boolean
}

export function workspaceAgentToolResultFromOutput(input: {
  output: unknown
  display: unknown
  error?: string
  refusedApproval?: boolean
  outputIsMapped?: boolean
}): WorkspaceAgentToolResult {
  if (input.error || input.refusedApproval) {
    const outputError = input.output && typeof input.output === 'object'
      ? (input.output as Record<string, unknown>).error
      : undefined
    return {
      output: {
        type: 'error-text',
        value: input.error
          ?? (typeof outputError === 'string' ? outputError : undefined)
          ?? 'This action needs approval. Use Work mode, or set this agent\'s Permissions to Auto.',
      },
      display: input.display,
      ...(input.error ? { error: input.error } : {}),
      ...(input.refusedApproval ? { refusedApproval: true } : {}),
    }
  }
  if (input.outputIsMapped && input.output !== undefined) {
    return { output: input.output as ToolResultOutput, display: input.display }
  }
  if (typeof input.output === 'string') {
    return { output: { type: 'text', value: input.output }, display: input.display }
  }
  return {
    output: {
      type: 'json',
      value: (input.output === undefined ? null : input.output) as Extract<ToolResultOutput, { type: 'json' }>['value'],
    },
    display: input.display,
  }
}

export function workspaceAgentToolResultOutput(result: WorkspaceAgentToolResult): ToolResultOutput {
  return result.output
}

export function refusedAmbiguousWorkspaceAgentToolRetry(attempt: number): WorkspaceAgentToolResult | null {
  if (attempt <= 1) return null
  const output = { error: 'The action outcome is uncertain. This call was not retried.' }
  return workspaceAgentToolResultFromOutput({ output, display: output, error: output.error })
}
