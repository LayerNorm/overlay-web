import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ZodTypeAny } from 'zod'
import {
  webApiBoundaryDefinitions,
  webApiExcludedRouteDefinitions,
  type WebApiBoundaryDefinition,
} from '../src/shared/schemas/api-boundary.ts'

type JsonObject = Record<string, unknown>

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const appApiDir = path.join(root, 'src/app/api/v1')
const outputFile = path.join(root, 'docs/openapi/overlay-web.openapi.json')

async function main() {
  await assertRouteCoverage()

  const publicDefinitions = webApiBoundaryDefinitions
    .filter((definition) => definition.publicReference !== false)
    .slice()
    .sort((a, b) => {
      const pathComparison = a.path.localeCompare(b.path)
      if (pathComparison !== 0) return pathComparison
      return a.method.localeCompare(b.method)
    })

  const tags = Array.from(new Set(publicDefinitions.map((definition) => definition.tag)))
    .sort()
    .map((name) => ({ name }))

  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'Overlay Web API',
      version: '1.0.0',
      description:
        'Generated from the overlay-web route boundary registry. This first-pass reference documents stable route inventory and request shapes.',
    },
    servers: [
      { url: 'https://getoverlay.io', description: 'Hosted Overlay web app' },
      { url: 'http://localhost:3000', description: 'Local development web app' },
    ],
    tags,
    paths: buildPaths(publicDefinitions),
    components: {
      securitySchemes: {
        browserSession: {
          type: 'apiKey',
          in: 'cookie',
          name: 'overlay_session',
          description: 'Signed httpOnly browser session cookie.',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'WorkOS bearer access token for native or service clients.',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
    },
  }

  await writeFile(outputFile, `${JSON.stringify(spec, null, 2)}\n`)
  console.log(`Wrote ${path.relative(root, outputFile)} (${publicDefinitions.length} operations)`)
}

function buildPaths(definitions: readonly WebApiBoundaryDefinition[]) {
  const paths: Record<string, Record<string, JsonObject>> = {}

  for (const definition of definitions) {
    const pathItem = paths[definition.path] ?? {}
    pathItem[definition.method.toLowerCase()] = buildOperation(definition)
    paths[definition.path] = pathItem
  }

  return paths
}

function buildOperation(definition: WebApiBoundaryDefinition): JsonObject {
  const operation: JsonObject = {
    operationId: operationIdFor(definition),
    summary: definition.summary,
    tags: [definition.tag],
    security: [{ browserSession: [] }, { bearerAuth: [] }],
    responses: buildResponses(definition),
  }

  if (definition.description) operation.description = definition.description

  const parameters = [
    ...pathParameters(definition.path),
    ...queryParameters(definition.schema.query, schemaName(definition, 'Query')),
  ]
  if (parameters.length > 0) operation.parameters = parameters

  if (definition.schema.json) {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: schemaFromZod(definition.schema.json, schemaName(definition, 'Request')),
        },
      },
    }
  } else if (definition.schema.formData) {
    operation.requestBody = {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            additionalProperties: true,
            description: 'Multipart form data. Field-level schemas are validated server-side.',
          },
        },
      },
    }
  }

  return operation
}

function buildResponses(definition: WebApiBoundaryDefinition) {
  if (definition.path === '/api/v1/api-keys') {
    return {
      '501': {
        description: 'API key management is not exposed yet.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    }
  }

  return {
    '200': {
      description: 'Successful response. Stable response schemas are documented in workflow guides when available.',
      content: {
        'application/json': {
          schema: {
            description: 'Response shape is route-specific and may be backed by @overlay/app-core contracts.',
          },
        },
      },
    },
    '400': {
      description: 'Invalid request.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
    },
    '401': {
      description: 'Missing or invalid authentication.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
    },
    '500': {
      description: 'Unexpected server error.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
    },
  }
}

function pathParameters(openApiPath: string) {
  const parameters: JsonObject[] = []
  for (const match of openApiPath.matchAll(/\{([^}]+)\}/g)) {
    const name = match[1]
    if (!name) continue
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    })
  }
  return parameters
}

function queryParameters(schema: ZodTypeAny | undefined, name: string) {
  if (!schema) return []

  const objectSchema = schemaFromZod(schema, name)
  const properties = isObject(objectSchema.properties) ? objectSchema.properties : {}
  const required = new Set(Array.isArray(objectSchema.required) ? objectSchema.required : [])

  return Object.entries(properties).map(([propertyName, propertySchema]) => ({
    name: propertyName,
    in: 'query',
    required: required.has(propertyName),
    schema: propertySchema,
  }))
}

function schemaFromZod(schema: ZodTypeAny, name: string): JsonObject {
  const jsonSchema = zodToJsonSchema(schema, {
    name,
    target: 'openApi3',
    $refStrategy: 'none',
  }) as JsonObject

  const definitions = isObject(jsonSchema.definitions) ? jsonSchema.definitions : undefined
  const namedDefinition = definitions && isObject(definitions[name]) ? definitions[name] : undefined
  const result = namedDefinition ? { ...namedDefinition } : { ...jsonSchema }

  delete result.$schema
  delete result.definitions
  return result
}

async function assertRouteCoverage() {
  const routeFiles = await listRouteFiles(appApiDir)
  const excluded = new Map(webApiExcludedRouteDefinitions.map((definition) => [definition.routePath, definition.reason]))
  const definitionsByRoute = groupDefinitionsByRoutePath()
  const failures: string[] = []

  for (const file of routeFiles) {
    const routePath = routePathForFile(file)
    if (excluded.has(routePath)) continue

    const definitions = definitionsByRoute.get(routePath)
    if (!definitions) {
      failures.push(`${routePath} has no API boundary definition`)
      continue
    }

    const fileText = await readFile(file, 'utf8')
    const exportedMethods = exportedRouteMethods(fileText)
    const definedMethods = new Set(definitions.map((definition) => definition.method.toUpperCase()))
    for (const method of exportedMethods) {
      if (!definedMethods.has(method)) failures.push(`${method} ${routePath} has no API boundary definition`)
    }
  }

  const routePathSet = new Set(routeFiles.map(routePathForFile))
  for (const [routePath, definitions] of definitionsByRoute.entries()) {
    if (!routePathSet.has(routePath)) {
      const methods = definitions.map((definition) => definition.method).join(', ')
      failures.push(`${routePath} is defined for ${methods} but has no src/app/api/v1 route file`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`Web API docs coverage failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  }
}

function groupDefinitionsByRoutePath() {
  const grouped = new Map<string, WebApiBoundaryDefinition[]>()
  for (const definition of webApiBoundaryDefinitions) {
    const routePath = definition.routePath ?? definition.path
    const existing = grouped.get(routePath) ?? []
    existing.push(definition)
    grouped.set(routePath, existing)
  }
  return grouped
}

async function listRouteFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listRouteFiles(entryPath)))
    } else if (entry.isFile() && entry.name === 'route.ts') {
      files.push(entryPath)
    }
  }

  return files.sort()
}

function routePathForFile(file: string) {
  const relativeDir = path.relative(appApiDir, path.dirname(file)).split(path.sep).join('/')
  return `/api/v1/${relativeDir}`.replace(/\/+$/, '')
}

function exportedRouteMethods(fileText: string) {
  const methods = new Set<string>()
  for (const match of fileText.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) {
    const method = match[1]
    if (method) methods.add(method)
  }
  return methods
}

function operationIdFor(definition: WebApiBoundaryDefinition) {
  const suffix = definition.path
    .replace(/^\/api\/v1\/?/, '')
    .replace(/\{([^}]+)\}/g, '$1')
    .split(/[/-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  return `${definition.method.toLowerCase()}${suffix || 'Root'}`
}

function schemaName(definition: WebApiBoundaryDefinition, suffix: string) {
  return `${operationIdFor(definition)}${suffix}`
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
