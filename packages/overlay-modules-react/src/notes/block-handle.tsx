'use client'

import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { DOMSerializer } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import {
  Check,
  Copy,
  CopyPlus,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Plus,
  SquareCode,
  TextQuote,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import { editorHtmlToNoteMarkdown } from '@overlay/app-core/note-markdown'

const HANDLE_SIZE = 24
const HANDLE_WIDTH = 43
const LIST_ITEMS = new Set(['listItem', 'taskItem'])

interface HoveredBlock {
  pos: number
  node: ProseMirrorNode
  dom: HTMLElement
  top: number
  left: number
}

type BlockKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'codeBlock'

const TURN_INTO: Array<{ kind: BlockKind; label: string; icon: LucideIcon }> = [
  { kind: 'paragraph', label: 'Text', icon: Type },
  { kind: 'h1', label: 'Heading 1', icon: Heading1 },
  { kind: 'h2', label: 'Heading 2', icon: Heading2 },
  { kind: 'h3', label: 'Heading 3', icon: Heading3 },
  { kind: 'bulletList', label: 'Bulleted list', icon: List },
  { kind: 'orderedList', label: 'Numbered list', icon: ListOrdered },
  { kind: 'taskList', label: 'To-do list', icon: ListTodo },
  { kind: 'blockquote', label: 'Quote', icon: TextQuote },
  { kind: 'codeBlock', label: 'Code', icon: SquareCode },
]

const HANDLE_BUTTON_CLASS = unstyledButton('grid h-6 w-[22px] place-items-center rounded-[5px] text-(--muted-light) transition-colors hover:bg-(--surface-subtle) hover:text-(--muted)')
const MENU_ITEM_CLASS = 'gap-2 rounded-md px-2 py-1.5 text-[13px] text-(--foreground) [&_svg]:text-(--muted)'

/** The node and position of the top-level block (or list item) whose DOM element is `element`. */
function blockForElement(editor: Editor, element: HTMLElement): { pos: number; node: ProseMirrorNode } | null {
  const { view } = editor
  let inside: number
  try {
    inside = view.posAtDOM(element, 0)
  } catch {
    return null
  }
  // Nodes with content start one position after their opening; leaves (rules, images) start at it.
  for (const candidate of [inside - 1, inside]) {
    if (candidate < 0 || candidate > view.state.doc.content.size) continue
    const node = view.state.doc.nodeAt(candidate)
    if (node && view.nodeDOM(candidate) === element) return { pos: candidate, node }
  }
  return null
}

/** The block element under a pointer row: the nearest list item, otherwise the editor's direct child. */
function blockElementAt(root: HTMLElement, clientY: number): HTMLElement | null {
  const rect = root.getBoundingClientRect()
  const probeX = Math.min(rect.left + 32, rect.right - 2)
  let element = document.elementFromPoint(probeX, clientY) as HTMLElement | null
  if (!element || !root.contains(element) || element === root) return null
  const listItem = element.closest('li')
  if (listItem && root.contains(listItem)) return listItem
  while (element && element.parentElement !== root) element = element.parentElement
  return element
}

function currentKind(editor: Editor, block: HoveredBlock): BlockKind | null {
  const { node } = block
  if (node.type.name === 'heading') return `h${String(node.attrs.level)}` as BlockKind
  if (LIST_ITEMS.has(node.type.name)) {
    const parent = editor.state.doc.resolve(block.pos).parent
    return parent.type.name as BlockKind
  }
  return node.type.name as BlockKind
}

function blockMarkdown(editor: Editor, node: ProseMirrorNode): string {
  const container = document.createElement('div')
  container.appendChild(DOMSerializer.fromSchema(editor.schema).serializeNode(node))
  try {
    return editorHtmlToNoteMarkdown(container.innerHTML).trim()
  } catch {
    return node.textContent
  }
}

/** Selects the block and hands ProseMirror a move drag of it, so its own drop handling and drop cursor apply. */
function startBlockDrag(editor: Editor, block: HoveredBlock, event: DragEvent<HTMLButtonElement>): void {
  const { view } = editor
  const selection = NodeSelection.create(view.state.doc, block.pos)
  view.dispatch(view.state.tr.setSelection(selection))
  const slice = selection.content()
  const container = document.createElement('div')
  container.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content))
  event.dataTransfer.clearData()
  event.dataTransfer.setData('text/html', container.innerHTML)
  event.dataTransfer.setData('text/plain', block.node.textContent)
  event.dataTransfer.effectAllowed = 'copyMove'
  event.dataTransfer.setDragImage(block.dom, 0, 0)
  view.dragging = { slice, move: true }
}

/**
 * Notion-style block controls in the note's left margin: + inserts a block below through the slash menu, and the
 * grip drags the block to a new place (ProseMirror moves it, with its drop cursor) or opens block actions on click.
 */
export function NoteBlockHandle({ editor, containerRef }: { editor: Editor | null; containerRef: RefObject<HTMLElement | null> }) {
  const [block, setBlock] = useState<HoveredBlock | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const draggingRef = useRef(false)
  const menuOpenRef = useRef(false)
  useEffect(() => { menuOpenRef.current = menuOpen }, [menuOpen])

  const locate = useCallback((clientY: number) => {
    const container = containerRef.current
    if (!editor || editor.isDestroyed || !editor.isEditable || !container) return
    const root = editor.view.dom as HTMLElement
    const rootRect = root.getBoundingClientRect()
    if (clientY < rootRect.top - 4 || clientY > rootRect.bottom + 4) {
      setBlock(null)
      return
    }
    const element = blockElementAt(root, clientY)
    if (!element) return
    const found = blockForElement(editor, element)
    if (!found) return
    const containerRect = container.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    // Align with the first text line: list items and wrapped tables measure their first child.
    const lineSource = (LIST_ITEMS.has(found.node.type.name) ? element.querySelector('p') : element) ?? element
    const lineStyle = getComputedStyle(lineSource)
    const lineHeight = Number.parseFloat(lineStyle.lineHeight) || HANDLE_SIZE
    const lineTop = lineSource.getBoundingClientRect().top + (Number.parseFloat(lineStyle.paddingTop) || 0)
    const isTable = element.classList.contains('tableWrapper') || element.tagName === 'TABLE'
    const top = (isTable ? elementRect.top + 4 : lineTop + (lineHeight - HANDLE_SIZE) / 2) - containerRect.top + container.scrollTop
    const isTaskItem = found.node.type.name === 'taskItem'
    const anchorLeft = LIST_ITEMS.has(found.node.type.name)
      ? elementRect.left - (isTaskItem ? 0 : 20)
      : rootRect.left
    const left = anchorLeft - containerRect.left + container.scrollLeft - HANDLE_WIDTH
    setBlock((previous) => (
      previous && previous.pos === found.pos && previous.node === found.node && previous.top === top && previous.left === left
        ? previous
        : { ...found, dom: element, top, left }
    ))
  }, [containerRef, editor])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !editor) return
    const onMove = (event: MouseEvent) => {
      if (draggingRef.current || menuOpenRef.current) return
      if ((event.target as HTMLElement | null)?.closest?.('[data-note-handle]')) return
      locate(event.clientY)
    }
    const onLeave = () => {
      if (!draggingRef.current && !menuOpenRef.current) setBlock(null)
    }
    // Typing moves blocks under a still pointer; hide until the pointer moves again.
    const onKey = () => { if (!menuOpenRef.current) setBlock(null) }
    container.addEventListener('mousemove', onMove)
    container.addEventListener('mouseleave', onLeave)
    container.addEventListener('keydown', onKey)
    return () => {
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseleave', onLeave)
      container.removeEventListener('keydown', onKey)
    }
  }, [containerRef, editor, locate])

  if (!editor || !block) return null

  const insertBelow = () => {
    const { node, pos } = block
    const chain = editor.chain().focus()
    if (node.type.name === 'paragraph' && node.content.size === 0) {
      chain.insertContentAt(pos + 1, '/').run()
    } else if (LIST_ITEMS.has(node.type.name)) {
      const end = pos + node.nodeSize
      chain
        .insertContentAt(end, {
          type: node.type.name,
          ...(node.type.name === 'taskItem' ? { attrs: { checked: false } } : {}),
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '/' }] }],
        })
        .setTextSelection(end + 3)
        .run()
    } else {
      const end = pos + node.nodeSize
      chain
        .insertContentAt(end, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
        .setTextSelection(end + 2)
        .run()
    }
    setBlock(null)
  }

  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    startBlockDrag(editor, block, event)
    draggingRef.current = true
  }

  const onDragEnd = () => {
    draggingRef.current = false
    setBlock(null)
  }

  const kind = currentKind(editor, block)
  const turnInto = (target: BlockKind) => {
    if (target === kind) return
    const inside = block.pos + (LIST_ITEMS.has(block.node.type.name) ? 2 : 1)
    const chain = editor.chain().focus().setTextSelection(inside)
    // Leave any list first so every target starts from a plain block.
    const lifted = LIST_ITEMS.has(block.node.type.name) ? chain.liftListItem(block.node.type.name) : chain
    switch (target) {
      case 'paragraph': lifted.setParagraph().run(); break
      case 'h1': lifted.setHeading({ level: 1 }).run(); break
      case 'h2': lifted.setHeading({ level: 2 }).run(); break
      case 'h3': lifted.setHeading({ level: 3 }).run(); break
      case 'bulletList': lifted.setParagraph().toggleBulletList().run(); break
      case 'orderedList': lifted.setParagraph().toggleOrderedList().run(); break
      case 'taskList': lifted.setParagraph().toggleTaskList().run(); break
      case 'blockquote': lifted.setParagraph().toggleBlockquote().run(); break
      case 'codeBlock': lifted.setCodeBlock().run(); break
    }
  }

  return (
    <div
      data-note-handle=""
      data-visible="true"
      className="overlay-note-handle"
      style={{ top: block.top, left: block.left }}
    >
      <Button
        variant="ghost"
        type="button"
        className={HANDLE_BUTTON_CLASS}
        aria-label="Insert block below"
        title="Click to add a block below"
        onMouseDown={(event) => event.preventDefault()}
        onClick={insertBelow}
      >
        <Plus size={16} strokeWidth={1.75} />
      </Button>
      <span className="relative inline-flex">
        {/* The grip is not the menu trigger: Radix opens triggers on pointer down, and cancelling that pointer down
            would also stop the browser from starting the native drag. It opens the controlled menu on click. */}
        <Button
          variant="ghost"
          type="button"
          className={`${HANDLE_BUTTON_CLASS} w-[18px] cursor-grab active:cursor-grabbing`}
          data-grip=""
          draggable
          aria-label="Drag to move, click for block options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Drag to move · Click for options"
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <GripVertical size={16} strokeWidth={1.75} />
        </Button>
        <DropdownMenu open={menuOpen} onOpenChange={(open) => { setMenuOpen(open); if (!open) setBlock(null) }} modal={false}>
          <DropdownMenuTrigger asChild>
            <span aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute inset-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            className="w-56 p-1"
            onCloseAutoFocus={(event) => event.preventDefault()}
            // A click on the grip toggles the menu itself; don't let the outside-press dismissal reopen it.
            onPointerDownOutside={(event) => {
              if ((event.target as HTMLElement | null)?.closest?.('[data-grip]')) event.preventDefault()
            }}
          >
            <div className="px-2 pb-1 pt-1.5 text-[11.5px] font-medium text-(--muted)">Turn into</div>
            {TURN_INTO.map(({ kind: target, label, icon: Icon }) => (
              <DropdownMenuItem key={target} className={MENU_ITEM_CLASS} onSelect={() => turnInto(target)}>
                <Icon size={15} strokeWidth={1.75} />
                <span className="flex-1">{label}</span>
                {target === kind ? <Check size={14} strokeWidth={2} /> : null}
              </DropdownMenuItem>
            ))}
            <div className="my-1 h-px bg-(--border)" role="separator" />
            <DropdownMenuItem
              className={MENU_ITEM_CLASS}
              onSelect={() => {
                editor.chain().focus().insertContentAt(block.pos + block.node.nodeSize, block.node.toJSON()).run()
              }}
            >
              <CopyPlus size={15} strokeWidth={1.75} />Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem
              className={MENU_ITEM_CLASS}
              onSelect={() => { void navigator.clipboard?.writeText(blockMarkdown(editor, block.node)).catch(() => undefined) }}
            >
              <Copy size={15} strokeWidth={1.75} />Copy as Markdown
            </DropdownMenuItem>
            <div className="my-1 h-px bg-(--border)" role="separator" />
            <DropdownMenuItem
              className={`${MENU_ITEM_CLASS} text-red-600 dark:text-red-400 [&_svg]:text-red-600 dark:[&_svg]:text-red-400`}
              onSelect={() => {
                editor.chain().focus().deleteRange({ from: block.pos, to: block.pos + block.node.nodeSize }).run()
              }}
            >
              <Trash2 size={15} strokeWidth={1.75} />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  )
}
