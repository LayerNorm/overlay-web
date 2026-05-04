const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i
const LINE_BREAK_PATTERN = /\r\n?/g

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, '')).trim()
}

function convertInlineHtml(value: string): string {
  let markdown = value

  markdown = markdown.replace(/<br\s*\/?>/gi, '\n')
  markdown = markdown.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, text: string) => {
    const label = convertInlineHtml(text).trim() || href
    return `[${label}](${decodeHtml(href)})`
  })
  markdown = markdown.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, text: string) => `**${convertInlineHtml(text).trim()}**`)
  markdown = markdown.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, text: string) => `*${convertInlineHtml(text).trim()}*`)
  markdown = markdown.replace(/<(s|strike|del)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, text: string) => `~~${convertInlineHtml(text).trim()}~~`)
  markdown = markdown.replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, (_match, text: string) => `__${convertInlineHtml(text).trim()}__`)
  markdown = markdown.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, text: string) => `\`${stripTags(text).replace(/`/g, '\\`')}\``)
  markdown = markdown.replace(/<(span|div)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, text: string) => convertInlineHtml(text))

  return decodeHtml(markdown.replace(/<[^>]+>/g, ''))
}

function convertTable(html: string): string {
  const rows = Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map((rowMatch) => {
    const rowHtml = rowMatch[1]
    return Array.from(rowHtml.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)).map((cellMatch) =>
      escapeMarkdownCell(convertInlineHtml(cellMatch[1])),
    )
  }).filter((row) => row.length > 0)

  if (rows.length === 0) return ''

  const columnCount = Math.max(...rows.map((row) => row.length))
  const normalizeRow = (row: string[]) => [...row, ...Array(Math.max(columnCount - row.length, 0)).fill('')]
  const header = normalizeRow(rows[0])
  const separator = header.map(() => '---')
  const bodyRows = rows.slice(1).map(normalizeRow)

  return [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...bodyRows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function convertList(html: string, ordered: boolean, taskList: boolean): string {
  let index = 0
  return Array.from(html.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)).map((match) => {
    index += 1
    const attrs = match[1] ?? ''
    const rawItem = match[2]
      .replace(/<ul\b[\s\S]*?<\/ul>/gi, '')
      .replace(/<ol\b[\s\S]*?<\/ol>/gi, '')
    const checked = /data-checked=["']true["']|checked/i.test(attrs) || /<input\b[^>]*checked/i.test(rawItem)
    const text = convertInlineHtml(rawItem.replace(/<input\b[^>]*>/gi, '')).trim()
    if (taskList) return `- [${checked ? 'x' : ' '}] ${text}`
    return ordered ? `${index}. ${text}` : `- ${text}`
  }).join('\n')
}

export function htmlToMarkdown(html: string): string {
  let source = html.replace(LINE_BREAK_PATTERN, '\n')
  const blocks: string[] = []

  source = source.replace(/<pre\b[^>]*>\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_match, attrs: string, code: string) => {
    const language = attrs.match(/language-([a-z0-9_-]+)/i)?.[1] ?? ''
    blocks.push(`\`\`\`${language}\n${stripTags(code)}\n\`\`\``)
    return `\n\n@@BLOCK_${blocks.length - 1}@@\n\n`
  })

  source = source.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_match, table: string) => {
    blocks.push(convertTable(table))
    return `\n\n@@BLOCK_${blocks.length - 1}@@\n\n`
  })

  source = source.replace(/<(ul|ol)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_match, tag: string, attrs: string, listHtml: string) => {
    const taskList = /data-type=["']taskList["']/i.test(attrs)
    blocks.push(convertList(listHtml, tag.toLowerCase() === 'ol', taskList))
    return `\n\n@@BLOCK_${blocks.length - 1}@@\n\n`
  })

  source = source.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, quote: string) => {
    const text = htmlToMarkdown(quote)
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => `> ${line}`)
      .join('\n')
    return `\n\n${text}\n\n`
  })

  source = source.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, text: string) => {
    return `\n\n${'#'.repeat(Number(level))} ${convertInlineHtml(text).trim()}\n\n`
  })
  source = source.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_match, text: string) => {
    const paragraph = convertInlineHtml(text).trim()
    return paragraph ? `\n\n${paragraph}\n\n` : '\n\n'
  })
  source = source.replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
  source = source.replace(/<br\s*\/?>/gi, '\n')
  source = convertInlineHtml(source)
  source = source.replace(/@@BLOCK_(\d+)@@/g, (_match, index: string) => blocks[Number(index)] ?? '')

  return source
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseInlineMarkdown(value: string): string {
  let html = escapeHtml(value)

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<u>$1</u>')
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
  html = html.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')

  return html
}

function renderParagraph(lines: string[]): string {
  const content = lines.map((line) => parseInlineMarkdown(line)).join('<br />')
  return content ? `<p>${content}</p>` : ''
}

function parseTableRow(line: string): string[] | null {
  const match = line.match(/^\|(.+)\|$/)
  if (!match) return null
  return match[1].split('|').map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

function isTableSeparator(line: string): boolean {
  return /^\|(?:\s*:?-+:?\s*\|)+$/.test(line.trim())
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(LINE_BREAK_PATTERN, '\n').split('\n')
  const blocks: string[] = []
  let paragraphLines: string[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' | 'task' | null = null
  let codeLines: string[] = []
  let codeLanguage = ''
  let inCodeBlock = false
  let tableRows: string[][] = []
  let inTable = false
  let tableHasHeader = false

  const flushParagraph = (): void => {
    if (paragraphLines.length > 0) {
      const paragraph = renderParagraph(paragraphLines)
      if (paragraph) blocks.push(paragraph)
      paragraphLines = []
    }
  }

  const flushList = (): void => {
    if (!listType || listItems.length === 0) return
    if (listType === 'task') {
      blocks.push(`<ul data-type="taskList">${listItems.join('')}</ul>`)
    } else {
      blocks.push(`<${listType}>${listItems.join('')}</${listType}>`)
    }
    listItems = []
    listType = null
  }

  const flushCodeBlock = (): void => {
    if (!inCodeBlock) return
    const languageClass = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : ''
    blocks.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    codeLines = []
    codeLanguage = ''
    inCodeBlock = false
  }

  const flushTable = (): void => {
    if (tableRows.length === 0) return
    const header = tableRows[0]
    const bodyRows = tableHasHeader ? tableRows.slice(1) : tableRows
    const thead = tableHasHeader
      ? `<thead><tr>${header.map((cell) => `<th>${parseInlineMarkdown(cell)}</th>`).join('')}</tr></thead>`
      : ''
    const tbody = bodyRows.length > 0
      ? `<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${parseInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
      : ''
    blocks.push(`<table>${thead}${tbody}</table>`)
    tableRows = []
    inTable = false
    tableHasHeader = false
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    if (line.startsWith('```')) {
      flushParagraph()
      flushList()
      flushTable()
      if (inCodeBlock) {
        flushCodeBlock()
      } else {
        inCodeBlock = true
        codeLanguage = line.replace(/^```/, '').trim()
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(rawLine)
      continue
    }

    const tableRow = parseTableRow(line)
    if (tableRow) {
      flushParagraph()
      flushList()
      inTable = true
      if (isTableSeparator(line)) {
        tableHasHeader = true
      } else {
        tableRows.push(tableRow)
      }
      continue
    }

    if (inTable) flushTable()

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      const level = headingMatch[1].length
      blocks.push(`<h${level}>${parseInlineMarkdown(headingMatch[2])}</h${level}>`)
      continue
    }

    if (/^---+$/.test(line.trim())) {
      flushParagraph()
      flushList()
      blocks.push('<hr />')
      continue
    }

    const taskMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/)
    if (taskMatch) {
      flushParagraph()
      if (listType && listType !== 'task') flushList()
      listType = 'task'
      const checked = taskMatch[1].toLowerCase() === 'x'
      listItems.push(`<li data-checked="${checked ? 'true' : 'false'}">${parseInlineMarkdown(taskMatch[2])}</li>`)
      continue
    }

    const unorderedMatch = line.match(/^[-*]\s+(.+)$/)
    if (unorderedMatch) {
      flushParagraph()
      if (listType && listType !== 'ul') flushList()
      listType = 'ul'
      listItems.push(`<li>${parseInlineMarkdown(unorderedMatch[1])}</li>`)
      continue
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/)
    if (orderedMatch) {
      flushParagraph()
      if (listType && listType !== 'ol') flushList()
      listType = 'ol'
      listItems.push(`<li>${parseInlineMarkdown(orderedMatch[1])}</li>`)
      continue
    }

    if (line.startsWith('> ')) {
      flushParagraph()
      flushList()
      blocks.push(`<blockquote><p>${parseInlineMarkdown(line.slice(2))}</p></blockquote>`)
      continue
    }

    paragraphLines.push(line)
  }

  flushCodeBlock()
  flushTable()
  flushParagraph()
  flushList()

  return blocks.join('')
}

export function normalizeHtmlForMobileMarkdown(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ''
  return HTML_TAG_PATTERN.test(trimmed) ? htmlToMarkdown(content) : content
}

export function toStoredHtml(markdown: string): string {
  const trimmed = markdown.trim()
  if (!trimmed) return ''
  return HTML_TAG_PATTERN.test(trimmed) ? trimmed : markdownToHtml(trimmed)
}

export type MarkdownBlockType =
  | 'paragraph'
  | 'heading'
  | 'unordered_list'
  | 'ordered_list'
  | 'task_list'
  | 'blockquote'
  | 'code'
  | 'horizontal_rule'
  | 'table'

export interface MarkdownBlock {
  type: MarkdownBlockType
  markdown: string
  key: string
}

function detectLineType(line: string): MarkdownBlockType | null {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('```')) return 'code'
  if (/^#{1,6}\s+/.test(trimmed)) return 'heading'
  if (/^[-*]\s+\[[ xX]\]\s+/.test(trimmed)) return 'task_list'
  if (/^[-*+]\s+/.test(trimmed)) return 'unordered_list'
  if (/^\d+\.\s+/.test(trimmed)) return 'ordered_list'
  if (/^>\s+/.test(trimmed)) return 'blockquote'
  if (/^(---|___|\*\*\*)\s*$/.test(trimmed)) return 'horizontal_rule'
  if (/^\|/.test(trimmed)) return 'table'
  if (line.trim().length === 0) return null
  return 'paragraph'
}

/**
 * Split markdown into individually editable blocks.
 * Blank lines separate blocks, except inside fenced code blocks.
 */
export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(LINE_BREAK_PATTERN, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let currentType: MarkdownBlockType | null = null
  let currentLines: string[] = []
  let inCodeFence = false
  let blockIndex = 0

  const flush = () => {
    if (currentLines.length === 0) return
    const raw = currentLines.join('\n')
    // Preserve trailing newline for blocks that are meant to have one
    // (paragraphs often don't, lists often do) – keep raw exactly.
    blocks.push({ type: currentType ?? 'paragraph', markdown: raw, key: `block-${blockIndex++}` })
    currentLines = []
    currentType = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (inCodeFence) {
      currentLines.push(line)
      if (/^```\s*$/.test(line.trimStart())) {
        inCodeFence = false
        flush()
      }
      continue
    }

    if (/^```\s*\S*\s*$/.test(line.trimStart())) {
      flush()
      inCodeFence = true
      currentType = 'code'
      currentLines.push(line)
      continue
    }

    if (line.trim().length === 0) {
      flush()
      continue
    }

    const lineType = detectLineType(line)

    if (lineType === 'horizontal_rule') {
      flush()
      blocks.push({ type: 'horizontal_rule', markdown: line, key: `block-${blockIndex++}` })
      continue
    }

    if (currentType === null) {
      currentType = lineType
      currentLines.push(line)
    } else if (currentType === lineType) {
      currentLines.push(line)
    } else {
      flush()
      currentType = lineType
      currentLines.push(line)
    }
  }

  flush()

  return blocks
}

/** Re-assemble blocks back into a single markdown string. */
export function blocksToMarkdown(blocks: MarkdownBlock[]): string {
  return blocks.map((b) => b.markdown).join('\n\n')
}
