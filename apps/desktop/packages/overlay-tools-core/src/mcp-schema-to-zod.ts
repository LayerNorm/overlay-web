import { z, type ZodTypeAny } from 'zod'

/**
 * Convert a JSON Schema subset to a Zod schema for AI SDK tool definitions.
 * This is a best-effort conversion. Unsupported constructs fall back to z.any().
 */
export function jsonSchemaToZod(schema: unknown): ZodTypeAny {
  if (schema === null || schema === undefined) {
    return z.any()
  }

  if (typeof schema !== 'object' || Array.isArray(schema)) {
    return z.any()
  }

  const s = schema as Record<string, unknown>

  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
    const branches = (s.anyOf ?? s.oneOf) as unknown[]
    const zodBranches = branches.map(jsonSchemaToZod).filter((b): b is ZodTypeAny => b !== undefined)
    if (zodBranches.length === 0) return z.any()
    if (zodBranches.length === 1) return zodBranches[0]
    return z.union(zodBranches as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
  }

  if (Array.isArray(s.allOf)) {
    const branches = (s.allOf as unknown[]).map(jsonSchemaToZod).filter((b): b is ZodTypeAny => b !== undefined)
    if (branches.length === 0) return z.any()
    let result = branches[0]
    for (let i = 1; i < branches.length; i++) {
      result = result.and(branches[i])
    }
    return result
  }

  const type = Array.isArray(s.type)
    ? s.type.find((t) => typeof t === 'string')
    : (typeof s.type === 'string' ? s.type : undefined)

  switch (type) {
    case 'string': {
      let zod: ZodTypeAny = z.string()
      if (typeof s.minLength === 'number') zod = (zod as z.ZodString).min(s.minLength)
      if (typeof s.maxLength === 'number') zod = (zod as z.ZodString).max(s.maxLength)
      if (typeof s.pattern === 'string') zod = (zod as z.ZodString).regex(new RegExp(s.pattern))
      if (typeof s.format === 'string') {
        if (s.format === 'email') zod = (zod as z.ZodString).email()
        if (s.format === 'uri' || s.format === 'url') zod = (zod as z.ZodString).url()
        if (s.format === 'uuid') zod = (zod as z.ZodString).uuid()
        if (s.format === 'date-time') zod = (zod as z.ZodString).datetime()
      }
      if (Array.isArray(s.enum) && s.enum.every((v) => typeof v === 'string')) {
        zod = z.enum(s.enum as [string, ...string[]])
      }
      return zod
    }
    case 'number': {
      let zod: ZodTypeAny = z.number()
      if (typeof s.minimum === 'number') zod = (zod as z.ZodNumber).min(s.minimum)
      if (typeof s.maximum === 'number') zod = (zod as z.ZodNumber).max(s.maximum)
      if (typeof s.exclusiveMinimum === 'number') zod = (zod as z.ZodNumber).gt(s.exclusiveMinimum)
      if (typeof s.exclusiveMaximum === 'number') zod = (zod as z.ZodNumber).lt(s.exclusiveMaximum)
      if (typeof s.multipleOf === 'number') zod = (zod as z.ZodNumber).multipleOf(s.multipleOf)
      return zod
    }
    case 'integer': {
      let zod: ZodTypeAny = z.number().int()
      if (typeof s.minimum === 'number') zod = (zod as z.ZodNumber).min(s.minimum)
      if (typeof s.maximum === 'number') zod = (zod as z.ZodNumber).max(s.maximum)
      if (typeof s.exclusiveMinimum === 'number') zod = (zod as z.ZodNumber).gt(s.exclusiveMinimum)
      if (typeof s.exclusiveMaximum === 'number') zod = (zod as z.ZodNumber).lt(s.exclusiveMaximum)
      if (typeof s.multipleOf === 'number') zod = (zod as z.ZodNumber).multipleOf(s.multipleOf)
      return zod
    }
    case 'boolean': {
      return z.boolean()
    }
    case 'array': {
      const itemsSchema = jsonSchemaToZod(s.items)
      let zod: ZodTypeAny = z.array(itemsSchema)
      if (typeof s.minItems === 'number') zod = (zod as z.ZodArray<ZodTypeAny>).min(s.minItems)
      if (typeof s.maxItems === 'number') zod = (zod as z.ZodArray<ZodTypeAny>).max(s.maxItems)
      return zod
    }
    case 'object': {
      const shape: Record<string, ZodTypeAny> = {}
      const properties = typeof s.properties === 'object' && s.properties !== null && !Array.isArray(s.properties)
        ? (s.properties as Record<string, unknown>)
        : {}
      for (const [key, propSchema] of Object.entries(properties)) {
        shape[key] = jsonSchemaToZod(propSchema)
      }
      let zod = z.object(shape)
      if (Array.isArray(s.required) && s.required.every((r) => typeof r === 'string')) {
        const requiredSet = new Set(s.required as string[])
        const partialShape: Record<string, ZodTypeAny> = {}
        for (const [k, v] of Object.entries(shape)) {
          partialShape[k] = requiredSet.has(k) ? v : v.optional()
        }
        zod = z.object(partialShape)
      }
      if (typeof s.additionalProperties === 'object') {
        zod = zod.catchall(jsonSchemaToZod(s.additionalProperties))
      }
      return zod
    }
    case 'null': {
      return z.null()
    }
    default:
      return z.any()
  }
}
