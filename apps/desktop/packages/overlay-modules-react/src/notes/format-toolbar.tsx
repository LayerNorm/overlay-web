'use client'

import { useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronLeft,
  ChevronRight,
  Code,
  Heading1,
  Heading2,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Pencil,
  Strikethrough,
  Underline as UnderlineIcon,
} from 'lucide-react'

export interface NotebookFormatCommandChain {
  focus: (position?: 'start') => NotebookFormatCommandChain
  toggleHeading: (attributes: { level: 1 | 2 }) => { run: () => boolean }
  toggleBold: () => { run: () => boolean }
  toggleItalic: () => { run: () => boolean }
  toggleUnderline: () => { run: () => boolean }
  toggleStrike: () => { run: () => boolean }
  toggleCode: () => { run: () => boolean }
  toggleHighlight: () => { run: () => boolean }
  toggleBulletList: () => { run: () => boolean }
  toggleOrderedList: () => { run: () => boolean }
  toggleTaskList: () => { run: () => boolean }
  setTextAlign: (align: 'left' | 'center' | 'right') => { run: () => boolean }
}

export interface NotebookFormatEditor {
  chain: () => NotebookFormatCommandChain
  isActive: (nameOrAttributes: string | Record<string, string>, attributes?: Record<string, unknown>) => boolean
}

export interface NotebookFloatingFormatToolbarProps {
  editor: NotebookFormatEditor | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const floatingToolbarButtonClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40'

const floatingToolbarActiveButtonClass =
  'bg-[var(--surface-subtle)] text-[var(--foreground)]'

const floatingToolbarDividerClass = 'mx-1 h-5 w-px shrink-0 bg-[var(--border)]'

export function NotebookFloatingFormatToolbar({
  editor,
  open,
  onOpenChange,
}: NotebookFloatingFormatToolbarProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <div className="absolute bottom-5 right-5 z-30 flex max-w-[calc(100%-2.5rem)] items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-1.5 shadow-lg">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        aria-label={open ? 'Close formatting toolbar' : 'Open formatting toolbar'}
        aria-expanded={open}
        title={open ? 'Close formatting toolbar' : 'Formatting'}
      >
        {open ? (
          <ChevronRight size={16} />
        ) : hovered ? (
          <ChevronLeft size={16} />
        ) : (
          <Pencil size={16} />
        )}
      </button>

      {open && (
        <>
          <div className={floatingToolbarDividerClass} />
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive('heading', { level: 1 }) ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Heading 1"
            title="Heading 1"
          >
            <Heading1 size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive('heading', { level: 2 }) ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Heading 2"
            title="Heading 2"
          >
            <Heading2 size={15} />
          </button>
          <div className={floatingToolbarDividerClass} />
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive('bold') ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Bold"
            title="Bold"
          >
            <Bold size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive('italic') ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Italic"
            title="Italic"
          >
            <Italic size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive('underline') ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Underline"
            title="Underline"
          >
            <UnderlineIcon size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleStrike().run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive('strike') ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Strikethrough"
            title="Strikethrough"
          >
            <Strikethrough size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleCode().run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive('code') ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Inline code"
            title="Inline code"
          >
            <Code size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleHighlight().run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive('highlight') ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Highlight"
            title="Highlight"
          >
            <Highlighter size={15} />
          </button>
          <div className={floatingToolbarDividerClass} />
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive('bulletList') ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Bullet list"
            title="Bullet list"
          >
            <List size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive('orderedList') ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Numbered list"
            title="Numbered list"
          >
            <ListOrdered size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive('taskList') ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Task list"
            title="Task list"
          >
            <ListTodo size={15} />
          </button>
          <div className={floatingToolbarDividerClass} />
          <button
            type="button"
            onClick={() => editor?.chain().focus().setTextAlign('left').run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive({ textAlign: 'left' }) ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Align left"
            title="Align left"
          >
            <AlignLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().setTextAlign('center').run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive({ textAlign: 'center' }) ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Align center"
            title="Align center"
          >
            <AlignCenter size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().setTextAlign('right').run()}
            className={`${floatingToolbarButtonClass} ${
              editor?.isActive({ textAlign: 'right' }) ? floatingToolbarActiveButtonClass : ''
            }`}
            aria-label="Align right"
            title="Align right"
          >
            <AlignRight size={15} />
          </button>
        </>
      )}
    </div>
  )
}
