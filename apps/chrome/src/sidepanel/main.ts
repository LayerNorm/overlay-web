import { envelope, parseAppRequest } from '@overlay/chrome-bridge'
import { APP_ORIGIN } from '../config'
import { answerAppRequest, readPageInTab, type BridgeHost } from './bridge'

// The side panel is the web app, framed full-bleed. Sign-in, chats, agents, files and settings are the app's own.
const frame = document.createElement('iframe')
frame.src = `${APP_ORIGIN}/app`
frame.title = 'Overlay'
frame.allow = 'clipboard-read; clipboard-write; microphone'
document.body.append(frame)

const host: BridgeHost = {
  async activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab
  },
  async readTab(tabId) {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: readPageInTab })
    return result?.result
  },
}

window.addEventListener('message', (event) => {
  if (event.origin !== APP_ORIGIN || event.source !== frame.contentWindow) return
  const request = parseAppRequest(event.data)
  if (!request) return
  void answerAppRequest(request, host).then((reply) => {
    frame.contentWindow?.postMessage(envelope(reply), APP_ORIGIN)
  })
})
