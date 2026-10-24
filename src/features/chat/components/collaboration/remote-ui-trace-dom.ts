type Rect = {x: number; y: number; width: number; height: number}
type Clip = {left: number; top: number; right: number; bottom: number; cssVisible: boolean}

export function insideTraceClip(rect: Rect, clip: Clip): boolean {
  return clip.cssVisible && rect.width > 0 && rect.height > 0 &&
    rect.x >= clip.left && rect.y >= clip.top &&
    rect.x + rect.width <= clip.right && rect.y + rect.height <= clip.bottom
}

function clipFor(element: HTMLElement): Clip {
  const clip = {left: 0, top: 0, right: innerWidth, bottom: innerHeight, cssVisible: true}
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect()
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) clip.cssVisible = false
    if (style.overflowY !== 'visible') {
      clip.top = Math.max(clip.top, bounds.top)
      clip.bottom = Math.min(clip.bottom, bounds.bottom)
    }
    if (style.overflowX !== 'visible') {
      clip.left = Math.max(clip.left, bounds.left)
      clip.right = Math.min(clip.right, bounds.right)
    }
  }
  return clip
}

function lastText(node: Node): Node | undefined {
  if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return node
  for (let index = node.childNodes.length - 1; index >= 0; index--) {
    const found = lastText(node.childNodes[index])
    if (found) return found
  }
}

function tailGeometry(element: HTMLElement) {
  const clip = clipFor(element), text = lastText(element)
  let rects: Rect[] = []
  if (text) {
    const length = text.textContent?.trimEnd().length ?? 0, range = document.createRange()
    range.setStart(text, Math.max(0, length - 1))
    range.setEnd(text, length)
    rects = Array.from(range.getClientRects(), rect => ({x: rect.x, y: rect.y, width: rect.width, height: rect.height}))
  }
  return {clip, rects, visible: document.visibilityState === 'visible' && rects.some(rect => insideTraceClip(rect, clip))}
}

export function sampleRemoteUi(root: HTMLElement | null) {
  const before = Date.now(), monotonicMs = performance.now()
  const blocks = root ? Array.from(root.querySelectorAll<HTMLElement>('.md-block-appear'))
    .filter(element => !element.parentElement?.closest('.md-block-appear')) : []
  const text = blocks.map(block => block.innerText.replace(/\s+/gu, '')).join('')
  const tail = blocks.at(-1)
  return {before, monotonicMs, present: Boolean(root), text, tail: tail ? tailGeometry(tail) : null,
    visibility: document.visibilityState, viewport: {width: innerWidth, height: innerHeight}}
}

export async function hashTraceText(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}
