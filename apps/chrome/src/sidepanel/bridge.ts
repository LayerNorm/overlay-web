import {
  PAGE_TEXT_LIMIT,
  clipPageText,
  type ChromeAppRequest,
  type ChromeExtensionReply,
  type ChromePage,
} from '@overlay/chrome-bridge'

/** What the injected script reads from a page. Runs in the page, so it must stay self-contained. */
export function readPageInTab(): { url: string; title: string; selection: string; text: string } {
  return {
    url: location.href,
    title: document.title,
    selection: String(window.getSelection() ?? ''),
    text: document.body?.innerText ?? '',
  }
}

export type BridgeHost = {
  /** The tab next to this side panel. */
  activeTab(): Promise<{ id?: number; url?: string; title?: string } | undefined>
  /** Runs `readPageInTab` in the tab and returns its result. */
  readTab(tabId: number): Promise<ReturnType<typeof readPageInTab> | undefined>
}

function tabPage(tab: { url?: string; title?: string } | undefined): ChromePage | null {
  return tab?.url && /^https?:\/\//.test(tab.url) ? { url: tab.url, title: tab.title ?? '' } : null
}

/** Answers one request from the framed app. Only reads the tab the person is looking at, and only when asked. */
export async function answerAppRequest(request: ChromeAppRequest, host: BridgeHost): Promise<ChromeExtensionReply> {
  const tab = await host.activeTab()
  const page = tabPage(tab)
  if (request.type === 'page.current') return { type: 'page.current', id: request.id, page }
  if (!page || tab?.id === undefined) {
    return { type: 'page.context', id: request.id, context: null, error: 'Overlay can only read web pages.' }
  }
  try {
    const read = await host.readTab(tab.id)
    if (!read) throw new Error('empty')
    const { text, truncated } = clipPageText(read.text)
    return {
      type: 'page.context',
      id: request.id,
      context: {
        url: read.url,
        title: read.title,
        selection: read.selection.trim().slice(0, PAGE_TEXT_LIMIT),
        text,
        truncated,
      },
    }
  } catch {
    return { type: 'page.context', id: request.id, context: null, error: 'Could not read this page. Reload it and try again.' }
  }
}
