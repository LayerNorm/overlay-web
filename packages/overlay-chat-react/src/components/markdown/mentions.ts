export type ChatMessageMention = { type: string; id: string; name: string }

type MarkdownNode = {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

const SKIPPED_PARENT_TYPES = new Set(['code', 'inlineCode', 'link', 'linkReference'])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Turns known @names in Markdown text nodes into safe internal links. */
export function createMentionRemarkPlugin(mentions?: ChatMessageMention[]) {
  const unique = [...new Map(
    (mentions ?? [])
      .filter((mention) => mention.name.trim())
      .map((mention) => [mention.name.trim().toLocaleLowerCase(), { ...mention, name: mention.name.trim() }]),
  ).values()].sort((left, right) => right.name.length - left.name.length)
  const byName = new Map(unique.map((mention) => [mention.name.toLocaleLowerCase(), mention]))
  const pattern = unique.length
    ? new RegExp(`@(${unique.map((mention) => escapeRegExp(mention.name)).join('|')})(?![\\p{L}\\p{N}_-])`, 'giu')
    : null

  return function mentionRemarkPlugin() {
    return function transform(tree: MarkdownNode) {
      if (!pattern) return
      const mentionPattern = pattern
      visit(tree)

      function visit(parent: MarkdownNode) {
        if (!parent.children || SKIPPED_PARENT_TYPES.has(parent.type)) return
        for (let index = 0; index < parent.children.length; index++) {
          const node = parent.children[index]!
          if (node.type !== 'text' || typeof node.value !== 'string') {
            visit(node)
            continue
          }
          const replacements: MarkdownNode[] = []
          let lastIndex = 0
          mentionPattern.lastIndex = 0
          let match: RegExpExecArray | null
          while ((match = mentionPattern.exec(node.value)) !== null) {
            if (match.index > lastIndex) {
              replacements.push({ type: 'text', value: node.value.slice(lastIndex, match.index) })
            }
            const mention = byName.get((match[1] ?? '').toLocaleLowerCase())
            if (mention) {
              replacements.push({
                type: 'link',
                url: `#overlay-mention-${encodeURIComponent(mention.id)}`,
                children: [{ type: 'text', value: match[0] }],
              })
            } else {
              replacements.push({ type: 'text', value: match[0] })
            }
            lastIndex = mentionPattern.lastIndex
          }
          if (lastIndex === 0) continue
          if (lastIndex < node.value.length) {
            replacements.push({ type: 'text', value: node.value.slice(lastIndex) })
          }
          parent.children.splice(index, 1, ...replacements)
          index += replacements.length - 1
        }
      }
    }
  }
}

export function isMentionHref(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('#overlay-mention-')
}

export const mentionChipClass =
  'mx-0.5 inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 align-middle text-xs font-medium text-[var(--foreground)] no-underline!'
