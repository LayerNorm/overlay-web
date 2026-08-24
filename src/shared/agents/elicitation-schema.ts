type JsonObject = Record<string, unknown>

/** Validates the ACP form-schema subset before a browser response reaches a host. */
export function assertValidElicitationResponse(payload: unknown, response: JsonObject | undefined) {
  if (!response) throw new Error('AGENT_ELICITATION_RESPONSE_REQUIRED')
  const schema = objectValue(objectValue(payload)?.requestedSchema)
  if (!schema) throw new Error('AGENT_ELICITATION_SCHEMA_INVALID')
  const properties = objectValue(schema.properties) ?? {}
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string') : []
  if (required.some((key) => !(key in response))) throw new Error('AGENT_ELICITATION_RESPONSE_INVALID')
  if (Object.keys(response).some((key) => !(key in properties))) throw new Error('AGENT_ELICITATION_RESPONSE_INVALID')
  for (const [key, value] of Object.entries(response)) {
    const property = objectValue(properties[key])
    if (!property || !matchesPropertySchema(value, property)) throw new Error('AGENT_ELICITATION_RESPONSE_INVALID')
  }
}

function matchesPropertySchema(value: unknown, schema: JsonObject) {
  if (schema.type === 'string' && typeof value !== 'string') return false
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return false
  if (schema.type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) return false
  if (schema.type === 'boolean' && typeof value !== 'boolean') return false
  if (schema.type === 'array' && (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))) return false
  if (!['string', 'number', 'integer', 'boolean', 'array'].includes(String(schema.type))) return false
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return false
    if (typeof schema.maximum === 'number' && value > schema.maximum) return false
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => candidate === value)) return false
  if (Array.isArray(schema.oneOf)) {
    const allowed = schema.oneOf.flatMap((candidate) => {
      const item = objectValue(candidate)
      return item && 'const' in item ? [item.const] : []
    })
    if (allowed.length > 0 && !allowed.includes(value)) return false
  }
  return true
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}
