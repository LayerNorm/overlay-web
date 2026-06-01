import type {
  ExtensionCapabilities,
  RuntimeRequest,
  RuntimeResponse,
  WebBridgeRequest,
  WebBridgeResponse,
} from '@overlay/extension-contracts'

function postResponse(response: WebBridgeResponse) {
  window.postMessage(response, window.location.origin)
}

async function getCapabilities(): Promise<ExtensionCapabilities> {
  const response = await chrome.runtime.sendMessage({
    type: 'overlay.runtime.bootstrap',
  } satisfies RuntimeRequest) as RuntimeResponse

  if (!response.ok || response.type !== 'overlay.runtime.bootstrap') {
    throw new Error(response.ok ? 'Invalid capabilities payload' : response.error)
  }

  return response.bootstrap.capabilities
}

async function captureBrowserContext() {
  const response = await chrome.runtime.sendMessage({
    type: 'overlay.runtime.bridge.capture-browser-context',
  } satisfies RuntimeRequest) as RuntimeResponse

  if (!response.ok || response.type !== 'overlay.runtime.bridge.browser-context') {
    throw new Error(response.ok ? 'Invalid browser context payload' : response.error)
  }

  return response.context
}

window.addEventListener('message', (event: MessageEvent<WebBridgeRequest>) => {
  if (event.source !== window) return
  const data = event.data
  if (!data || data.source !== 'overlay-web-app') return

  if (data.type === 'overlay.bridge.ping') {
    postResponse({
      source: 'overlay-extension',
      type: 'overlay.bridge.pong',
      timestamp: Date.now(),
    })
    return
  }

  if (data.type === 'overlay.bridge.get-capabilities') {
    void getCapabilities()
      .then((capabilities) => {
        postResponse({
          source: 'overlay-extension',
          type: 'overlay.bridge.capabilities',
          capabilities,
        })
      })
      .catch((error) => {
        postResponse({
          source: 'overlay-extension',
          type: 'overlay.bridge.error',
          error: error instanceof Error ? error.message : 'Failed to fetch capabilities',
        })
      })
  }

  if (data.type === 'overlay.bridge.capture-browser-context') {
    void captureBrowserContext()
      .then((context) => {
        postResponse({
          source: 'overlay-extension',
          type: 'overlay.bridge.browser-context',
          context,
        })
      })
      .catch((error) => {
        postResponse({
          source: 'overlay-extension',
          type: 'overlay.bridge.error',
          error: error instanceof Error ? error.message : 'Failed to capture browser context',
        })
      })
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'overlay.host.session') {
    void fetch('/api/auth/session', {
      credentials: 'include',
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        sendResponse({
          authenticated: Boolean(payload?.authenticated),
          user: payload?.user ?? null,
        })
      })
      .catch((error) => {
        sendResponse({
          authenticated: false,
          error: error instanceof Error ? error.message : 'Failed to read session',
        })
      })
    return true
  }

  if (message?.type === 'overlay.host.act-plan') {
    void fetch('/api/v1/conversations/act/extension-plan', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message.payload),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        sendResponse({
          ok: response.ok,
          status: response.status,
          payload,
        })
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Host act planner failed',
        })
      })
    return true
  }

  if (message?.type === 'overlay.host.browser-task') {
    void fetch('/api/v1/browser-task', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message.payload),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        sendResponse({
          ok: response.ok,
          status: response.status,
          payload,
        })
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Host browser task failed',
        })
      })
    return true
  }
})
