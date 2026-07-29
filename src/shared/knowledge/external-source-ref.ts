export const CONNECTED_KNOWLEDGE_SOURCE_RECIPES = [
  'google-drive-file',
  'dropbox-file',
  'notion-page',
  'confluence-page',
] as const

export type ConnectedKnowledgeSourceRecipe =
  (typeof CONNECTED_KNOWLEDGE_SOURCE_RECIPES)[number]

export type ConnectedKnowledgeSourceRef = {
  recipe: ConnectedKnowledgeSourceRecipe
  resourceId: string
}

const PREFIX = 'overlay-source:v1:'

export function buildConnectedKnowledgeSourceRef(
  value: ConnectedKnowledgeSourceRef,
): string {
  const resourceId = value.resourceId.trim()
  if (!resourceId) throw new Error('Connected source identifier is required')
  return `${PREFIX}${value.recipe}:${encodeURIComponent(resourceId)}`
}

export function parseConnectedKnowledgeSourceRef(
  value: string,
): ConnectedKnowledgeSourceRef | null {
  if (!value.startsWith(PREFIX)) return null
  const separator = value.indexOf(':', PREFIX.length)
  if (separator < 0) return null
  const recipe = value.slice(PREFIX.length, separator)
  if (!(CONNECTED_KNOWLEDGE_SOURCE_RECIPES as readonly string[]).includes(recipe)) {
    return null
  }
  let resourceId: string
  try {
    resourceId = decodeURIComponent(value.slice(separator + 1)).trim()
  } catch {
    return null
  }
  if (!resourceId || resourceId.length > 2_000) return null
  return {
    recipe: recipe as ConnectedKnowledgeSourceRecipe,
    resourceId,
  }
}
