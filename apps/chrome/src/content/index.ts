import type { InteractiveElementSummary, PageContextSnapshot, TabLinkSummary } from '@overlay/extension-contracts'

const OVERLAY_ROOT_ID = 'overlay-extension-control-root'

function collectLinks(): TabLinkSummary[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .slice(0, 8)
    .map((link) => ({
      text: link.textContent?.trim() || link.href,
      href: link.href,
    }))
}

function collectHeadings(): string[] {
  return Array.from(document.querySelectorAll('h1, h2, h3'))
    .slice(0, 10)
    .map((heading) => heading.textContent?.trim() || '')
    .filter(Boolean)
}

function summarizeInteractiveElement(element: Element | null): InteractiveElementSummary | null {
  if (!(element instanceof HTMLElement)) return null
  const text = element.innerText?.replace(/\s+/g, ' ').trim() || element.getAttribute('aria-label')?.trim() || null
  return {
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    text,
  }
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
}

function collectInteractiveElements(): InteractiveElementSummary[] {
  return Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, [role="button"], [tabindex]'))
    .filter(isVisible)
    .slice(0, 12)
    .map((element) => summarizeInteractiveElement(element))
    .filter((value): value is InteractiveElementSummary => Boolean(value))
}

function captureSnapshot(): PageContextSnapshot {
  const selection = window.getSelection()?.toString().trim() || null
  const bodyText = document.body?.innerText?.replace(/\s+/g, ' ').trim() || ''

  return {
    capturedAt: Date.now(),
    url: window.location.href,
    title: document.title || 'Untitled page',
    selection,
    excerpt: bodyText.slice(0, 420),
    headings: collectHeadings(),
    links: collectLinks(),
    scrollY: window.scrollY,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    focusedElement: summarizeInteractiveElement(document.activeElement),
    interactiveElements: collectInteractiveElements(),
  }
}

function normalizeText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function describeElement(element: Element | null): string {
  if (!element) return 'No element'
  const text = normalizeText(element.textContent || (element as HTMLElement).innerText).slice(0, 64)
  const id = element.getAttribute('id')
  const name = element.getAttribute('name')
  return [
    element.tagName.toLowerCase(),
    id ? `#${id}` : null,
    name ? `[name=${name}]` : null,
    text ? `(${text})` : null,
  ]
    .filter(Boolean)
    .join('')
}

function candidateElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('button, a, input, textarea, select, option, [role="button"], [contenteditable="true"], [tabindex]'))
}

function scoreElementMatch(element: HTMLElement, query: string): number {
  const target = normalizeText(query)
  if (!target) return 0
  const candidates = [
    normalizeText(element.innerText),
    normalizeText(element.getAttribute('aria-label')),
    normalizeText(element.getAttribute('placeholder')),
    normalizeText(element.getAttribute('name')),
    normalizeText(element.getAttribute('value')),
    normalizeText(element.id),
  ].filter(Boolean)
  let score = 0
  for (const candidate of candidates) {
    if (candidate === target) score = Math.max(score, 4)
    else if (candidate.includes(target)) score = Math.max(score, 3)
    else if (target.includes(candidate) && candidate.length > 0) score = Math.max(score, 2)
  }
  if (isVisible(element)) score += 0.5
  return score
}

function findElements(args: {
  selector?: string
  text?: string
  query?: string
}): HTMLElement[] {
  const bySelector = typeof args.selector === 'string' && args.selector.trim()
    ? Array.from(document.querySelectorAll<HTMLElement>(args.selector.trim()))
    : []
  if (bySelector.length > 0) return bySelector.filter(isVisible)

  const query = args.query || args.text
  if (!query?.trim()) return []

  return candidateElements()
    .map((element) => ({ element, score: scoreElementMatch(element, query) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((candidate) => candidate.element)
}

function ensureOverlayRoot() {
  let root = document.getElementById(OVERLAY_ROOT_ID)
  if (root) return root

  root = document.createElement('div')
  root.id = OVERLAY_ROOT_ID
  root.setAttribute('aria-hidden', 'true')
  root.innerHTML = `
    <style>
      #${OVERLAY_ROOT_ID} {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483647;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${OVERLAY_ROOT_ID} .overlay-badge {
        position: fixed;
        top: 16px;
        right: 16px;
        display: none;
        align-items: center;
        gap: 10px;
        border-radius: 999px;
        background: rgba(10, 10, 10, 0.88);
        color: #fafafa;
        padding: 10px 14px;
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.25);
        font-size: 12px;
        line-height: 1;
      }
      #${OVERLAY_ROOT_ID} .overlay-badge::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #34d399;
        box-shadow: 0 0 0 6px rgba(52, 211, 153, 0.18);
      }
      #${OVERLAY_ROOT_ID} .overlay-highlight,
      #${OVERLAY_ROOT_ID} .overlay-pointer,
      #${OVERLAY_ROOT_ID} .overlay-banner {
        position: fixed;
        display: none;
      }
      #${OVERLAY_ROOT_ID} .overlay-highlight {
        border: 2px solid rgba(250, 204, 21, 0.95);
        border-radius: 14px;
        box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.18);
        transition: all 140ms ease;
      }
      #${OVERLAY_ROOT_ID} .overlay-pointer {
        width: 18px;
        height: 18px;
        margin-left: -9px;
        margin-top: -9px;
        border-radius: 999px;
        background: rgba(244, 63, 94, 0.95);
        box-shadow: 0 0 0 8px rgba(244, 63, 94, 0.18);
      }
      #${OVERLAY_ROOT_ID} .overlay-banner {
        left: 50%;
        bottom: 20px;
        transform: translateX(-50%);
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.94);
        color: #111827;
        font-size: 12px;
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.16);
      }
    </style>
    <div class="overlay-badge">
      <span class="overlay-badge-label">Overlay is controlling this page</span>
      <span class="overlay-badge-target"></span>
    </div>
    <div class="overlay-highlight"></div>
    <div class="overlay-pointer"></div>
    <div class="overlay-banner"></div>
  `
  document.documentElement.appendChild(root)
  return root
}

function showControlBadge(label: string, targetLabel?: string) {
  const root = ensureOverlayRoot()
  const badge = root.querySelector<HTMLElement>('.overlay-badge')
  const labelNode = root.querySelector<HTMLElement>('.overlay-badge-label')
  const targetNode = root.querySelector<HTMLElement>('.overlay-badge-target')
  if (!badge || !labelNode || !targetNode) return
  labelNode.textContent = label
  targetNode.textContent = targetLabel ? `• ${targetLabel}` : ''
  badge.style.display = 'inline-flex'
}

function hideControlBadge() {
  const root = document.getElementById(OVERLAY_ROOT_ID)
  const badge = root?.querySelector<HTMLElement>('.overlay-badge')
  if (badge) badge.style.display = 'none'
}

function flashBanner(text: string) {
  const root = ensureOverlayRoot()
  const banner = root.querySelector<HTMLElement>('.overlay-banner')
  if (!banner) return
  banner.textContent = text
  banner.style.display = 'block'
  window.setTimeout(() => {
    banner.style.display = 'none'
  }, 1400)
}

function highlightElement(element: HTMLElement | null) {
  const root = ensureOverlayRoot()
  const highlight = root.querySelector<HTMLElement>('.overlay-highlight')
  if (!highlight || !element) return
  const rect = element.getBoundingClientRect()
  highlight.style.display = 'block'
  highlight.style.left = `${rect.left - 4}px`
  highlight.style.top = `${rect.top - 4}px`
  highlight.style.width = `${rect.width + 8}px`
  highlight.style.height = `${rect.height + 8}px`
  window.setTimeout(() => {
    highlight.style.display = 'none'
  }, 1200)
}

function pulsePointer(x: number, y: number) {
  const root = ensureOverlayRoot()
  const pointer = root.querySelector<HTMLElement>('.overlay-pointer')
  if (!pointer) return
  pointer.style.display = 'block'
  pointer.style.left = `${x}px`
  pointer.style.top = `${y}px`
  window.setTimeout(() => {
    pointer.style.display = 'none'
  }, 900)
}

function dispatchMouseSequence(target: HTMLElement, clientX?: number, clientY?: number) {
  const point = typeof clientX === 'number' && typeof clientY === 'number'
    ? { clientX, clientY }
    : undefined
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, ...point }))
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ...point }))
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, ...point }))
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, ...point }))
}

function setElementValue(element: HTMLElement, value: string, append = false) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.focus()
    const next = append ? `${element.value}${value}` : value
    element.value = next
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }

  if (element.isContentEditable) {
    element.focus()
    element.textContent = append ? `${element.textContent || ''}${value}` : value
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
    return
  }

  throw new Error('The matched element is not a text input.')
}

function dispatchKey(target: HTMLElement, key: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  target.dispatchEvent(new KeyboardEvent('keypress', { key, bubbles: true }))
  target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
}

function success(result: unknown) {
  return { success: true, result }
}

function failure(error: string) {
  return { success: false, error }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'overlay.page-context.capture') {
    sendResponse({ snapshot: captureSnapshot() })
    return
  }

  if (message?.type === 'overlay.control.activate') {
    showControlBadge(
      typeof message.label === 'string' ? message.label : 'Overlay is controlling this page',
      typeof message.targetLabel === 'string' ? message.targetLabel : undefined,
    )
    sendResponse(success({ summary: 'Control badge shown.' }))
    return
  }

  if (message?.type === 'overlay.control.deactivate') {
    hideControlBadge()
    sendResponse(success({ summary: 'Control badge hidden.' }))
    return
  }

  if (message?.type === 'overlay.control.pulse') {
    const elements = findElements({ selector: message.selector, text: message.text })
    const element = elements[0] ?? null
    if (element) highlightElement(element)
    if (message.coordinates?.x != null && message.coordinates?.y != null) {
      pulsePointer(message.coordinates.x, message.coordinates.y)
    }
    if (message.pulseType === 'type') flashBanner('Overlay is typing')
    if (message.pulseType === 'scroll') flashBanner('Overlay is scrolling')
    sendResponse(success({ summary: 'Control pulse shown.' }))
    return
  }

  if (message?.type === 'overlay.tool.inspect-page') {
    const snapshot = captureSnapshot()
    sendResponse(success({
      summary: `Inspected ${snapshot.title}.`,
      snapshot,
      focusedElement: snapshot.focusedElement,
      interactiveElements: snapshot.interactiveElements,
    }))
    return
  }

  if (message?.type === 'overlay.tool.find') {
    const matches = findElements({
      selector: typeof message.selector === 'string' ? message.selector : undefined,
      text: typeof message.text === 'string' ? message.text : undefined,
      query: typeof message.query === 'string' ? message.query : undefined,
    })
      .slice(0, typeof message.maxResults === 'number' ? message.maxResults : 6)
      .map((element, index) => ({
        index,
        description: describeElement(element),
        tagName: element.tagName.toLowerCase(),
        text: normalizeText(element.innerText || element.textContent),
      }))

    sendResponse(success({
      summary: matches.length ? `Found ${matches.length} matching elements.` : 'No matching elements found.',
      matches,
    }))
    return
  }

  if (message?.type === 'overlay.tool.scroll') {
    const amount = typeof message.amount === 'number' ? message.amount : 640
    if (typeof message.x === 'number' || typeof message.y === 'number') {
      window.scrollBy({
        left: typeof message.x === 'number' ? message.x : 0,
        top: typeof message.y === 'number' ? message.y : 0,
        behavior: message.behavior === 'instant' ? 'instant' : 'smooth',
      })
    } else {
      const direction = message.direction === 'up' ? -1 : 1
      window.scrollBy({
        top: amount * direction,
        behavior: message.behavior === 'instant' ? 'instant' : 'smooth',
      })
    }
    flashBanner('Overlay is scrolling')
    sendResponse(success({
      summary: 'Scrolled the page.',
      scrollY: window.scrollY,
    }))
    return
  }

  if (message?.type === 'overlay.tool.click') {
    const elements = findElements({
      selector: typeof message.selector === 'string' ? message.selector : undefined,
      text: typeof message.text === 'string' ? message.text : undefined,
      query: typeof message.text === 'string' ? message.text : undefined,
    })
    const index = typeof message.index === 'number' ? message.index : 0
    const element = elements[index] ?? null
    if (!element) {
      sendResponse(failure('Could not find a matching element to click.'))
      return
    }
    highlightElement(element)
    dispatchMouseSequence(element)
    sendResponse(success({
      summary: `Clicked ${describeElement(element)}.`,
      target: describeElement(element),
    }))
    return
  }

  if (message?.type === 'overlay.tool.type') {
    const elements = findElements({
      selector: typeof message.selector === 'string' ? message.selector : undefined,
      text: typeof message.text === 'string' ? message.text : undefined,
    })
    const element = elements[0] ?? null
    const value = typeof message.value === 'string' ? message.value : ''
    if (!element) {
      sendResponse(failure('Could not find an input matching that selector or text.'))
      return
    }
    try {
      highlightElement(element)
      flashBanner('Overlay is typing')
      setElementValue(element, value, Boolean(message.append))
      sendResponse(success({
        summary: `Typed into ${describeElement(element)}.`,
        target: describeElement(element),
      }))
    } catch (error) {
      sendResponse(failure(error instanceof Error ? error.message : 'Typing failed.'))
    }
    return
  }

  if (message?.type === 'overlay.tool.press') {
    const elements = findElements({
      selector: typeof message.selector === 'string' ? message.selector : undefined,
      text: typeof message.text === 'string' ? message.text : undefined,
    })
    const target = elements[0] ?? (document.activeElement instanceof HTMLElement ? document.activeElement : document.body)
    const key = typeof message.key === 'string' ? message.key : 'Enter'
    target.focus()
    flashBanner(`Overlay pressed ${key}`)
    dispatchKey(target, key)
    sendResponse(success({
      summary: `Pressed ${key}.`,
      target: describeElement(target),
    }))
    return
  }

  if (message?.type === 'overlay.tool.select') {
    const elements = findElements({
      selector: typeof message.selector === 'string' ? message.selector : undefined,
      text: typeof message.text === 'string' ? message.text : undefined,
    })
    const element = elements[0]
    if (!(element instanceof HTMLSelectElement)) {
      sendResponse(failure('Could not find a select element to update.'))
      return
    }
    const desired = typeof message.value === 'string' ? message.value : typeof message.label === 'string' ? message.label : ''
    const option = Array.from(element.options).find((item) => item.value === desired || normalizeText(item.label) === normalizeText(desired))
    if (!option) {
      sendResponse(failure('Could not find a matching option.'))
      return
    }
    element.value = option.value
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    highlightElement(element)
    sendResponse(success({
      summary: `Selected ${option.label}.`,
      target: describeElement(element),
      value: option.value,
      label: option.label,
    }))
    return
  }

  if (message?.type === 'overlay.tool.hover') {
    const elements = findElements({
      selector: typeof message.selector === 'string' ? message.selector : undefined,
      text: typeof message.text === 'string' ? message.text : undefined,
    })
    const element = elements[typeof message.index === 'number' ? message.index : 0] ?? null
    if (!element) {
      sendResponse(failure('Could not find a matching element to hover.'))
      return
    }
    const rect = element.getBoundingClientRect()
    highlightElement(element)
    pulsePointer(rect.left + rect.width / 2, rect.top + rect.height / 2)
    element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    sendResponse(success({
      summary: `Hovered ${describeElement(element)}.`,
      target: describeElement(element),
    }))
    return
  }

  if (message?.type === 'overlay.tool.wait-for') {
    const timeoutMs = typeof message.timeoutMs === 'number' ? message.timeoutMs : 8_000
    const start = Date.now()
    const selector = typeof message.selector === 'string' ? message.selector : undefined
    const text = typeof message.text === 'string' ? message.text : undefined

    const tick = () => {
      const element = findElements({ selector, text })[0] ?? null
      if (element) {
        highlightElement(element)
        sendResponse(success({
          summary: `Waited until ${describeElement(element)} was available.`,
          target: describeElement(element),
        }))
        return
      }
      if (Date.now() - start >= timeoutMs) {
        sendResponse(failure('Timed out waiting for the target element.'))
        return
      }
      window.setTimeout(tick, 120)
    }

    tick()
    return true
  }

  if (message?.type === 'overlay.tool.click-at') {
    const x = typeof message.x === 'number' ? message.x : NaN
    const y = typeof message.y === 'number' ? message.y : NaN
    const element = document.elementFromPoint(x, y)
    if (!(element instanceof HTMLElement)) {
      sendResponse(failure('Could not find an element at those coordinates.'))
      return
    }
    pulsePointer(x, y)
    dispatchMouseSequence(element, x, y)
    sendResponse(success({
      summary: `Clicked at ${Math.round(x)}, ${Math.round(y)}.`,
      target: describeElement(element),
    }))
    return
  }

  if (message?.type === 'overlay.tool.move-mouse') {
    const x = typeof message.x === 'number' ? message.x : NaN
    const y = typeof message.y === 'number' ? message.y : NaN
    pulsePointer(x, y)
    const element = document.elementFromPoint(x, y)
    if (element instanceof HTMLElement) {
      element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }))
    }
    sendResponse(success({
      summary: `Moved the pointer to ${Math.round(x)}, ${Math.round(y)}.`,
      target: element instanceof HTMLElement ? describeElement(element) : undefined,
    }))
    return
  }

  if (message?.type === 'overlay.tool.drag') {
    const startX = typeof message.startX === 'number' ? message.startX : NaN
    const startY = typeof message.startY === 'number' ? message.startY : NaN
    const endX = typeof message.endX === 'number' ? message.endX : NaN
    const endY = typeof message.endY === 'number' ? message.endY : NaN
    const startElement = document.elementFromPoint(startX, startY)
    const endElement = document.elementFromPoint(endX, endY)
    if (!(startElement instanceof HTMLElement) || !(endElement instanceof HTMLElement)) {
      sendResponse(failure('Could not resolve drag start or end coordinates.'))
      return
    }
    pulsePointer(startX, startY)
    startElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: startX, clientY: startY }))
    endElement.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: endX, clientY: endY }))
    pulsePointer(endX, endY)
    endElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: endX, clientY: endY }))
    sendResponse(success({
      summary: `Dragged from ${Math.round(startX)}, ${Math.round(startY)} to ${Math.round(endX)}, ${Math.round(endY)}.`,
      from: describeElement(startElement),
      to: describeElement(endElement),
    }))
    return
  }
})
