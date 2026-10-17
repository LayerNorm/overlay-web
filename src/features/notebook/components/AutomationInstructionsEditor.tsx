'use client'
import { unstyledButton } from '../../control-reset'
import { Button } from '@overlay/ui/primitives'

import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Link from '@tiptap/extension-link'
import Mention from '@tiptap/extension-mention'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import Typography from '@tiptap/extension-typography'
import { Bold, Code, Italic, List, ListOrdered, ListTodo, Quote } from 'lucide-react'
import { common, createLowlight } from 'lowlight'
import { overlayMentionSuggestion } from './tiptap-mention-suggestion'
import { serializeMentionToken } from '@/shared/knowledge/mention-tokens'
import type { MentionType } from '@/shared/knowledge/mention-types'

const lowlight = createLowlight(common)
const markdownLineBreak = /\r\n?/g
const htmlTagPattern = /<\/?[a-z][\s\S]*>/i

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseInlineMarkdown(value: string): string {
  let html = escapeHtml(value)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
  html = html.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
  // Round-trip overlay mention tokens. Pattern: `@<label> [[overlay:type:id]]`.
  // Both `@<label>` and the token survive escapeHtml because none of those chars are escaped.
  html = html.replace(
    /@([^\s@\[]{1,80})\s\[\[overlay:([a-z]+):([^\]]+)\]\]/g,
    (_match, label: string, type: string, id: string) =>
      `<span data-type="mention" data-id="${escapeHtml(`${type}:${id}`)}" data-label="${escapeHtml(label)}">@${escapeHtml(label)}</span>`,
  )
  return html
}

function renderParagraph(lines: string[]): string {
  const content = lines.map((line) => parseInlineMarkdown(line)).join('<br />')
  return content ? `<p>${content}</p>` : ''
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(markdownLineBreak, '\n').split('\n')
  const blocks: string[] = []
  let paragraphLines: string[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let codeLines: string[] = []
  let inCodeBlock = false

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      const paragraph = renderParagraph(paragraphLines)
      if (paragraph) blocks.push(paragraph)
      paragraphLines = []
    }
  }
  const flushList = () => {
    if (listType && listItems.length > 0) blocks.push(`<${listType}>${listItems.join('')}</${listType}>`)
    listItems = []
    listType = null
  }
  const flushCodeBlock = () => {
    if (inCodeBlock) {
      blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      codeLines = []
      inCodeBlock = false
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.startsWith('```')) {
      flushParagraph()
      flushList()
      if (inCodeBlock) flushCodeBlock()
      else {
        inCodeBlock = true
        codeLines = []
      }
      continue
    }
    if (inCodeBlock) {
      codeLines.push(rawLine)
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      const level = headingMatch[1].length
      blocks.push(`<h${level}>${parseInlineMarkdown(headingMatch[2])}</h${level}>`)
      continue
    }
    if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) {
      flushParagraph()
      flushList()
      blocks.push('<hr />')
      continue
    }
    const blockquoteMatch = line.match(/^>\s+(.+)$/)
    if (blockquoteMatch) {
      flushParagraph()
      flushList()
      blocks.push(`<blockquote><p>${parseInlineMarkdown(blockquoteMatch[1])}</p></blockquote>`)
      continue
    }
    const unorderedMatch = line.match(/^[-*]\s+(.+)$/)
    if (unorderedMatch) {
      flushParagraph()
      if (listType && listType !== 'ul') flushList()
      listType = 'ul'
      listItems.push(`<li><p>${parseInlineMarkdown(unorderedMatch[1])}</p></li>`)
      continue
    }
    const orderedMatch = line.match(/^\d+\.\s+(.+)$/)
    if (orderedMatch) {
      flushParagraph()
      if (listType && listType !== 'ol') flushList()
      listType = 'ol'
      listItems.push(`<li><p>${parseInlineMarkdown(orderedMatch[1])}</p></li>`)
      continue
    }
    flushList()
    paragraphLines.push(line)
  }

  flushParagraph()
  flushList()
  flushCodeBlock()
  return blocks.join('')
}

function marksToMarkdown(text: string, marks: JSONContent['marks']): string {
  let value = text
  for (const mark of marks ?? []) {
    if (mark.type === 'code') value = `\`${value}\``
    if (mark.type === 'bold') value = `**${value}**`
    if (mark.type === 'italic') value = `*${value}*`
    if (mark.type === 'strike') value = `~~${value}~~`
    if (mark.type === 'link' && typeof mark.attrs?.href === 'string') value = `[${value}](${mark.attrs.href})`
  }
  return value
}

function inlineContentToMarkdown(content: JSONContent[] | undefined): string {
  return (content ?? [])
    .map((node) => {
      if (node.type === 'text') return marksToMarkdown(node.text ?? '', node.marks)
      if (node.type === 'hardBreak') return '\n'
      if (node.type === 'mention') {
        const packed = (node.attrs?.id as string | undefined) ?? ''
        const label = (node.attrs?.label as string | undefined) ?? ''
        // id is packed as `type:id` (e.g. "file:k123abc"). Split once.
        const colonIdx = packed.indexOf(':')
        if (colonIdx <= 0) return label ? `@${label}` : ''
        const type = packed.slice(0, colonIdx) as MentionType
        const id = packed.slice(colonIdx + 1)
        if (!id) return label ? `@${label}` : ''
        return `@${label} ${serializeMentionToken(type, id)}`
      }
      return node.content ? inlineContentToMarkdown(node.content) : ''
    })
    .join('')
}

function blockToMarkdown(node: JSONContent, orderedIndex?: number): string {
  if (node.type === 'paragraph') return inlineContentToMarkdown(node.content)
  if (node.type === 'heading') return `${'#'.repeat(Number(node.attrs?.level ?? 2))} ${inlineContentToMarkdown(node.content)}`
  if (node.type === 'blockquote') {
    return (node.content ?? []).map((child) => `> ${blockToMarkdown(child)}`).join('\n')
  }
  if (node.type === 'codeBlock') return `\`\`\`\n${inlineContentToMarkdown(node.content)}\n\`\`\``
  if (node.type === 'horizontalRule') return '---'
  if (node.type === 'bulletList') {
    return (node.content ?? []).map((child) => blockToMarkdown(child)).join('\n')
  }
  if (node.type === 'orderedList') {
    return (node.content ?? []).map((child, index) => blockToMarkdown(child, index + 1)).join('\n')
  }
  if (node.type === 'taskList') {
    return (node.content ?? []).map((child) => blockToMarkdown(child)).join('\n')
  }
  if (node.type === 'listItem' || node.type === 'taskItem') {
    const childText = (node.content ?? []).map((child) => blockToMarkdown(child)).filter(Boolean).join('\n')
    const prefix = node.type === 'taskItem'
      ? `- [${node.attrs?.checked ? 'x' : ' '}] `
      : orderedIndex
        ? `${orderedIndex}. `
        : '- '
    return childText
      .split('\n')
      .map((line, index) => (index === 0 ? `${prefix}${line}` : `  ${line}`))
      .join('\n')
  }
  return inlineContentToMarkdown(node.content)
}

function docToMarkdown(doc: JSONContent): string {
  return (doc.content ?? [])
    .map((node) => blockToMarkdown(node))
    .filter((block) => block.trim().length > 0)
    .join('\n\n')
}

function normalizeMarkdownInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return htmlTagPattern.test(trimmed) ? value : markdownToHtml(value)
}

function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button variant="ghost"
      type="button"
      onClick={onClick}
      className={unstyledButton(`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-(--foreground) text-(--background)'
          : 'text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)'
      }`)}
      aria-label={label}
    >
      {children}
    </Button>
  )
}

export function AutomationInstructionsEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [initialContent] = useState(() => normalizeMarkdownInput(value))
  const [expanded, setExpanded] = useState(false)
  const lastEmittedValueRef = useRef(value)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
      }),
      Placeholder.configure({
        placeholder: 'Write the automation instructions... Markdown formatting is supported.',
        showOnlyWhenEditable: true,
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'plaintext',
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Typography,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ['http', 'https', 'mailto'],
      }),
      Mention.configure({
        HTMLAttributes: {
          class:
            'inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md bg-(--surface-muted) border border-(--border) text-xs font-medium text-(--foreground) align-baseline',
        },
        renderText: ({ node }) => `@${node.attrs.label}`,
        suggestion: overlayMentionSuggestion,
      }),
    ],
    content: initialContent,
    immediatelyRender: false,
    onUpdate: ({ editor: currentEditor }) => {
      const next = docToMarkdown(currentEditor.getJSON())
      lastEmittedValueRef.current = next
      onChange(next)
    },
    editorProps: {
      attributes: {
        class: 'app-note-editor min-h-72 px-3 py-3 text-sm leading-6 outline-hidden',
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    if (value === lastEmittedValueRef.current) return
    const next = normalizeMarkdownInput(value)
    if (next !== editor.getHTML()) {
      editor.commands.setContent(next, { emitUpdate: false })
    }
    lastEmittedValueRef.current = value
  }, [editor, value])

  return (
    <div className="mt-1 overflow-hidden rounded-xl border border-(--border) bg-(--background)">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--border) bg-(--surface-elevated) px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <ToolbarButton active={editor?.isActive('bold')} label="Bold" onClick={() => editor?.chain().focus().toggleBold().run()}>
            <Bold size={14} />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive('italic')} label="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()}>
            <Italic size={14} />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive('code')} label="Code" onClick={() => editor?.chain().focus().toggleCode().run()}>
            <Code size={14} />
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-(--border)" />
          <ToolbarButton active={editor?.isActive('bulletList')} label="Bullet list" onClick={() => editor?.chain().focus().toggleBulletList().run()}>
            <List size={14} />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive('orderedList')} label="Numbered list" onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
            <ListOrdered size={14} />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive('taskList')} label="Task list" onClick={() => editor?.chain().focus().toggleTaskList().run()}>
            <ListTodo size={14} />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive('blockquote')} label="Quote" onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
            <Quote size={14} />
          </ToolbarButton>
        </div>
        <Button variant="ghost"
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className={unstyledButton(`rounded-md px-2 py-1 text-[11px] font-medium text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)`)}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </Button>
      </div>
      <div className={expanded ? 'max-h-128 overflow-y-auto' : 'max-h-36 overflow-hidden'}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
