import type { Nodes } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { KnowledgeFile } from './contracts'

export type FileLinkNode = Pick<KnowledgeFile, '_id' | 'name' | 'parentId' | 'scope' | 'userId' | 'type' | 'kind' | 'archivedAt'>
type FileLink = { kind: 'ordinary' } | { kind: 'unavailable' } | { kind: 'relative'; segments: string[]; fragment: string }

function classifyLink(href: string): FileLink {
  if (!href || href.length > 2048 || /[\u0000-\u001f\u007f]/u.test(href)) return { kind: 'unavailable' }
  if (href.startsWith('#') || href.startsWith('?') || /^https?:|^mailto:/i.test(href)) return { kind: 'ordinary' }
  if (href.startsWith('/') && !href.startsWith('//')) return { kind: 'ordinary' }
  const hash = href.indexOf('#'), raw = hash < 0 ? href : href.slice(0, hash)
  if (raw.includes('?')) return { kind: 'unavailable' }
  let path: string
  try { path = decodeURIComponent(raw) } catch { return { kind: 'unavailable' } }
  if (/^[a-z][a-z\d+.-]*:|^[\/\\]|[\\\u0000-\u001f\u007f]/iu.test(path)) return { kind: 'unavailable' }
  path = path.replace(/^(?:\.\/)+/, '').replace(/\/$/, '')
  const segments = path.split('/')
  if (segments.length > 16 || segments.some(segment => !segment || segment === '.' || segment === '..')) return { kind: 'unavailable' }
  return { kind: 'relative', segments, fragment: hash < 0 ? '' : href.slice(hash) }
}

function relativeLinks(content: string): Map<string, Extract<FileLink, { kind: 'relative' }>> {
  const links = new Map<string, Extract<FileLink, { kind: 'relative' }>>()
  if (content.length > 1_000_000) return links
  const stack: Nodes[] = [fromMarkdown(content, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })]
  const nodes: Nodes[] = [], definitions = new Map<string, string>()
  while (stack.length) {
    const node = stack.pop()
    if (!node) break
    nodes.push(node)
    if (node.type === 'definition') definitions.set(node.identifier.toLowerCase(), node.url)
    if ('children' in node) stack.push(...node.children)
  }
  for (const node of nodes) {
    const href = node.type === 'link' ? node.url : node.type === 'linkReference' ? definitions.get(node.identifier.toLowerCase()) : undefined
    if (!href) continue
    const link = classifyLink(href)
    if (link.kind === 'relative' && links.size < 128) links.set(href, link)
  }
  return links
}

/** Only walk declared descendants through the host's authenticated, scoped metadata reader. */
export async function resolveFileMarkdownLinks({ content, file, listChildren }: {
  content: string
  file: FileLinkNode
  listChildren(parentId: string | null): Promise<readonly FileLinkNode[]>
}): Promise<ReadonlyMap<string, FileLinkNode>> {
  const scope = file.scope ?? 'personal', cache = new Map<string | null, Promise<readonly FileLinkNode[]>>()
  function children(parentId: string | null) {
    let rows = cache.get(parentId)
    if (!rows) {
      if (cache.size >= 64) return Promise.resolve([])
      rows = listChildren(parentId).catch(() => [])
      cache.set(parentId, rows)
    }
    return rows
  }
  const targets = new Map<string, FileLinkNode>()
  await Promise.all([...relativeLinks(content)].map(async ([href, link]) => {
    let parentId = file.parentId
    for (const [index, segment] of link.segments.entries()) {
      const matches = (await children(parentId)).filter(node => node.parentId === parentId && node.name === segment
        && (node.scope ?? 'personal') === scope && node.archivedAt === undefined
        && (scope === 'workspace' || !file.userId || node.userId === file.userId))
      if (matches.length !== 1) return
      const match = matches[0]
      if (!match) return
      if (index === link.segments.length - 1) { targets.set(href, match); return }
      if (match.type !== 'folder' && match.kind !== 'folder') return
      parentId = match._id
    }
  }))
  return targets
}

export function fileMarkdownHref(href: string, targets: ReadonlyMap<string, FileLinkNode>): string | undefined {
  const link = classifyLink(href)
  if (link.kind === 'ordinary') return href
  if (link.kind === 'unavailable') return undefined
  const target = targets.get(href)
  if (!target) return undefined
  const key = target.type === 'folder' || target.kind === 'folder' ? 'folder' : 'file'
  return `?${key}=${encodeURIComponent(target._id)}${link.fragment}`
}
