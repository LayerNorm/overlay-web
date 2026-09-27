import type { ToolDefinition } from '@overlay/tools-core'
import { NoOpContextBuilder } from './context-builder'
import { ToolRegistry } from './tool-registry'
import type { AgentRuntimeDeps, AgentTurnInput, AgentTurnOutput, ToolRegistryLike } from './types'

function isToolRegistryLike(value: unknown): value is ToolRegistryLike {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ToolRegistryLike).list === 'function' &&
      typeof (value as ToolRegistryLike).execute === 'function',
  )
}

function createRegistry(tools?: ToolRegistryLike | readonly ToolDefinition[]): ToolRegistryLike {
  if (isToolRegistryLike(tools)) return tools
  return new ToolRegistry(tools ?? [])
}

function filterAllowedTools(
  tools: readonly ToolDefinition[],
  allowedToolIds?: readonly string[],
): readonly ToolDefinition[] {
  if (!allowedToolIds) return tools
  const allowed = new Set(allowedToolIds)
  return tools.filter((tool) => allowed.has(tool.id))
}

export class AgentRuntime {
  constructor(private readonly defaultDeps: AgentRuntimeDeps = {}) {}

  async runTurn(input: AgentTurnInput, deps: AgentRuntimeDeps = {}): Promise<AgentTurnOutput> {
    const resolvedDeps = { ...this.defaultDeps, ...deps }
    const toolRegistry = createRegistry(resolvedDeps.tools)
    const tools = filterAllowedTools(toolRegistry.list(), input.allowedToolIds)
    const contextBuilder = resolvedDeps.contextBuilder ?? new NoOpContextBuilder()
    // Context must complete before executeTurn consumes it — nothing else can
    // proceed concurrently, so the await is inherent.
    // react-doctor-disable-next-line react-doctor/async-defer-await
    const context = await contextBuilder.build({
      input,
      tools,
      llmGateway: resolvedDeps.llmGateway,
    })

    if (!resolvedDeps.executeTurn) {
      throw new Error('[agent-runtime] AgentRuntime requires an executeTurn dependency')
    }

    const execution = await resolvedDeps.executeTurn({
      input,
      context,
      tools,
      toolRegistry,
      llmGateway: resolvedDeps.llmGateway,
    })

    const output: AgentTurnOutput = {
      ...execution,
      context,
      persisted: false,
    }

    if (resolvedDeps.persistTurn) {
      await resolvedDeps.persistTurn.persist({ input, output, context })
      output.persisted = true
    }

    return output
  }
}
