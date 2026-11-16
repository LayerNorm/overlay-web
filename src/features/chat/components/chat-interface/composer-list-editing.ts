/**
 * Markdown-style list editing for the contenteditable composer:
 * - Backspace at the start of a point turns it back into plain text (or
 *   outdents a sub-point), so the first point of a prompt can be removed.
 * - Tab indents a point under the previous one; Shift+Tab outdents it.
 */
import { dispatchEditorInput, MENTION_ATTR } from './mention-input-dom'

function isList(node: Node | null | undefined): node is HTMLOListElement | HTMLUListElement {
  return !!node && node.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test((node as HTMLElement).tagName)
}

function isListItem(node: Node | null | undefined): node is HTMLLIElement {
  return !!node && node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'LI'
}

/** The <li> holding the caret, including carets the browser parks on the <ol>/<ul> itself. */
export function findCaretListItem(sel: Selection, root: HTMLElement): HTMLLIElement | null {
  if (sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  let node: Node | null = range.startContainer
  if (isList(node)) {
    const children = node.childNodes
    node = children[Math.min(range.startOffset, children.length - 1)] ?? node
  }
  while (node && node !== root) {
    if (isListItem(node)) return node
    node = node.parentNode
  }
  return null
}

/** True when nothing visible (text or mention chip) sits between the item start and the caret. */
function isCaretAtItemStart(li: HTMLLIElement, range: Range): boolean {
  const before = document.createRange()
  before.setStart(li, 0)
  try {
    before.setEnd(range.startContainer, range.startOffset)
  } catch {
    return false
  }
  if (before.toString().replace(/\u200B/g, '') !== '') return false
  return !before.cloneContents().querySelector?.(`[${MENTION_ATTR}]`)
}

interface SavedCaret { node: Node; offset: number }

function saveCaret(sel: Selection): SavedCaret | null {
  if (sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  return { node: range.startContainer, offset: range.startOffset }
}

function restoreCaret(sel: Selection, saved: SavedCaret | null, fallback: Node) {
  const range = document.createRange()
  if (saved && fallback.contains(saved.node)) range.setStart(saved.node, saved.offset)
  else range.setStart(fallback, 0)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

function emptyListItemBody(li: HTMLLIElement) {
  const hasOwnContent = Array.from(li.childNodes).some((child) => !isList(child))
  if (!hasOwnContent) li.insertBefore(document.createElement('br'), li.firstChild)
}

/** Move `li` one level deeper, under the previous point. */
export function indentListItem(li: HTMLLIElement): boolean {
  const list = li.parentElement
  const previous = li.previousElementSibling
  if (!list || !isList(list) || !isListItem(previous)) return false
  const last = previous.lastElementChild
  const nested = last && last.tagName === list.tagName ? last : document.createElement(list.tagName.toLowerCase())
  if (nested !== last) previous.appendChild(nested)
  nested.appendChild(li)
  // Merge the item's own sub-points into the new level so ordering stays intact.
  const ownNested = Array.from(li.children).filter((child) => child.tagName === list.tagName)
  for (const child of ownNested) {
    while (child.firstChild) nested.appendChild(child.firstChild)
    child.remove()
  }
  return true
}

/** Move a sub-point one level up, keeping the points after it as its children. */
export function outdentListItem(li: HTMLLIElement): boolean {
  const list = li.parentElement
  const parentItem = list?.parentElement
  if (!list || !isList(list) || !isListItem(parentItem)) return false
  const following: Element[] = []
  for (let next = li.nextElementSibling; next; next = next.nextElementSibling) following.push(next)
  if (following.length) {
    const tail = document.createElement(list.tagName.toLowerCase())
    for (const item of following) tail.appendChild(item)
    li.appendChild(tail)
  }
  parentItem.after(li)
  if (list.children.length === 0) list.remove()
  return true
}

/** Replace a top-level point with a paragraph in place, splitting the list around it. */
export function listItemToParagraph(li: HTMLLIElement): HTMLParagraphElement | null {
  const list = li.parentElement
  if (!list || !isList(list)) return null
  const p = document.createElement('p')
  const nestedLists: Element[] = []
  for (const child of Array.from(li.childNodes)) {
    if (isList(child)) nestedLists.push(child)
    else p.appendChild(child)
  }
  if ((p.textContent ?? '').replace(/\u200B/g, '') === '' && !p.querySelector(`[${MENTION_ATTR}]`)) {
    p.replaceChildren(document.createTextNode('\u200B'))
  }
  const following: Element[] = []
  for (let next = li.nextElementSibling; next; next = next.nextElementSibling) following.push(next)
  li.remove()
  list.after(p)
  let anchor: Element = p
  for (const nested of nestedLists) {
    anchor.after(nested)
    anchor = nested
  }
  if (following.length) {
    const tail = document.createElement(list.tagName.toLowerCase())
    for (const item of following) tail.appendChild(item)
    anchor.after(tail)
  }
  if (list.children.length === 0) list.remove()
  return p
}

/** Backspace inside a list. Returns true when it handled the key. */
export function handleListBackspace(root: HTMLDivElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
  const li = findCaretListItem(sel, root)
  if (!li || !isCaretAtItemStart(li, sel.getRangeAt(0))) return false
  const saved = saveCaret(sel)
  if (isListItem(li.parentElement?.parentElement)) {
    outdentListItem(li)
    emptyListItemBody(li)
    restoreCaret(sel, saved, li)
  } else {
    const p = listItemToParagraph(li)
    if (!p) return false
    const range = document.createRange()
    range.setStart(p, 0)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }
  dispatchEditorInput(root)
  return true
}

/**
 * Tab / Shift+Tab inside a list. Returns true when the caret is in a list,
 * even if the point cannot move (e.g. the first point), so focus stays in
 * the composer instead of jumping to the next control.
 */
export function handleListTab(root: HTMLDivElement, outdent: boolean): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const li = findCaretListItem(sel, root)
  if (!li) return false
  const saved = saveCaret(sel)
  const moved = outdent ? outdentListItem(li) : indentListItem(li)
  if (moved) {
    emptyListItemBody(li)
    restoreCaret(sel, saved, li)
    dispatchEditorInput(root)
  }
  return true
}
