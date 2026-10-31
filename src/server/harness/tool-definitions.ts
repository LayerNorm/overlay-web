import { asSchema, type ToolSet } from 'ai'
import type { LanguageModelV4FunctionTool } from '@ai-sdk/provider'

export function assertNoControlToolReplacement(tools: ToolSet, controls: Set<string>): void {
  if (Object.keys(tools).some(name => controls.has(name))) {
    throw new Error('Surface tools cannot replace harness control tools.')
  }
}

export async function prepareToolDefinitions(tools: ToolSet): Promise<LanguageModelV4FunctionTool[]> {
  return Promise.all(Object.entries(tools).map(async ([name, definition]) => {
    if (definition.type === 'provider' || typeof definition.description === 'function') {
      throw new Error('Harness tools must have prepared function schemas and descriptions.')
    }
    return {
      type: 'function' as const, name, description: definition.description,
      inputSchema: await asSchema(definition.inputSchema).jsonSchema,
      strict: definition.strict, inputExamples: definition.inputExamples as LanguageModelV4FunctionTool['inputExamples'],
      providerOptions: definition.providerOptions,
    }
  }))
}
