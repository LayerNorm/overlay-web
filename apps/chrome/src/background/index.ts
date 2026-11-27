import type {
  ExtensionSession,
  RuntimeRequest,
  RuntimeResponse,
} from '@overlay/extension-contracts'
import {
  fetchSessionTransferPayload,
  prepareExtensionSignInTabUrl,
  takeHandoffVerifier,
} from './extension-auth'
import { getExtensionStorage } from './storage'
import { normalizeTrustedOverlayBaseUrl } from './trusted-origins'
import {
  bootstrapRuntime,
  captureBrowserContextEnvelope,
  clearSessionState,
  createConversation,
  deleteConversation,
  ingestDocument,
  refreshEntitlements,
  refreshParitySnapshot,
  refreshSessionState,
  resolveApproval,
  saveConversationSettings,
  savePreferencesState,
  saveSessionState,
  selectConversation,
  startActRun,
  startChatRun,
  startMediaGeneration,
  stopActRun,
  stopChatRun,
  transcribeAudio,
} from './runtime'
import { registerStreamPort } from './stream-bus'

function isAllowedExternalOrigin(url: string | undefined): boolean {
  if (!url) return false
  try {
    const origin = new URL(url).origin
    return (
      origin === 'http://localhost:3000' ||
      origin === 'https://getoverlay.io' ||
      origin === 'https://www.getoverlay.io'
    )
  } catch {
    return false
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  void (async () => {
    try {
      if (!isAllowedExternalOrigin(sender.url)) {
        sendResponse({ ok: false, error: 'Unauthorized sender' })
        return
      }
      if (!message || typeof message !== 'object' || (message as { type?: string }).type !== 'overlay.extension.auth.handoff') {
        sendResponse({ ok: false, error: 'Unknown message' })
        return
      }
      const token = typeof (message as { token?: string }).token === 'string' ? (message as { token: string }).token.trim() : ''
      if (!token) {
        sendResponse({ ok: false, error: 'Missing token' })
        return
      }
      const { preferences } = await getExtensionStorage()
      const baseUrl = normalizeTrustedOverlayBaseUrl(preferences?.baseUrl)
      const verifier = await takeHandoffVerifier()
      if (!verifier) {
        sendResponse({
          ok: false,
          error: 'Sign-in handshake expired. Open the extension sidebar → Account settings → Connect again.',
        })
        return
      }
      const data = await fetchSessionTransferPayload({ baseUrl, token, codeVerifier: verifier })
      const session: ExtensionSession = {
        status: 'connected',
        baseUrl,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: {
          id: data.userId,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
        },
        lastValidatedAt: Date.now(),
        refreshError: null,
      }
      await saveSessionState(session)
      sendResponse({ ok: true })
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Extension sign-in failed',
      })
    }
  })()
  return true
})

async function reinjectScriptsIntoOpenTabs() {
  const tabs = await chrome.tabs.query({})

  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || !tab.url) return
      const url = tab.url
      if (!/^https?:\/\//i.test(url)) return

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        })
      } catch {
        // ignore unsupported pages
      }

      if (
        url.startsWith('http://localhost:3000/') ||
        url.startsWith('https://getoverlay.io/') ||
        url.startsWith('https://www.getoverlay.io/')
      ) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['bridge.js'],
          })
        } catch {
          // ignore unsupported pages
        }
      }
    }),
  )
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  void reinjectScriptsIntoOpenTabs()
})

chrome.runtime.onStartup.addListener(() => {
  void reinjectScriptsIntoOpenTabs()
})

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'overlay-runtime-stream') return
  registerStreamPort(port)
})

chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
  async function handle() {
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return { ok: false, error: 'Invalid runtime request' } satisfies RuntimeResponse
    }

    switch (message.type) {
      case 'overlay.runtime.ping':
        return { ok: true, type: 'overlay.runtime.pong', timestamp: Date.now() } satisfies RuntimeResponse
      case 'overlay.runtime.bootstrap':
        return {
          ok: true,
          type: 'overlay.runtime.bootstrap',
          bootstrap: await bootstrapRuntime(),
        } satisfies RuntimeResponse
      case 'overlay.runtime.session.save':
        return {
          ok: true,
          type: 'overlay.runtime.session.saved',
          session: await saveSessionState(message.session),
        } satisfies RuntimeResponse
      case 'overlay.runtime.session.clear':
        await clearSessionState()
        return { ok: true, type: 'overlay.runtime.session.cleared' } satisfies RuntimeResponse
      case 'overlay.runtime.session.refresh':
        return {
          ok: true,
          type: 'overlay.runtime.session.refreshed',
          session: await refreshSessionState(),
        } satisfies RuntimeResponse
      case 'overlay.runtime.preferences.save':
        return {
          ok: true,
          type: 'overlay.runtime.preferences.saved',
          preferences: await savePreferencesState(message.preferences),
        } satisfies RuntimeResponse
      case 'overlay.runtime.conversations.create':
        return {
          ok: true,
          type: 'overlay.runtime.conversation.created',
          conversation: await createConversation(),
        } satisfies RuntimeResponse
      case 'overlay.runtime.conversations.delete':
        await deleteConversation(message.conversationId)
        return {
          ok: true,
          type: 'overlay.runtime.conversation.deleted',
          conversationId: message.conversationId,
        } satisfies RuntimeResponse
      case 'overlay.runtime.conversations.select':
        await selectConversation(message.conversationId)
        return {
          ok: true,
          type: 'overlay.runtime.conversation.selected',
          conversationId: message.conversationId,
        } satisfies RuntimeResponse
      case 'overlay.runtime.act.start':
        return {
          ok: true,
          type: 'overlay.runtime.act.started',
          run: await startActRun({
            conversationId: message.conversationId,
            prompt: message.prompt,
            scope: message.scope,
            sourceTabId: message.sourceTabId,
            actPolicy: message.actPolicy,
            attachments: message.attachments,
          }),
        } satisfies RuntimeResponse
      case 'overlay.runtime.chat.start':
        return {
          ok: true,
          type: 'overlay.runtime.chat.started',
          runs: await startChatRun({
            conversationId: message.conversationId,
            prompt: message.prompt,
            scope: message.scope,
            sourceTabId: message.sourceTabId,
            attachments: message.attachments,
          }),
        } satisfies RuntimeResponse
      case 'overlay.runtime.chat.stop':
        await stopChatRun(message.conversationId)
        return {
          ok: true,
          type: 'overlay.runtime.chat.stopped',
        } satisfies RuntimeResponse
      case 'overlay.runtime.act.stop':
        await stopActRun(message.conversationId)
        return {
          ok: true,
          type: 'overlay.runtime.act.stopped',
        } satisfies RuntimeResponse
      case 'overlay.runtime.conversation.settings.save':
        return {
          ok: true,
          type: 'overlay.runtime.conversation.settings.saved',
          conversation: await saveConversationSettings(message.conversationId, message.settings),
        } satisfies RuntimeResponse
      case 'overlay.runtime.approval.resolve':
        return {
          ok: true,
          type: 'overlay.runtime.approval.resolved',
          bootstrap: await resolveApproval(message),
        } satisfies RuntimeResponse
      case 'overlay.runtime.bridge.capture-browser-context':
        return {
          ok: true,
          type: 'overlay.runtime.bridge.browser-context',
          context: await captureBrowserContextEnvelope(),
        } satisfies RuntimeResponse
      case 'overlay.runtime.media.generate':
        await startMediaGeneration(message)
        return {
          ok: true,
          type: 'overlay.runtime.media.generated',
        } satisfies RuntimeResponse
      case 'overlay.runtime.entitlements.refresh':
        return {
          ok: true,
          type: 'overlay.runtime.entitlements.refreshed',
          entitlements: await refreshEntitlements(),
        } satisfies RuntimeResponse
      case 'overlay.runtime.parity.refresh':
        return {
          ok: true,
          type: 'overlay.runtime.parity.refreshed',
          parity: await refreshParitySnapshot(),
        } satisfies RuntimeResponse
      case 'overlay.runtime.files.ingest': {
        const result = await ingestDocument({
          fileName: message.fileName,
          mimeType: message.mimeType,
          base64: message.base64,
        })
        return {
          ok: true,
          type: 'overlay.runtime.files.ingested',
          documentId: result.documentId,
          indexedFileName: result.indexedFileName,
        } satisfies RuntimeResponse
      }
      case 'overlay.runtime.audio.transcribe': {
        const result = await transcribeAudio({
          mimeType: message.mimeType,
          base64: message.base64,
        })
        return {
          ok: true,
          type: 'overlay.runtime.audio.transcribed',
          text: result.text,
        } satisfies RuntimeResponse
      }
      case 'overlay.runtime.auth.open-sign-in': {
        const { url } = await prepareExtensionSignInTabUrl()
        return { ok: true, type: 'overlay.runtime.auth.open-sign-in', url } satisfies RuntimeResponse
      }
      default:
        return { ok: false, error: 'Unknown runtime request' } satisfies RuntimeResponse
    }
  }

  void handle()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Runtime request failed',
      } satisfies RuntimeResponse)
    })
  return true
})
