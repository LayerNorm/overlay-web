import type { ToolDefinition } from '@overlay/tools-core'

export interface McpToolDescriptor {
  name: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
}

export class McpToolAdapter {
  constructor(private readonly options: {
    serverName?: string
    tools: readonly McpToolDescriptor[]
    idPrefix?: string
    callTool: (toolName: string, input: unknown, context: unknown) => Promise<unknown>
  }) {}

  toToolDefinitions(): ToolDefinition[] {
    return this.options.tools.map((tool) => {
      const id = this.options.idPrefix ? `${this.options.idPrefix}${tool.name}` : tool.name
      return {
        id,
        name: tool.name,
        label: tool.name,
        description: tool.description,
        category: 'integration',
        source: 'mcp',
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        metadata: { serverName: this.options.serverName },
        execute: (input, context) => this.options.callTool(tool.name, input, context),
      }
    })
  }
}

export interface ComposioToolDescriptor {
  slug: string
  name?: string
  description?: string
  inputSchema?: unknown
}

export class ComposioToolAdapter {
  constructor(private readonly options: {
    tools: readonly ComposioToolDescriptor[]
    executeTool: (slug: string, input: unknown, context: unknown) => Promise<unknown>
  }) {}

  toToolDefinitions(): ToolDefinition[] {
    return this.options.tools.map((tool) => ({
      id: tool.slug,
      name: tool.name ?? tool.slug,
      label: tool.name ?? tool.slug,
      description: tool.description,
      category: 'integration',
      source: 'composio',
      costBucket: 'composio',
      inputSchema: tool.inputSchema,
      execute: (input, context) => this.options.executeTool(tool.slug, input, context),
    }))
  }
}
