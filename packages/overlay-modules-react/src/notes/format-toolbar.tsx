'use client'

import type { ReactNode } from 'react'
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

      {open && <NotebookFormatToolbarActions editor={editor} />}
    </div>
  )
}

function NotebookFormatToolbarDivider() {
  return <div className={floatingToolbarDividerClass} />
}

interface NotebookFormatToolbarButtonProps {
  label: string
  active: boolean
  onClick: () => void
  children: ReactNode
}

function NotebookFormatToolbarButton({ label, active, onClick, children }: NotebookFormatToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${floatingToolbarButtonClass} ${active ? floatingToolbarActiveButtonClass : ''}`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

function NotebookFormatToolbarActions({ editor }: { editor: NotebookFormatEditor | null }) {
  const applyFormat = (command: (chain: NotebookFormatCommandChain) => { run: () => boolean }) => () => {
    if (!editor) return
    command(editor.chain().focus()).run()
  }
  const isActive = (nameOrAttributes: string | Record<string, string>, attributes?: Record<string, unknown>) =>
    editor ? editor.isActive(nameOrAttributes, attributes) : false

  return (
    <>
      <NotebookFormatToolbarDivider />
      <NotebookFormatToolbarButton
        label="Heading 1"
        active={isActive('heading', { level: 1 })}
        onClick={applyFormat((chain) => chain.toggleHeading({ level: 1 }))}
      >
        <Heading1 size={15} />
      </NotebookFormatToolbarButton>
      <NotebookFormatToolbarButton
        label="Heading 2"
        active={isActive('heading', { level: 2 })}
        onClick={applyFormat((chain) => chain.toggleHeading({ level: 2 }))}
      >
        <Heading2 size={15} />
      </NotebookFormatToolbarButton>
      <NotebookFormatToolbarDivider />
      <NotebookFormatToolbarButton
        label="Bold"
        active={isActive('bold')}
        onClick={applyFormat((chain) => chain.toggleBold())}
      >
        <Bold size={15} />
      </NotebookFormatToolbarButton>
      <NotebookFormatToolbarButton
        label="Italic"
        active={isActive('italic')}
        onClick={applyFormat((chain) => chain.toggleItalic())}
      >
        <Italic size={15} />
      </NotebookFormatToolbarButton>
      <NotebookFormatToolbarButton
        label="Underline"
        active={isActive('underline')}
        onClick={applyFormat((chain) => chain.toggleUnderline())}
      >
        <UnderlineIcon size={15} />
      </NotebookFormatToolbarButton>
      <NotebookFormatToolbarButton
        label="Strikethrough"
        active={isActive('strike')}
        onClick={applyFormat((chain) => chain.toggleStrike())}
      >
        <Strikethrough size={15} />
      </NotebookFormatToolbarButton>
      <NotebookFormatToolbarButton
        label="Inline code"
        active={isActive('code')}
        onClick={applyFormat((chain) => chain.toggleCode())}
      >
        <Code size={15} />
      </NotebookFormatToolbarButton>
      <NotebookFormatToolbarButton
        label="Highlight"
        active={isActive('highlight')}
        onClick={applyFormat((chain) => chain.toggleHighlight())}
      >
        <Highlighter size={15} />
      </NotebookFormatToolbarButton>
      <NotebookFormatToolbarDivider />
      <NotebookFormatToolbarButton
        label="Bullet list"
        active={isActive('bulletList')}
        onClick={applyFormat((chain) => chain.toggleBulletList())}
      >
        <List size={15} />
      </NotebookFormatToolbarButton>
      <NotebookFormatToolbarButton
        label="Numbered list"
        active={isActive('orderedList')}
        onClick={applyFormat((chain) => chain.toggleOrderedList())}
      >
        <ListOrdered size={15} />
      </NotebookFormatToolbarButton>
      <NotebookFormatToolbarButton
        label="Task list"
        active={isActive('taskList')}
        onClick={applyFormat((chain) => chain.toggleTaskList())}
      >
        <ListTodo size={15} />
      </NotebookFormatToolbarButton>
      <NotebookFormatToolbarDivider />
      <NotebookFormatToolbarButton
        label="Align left"
        active={isActive({ textAlign: 'left' })}
        onClick={applyFormat((chain) => chain.setTextAlign('left'))}
      >
        <AlignLeft size={15} />
      </NotebookFormatToolbarButton>
      <NotebookFormatToolbarButton
        label="Align center"
        active={isActive({ textAlign: 'center' })}
        onClick={applyFormat((chain) => chain.setTextAlign('center'))}
      >
        <AlignCenter size={15} />
      </NotebookFormatToolbarButton>
      <NotebookFormatToolbarButton
        label="Align right"
        active={isActive({ textAlign: 'right' })}
        onClick={applyFormat((chain) => chain.setTextAlign('right'))}
      >
        <AlignRight size={15} />
      </NotebookFormatToolbarButton>
    </>
  )
}
