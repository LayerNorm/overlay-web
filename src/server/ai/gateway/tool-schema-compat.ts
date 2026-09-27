import 'server-only'

import { asSchema, type ToolSet } from 'ai'

export type GatewayToolSchemaViolation = {
  toolName: string
  reason: string
}

type JsonRecord = Record<string, unknown>

export async function analyzeToolSetForGatewayCompatibility(
  toolSet: ToolSet,
): Promise<GatewayToolSchemaViolation[]> {
  const results = await Promise.all(Object.entries(toolSet).map(([toolName, toolDef]) =>
    getGatewayToolSchemaViolation(toolName, toolDef)))
  return results.filter((violation): violation is GatewayToolSchemaViolation => Boolean(violation))
}

export async function filterGatewayCompatibleToolSet(toolSet: ToolSet): Promise<{
  dropped: GatewayToolSchemaViolation[]
  tools: ToolSet
}> {
  const dropped: GatewayToolSchemaViolation[] = []
  const tools: ToolSet = {}

  const entries = Object.entries(toolSet)
  const violations = await Promise.all(entries.map(([toolName, toolDef]) =>
    getGatewayToolSchemaViolation(toolName, toolDef)))
  for (const [i, [toolName, toolDef]] of entries.entries()) {
    const violation = violations[i]
    if (violation) {
      dropped.push(violation)
      continue
    }
    tools[toolName] = toolDef
  }

  return { dropped, tools }
}

export function summarizeGatewayToolSchemaViolations(
  violations: readonly GatewayToolSchemaViolation[],
): string {
  if (violations.length === 0) return 'none'
  return violations
    .slice(0, 40)
    .map((violation) => `${safeToolNameForLog(violation.toolName)}:${violation.reason}`)
    .join(', ') + (violations.length > 40 ? `, +${violations.length - 40} more` : '')
}

async function getGatewayToolSchemaViolation(
  toolName: string,
  toolDef: ToolSet[string] | undefined,
): Promise<GatewayToolSchemaViolation | null> {
  if (!toolDef || typeof toolDef !== 'object') {
    return { toolName, reason: 'invalid_tool_definition' }
  }

  if ((toolDef as { type?: unknown }).type === 'provider') {
    return null
  }

  try {
    const inputSchema = (toolDef as { inputSchema?: Parameters<typeof asSchema>[0] }).inputSchema
    const schema = await asSchema(inputSchema).jsonSchema
    return getGatewayJsonSchemaViolation(toolName, schema)
  } catch (error) {
    return {
      toolName,
      reason: `schema_serialization_failed:${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function getGatewayJsonSchemaViolation(toolName: string, schema: unknown): GatewayToolSchemaViolation | null {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { toolName, reason: 'schema_not_object' }
  }

  const record = schema as JsonRecord
  if (Array.isArray(record.anyOf)) {
    return { toolName, reason: 'root_anyOf_not_supported' }
  }

  if (Array.isArray(record.oneOf)) {
    return { toolName, reason: 'root_oneOf_not_supported' }
  }

  if (record.type !== 'object') {
    return {
      toolName,
      reason: `root_type_${typeof record.type === 'string' ? record.type : 'missing'}`,
    }
  }

  return null
}

function safeToolNameForLog(name: string): string {
  return name
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .slice(0, 96)
}
