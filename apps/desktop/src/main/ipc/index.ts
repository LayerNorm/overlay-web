import { app } from 'electron'
import { registerSettingsIPC } from './settings-ipc'
import { registerModelsIPC } from './models-ipc'
import { registerPanelIPC } from './panel-ipc'
import { registerTranscriptionIPC } from './transcription-ipc'
import { registerChatIPC, invalidateChatModelsCache } from './chat-ipc'
import { registerNotebookIPC } from './notebook-ipc'
import { registerContextMenuIPC } from './context-menu-ipc'
import { registerMemoryIPC } from './memory-ipc'
import { registerContextHandlers } from './context-ipc'
import { registerImportIPC } from './import-ipc'
import { registerAgentIPC } from './agent-ipc'
import { registerComposioIPC } from './composio-ipc'
import { registerNotebookAgentIPC } from './notebook-agent-ipc'
import { registerKnowledgeIpcHandlers } from './knowledge-ipc'
import { registerDocumentIpcHandlers } from './document-ipc'
import { registerBrowserChatIPC } from './browser-chat-ipc'
import { registerNotificationIPC } from './notification-ipc'
import { registerSubscriptionIPC } from './subscription-ipc'
import { registerSecurityIpcHandlers } from './security-ipc'
import { registerTerminalIPC } from './terminal-ipc'
import { registerRuntimeIPC } from './runtime-ipc'
import { registerAppApiIPC } from './app-api-ipc'
import { registerChatMediaIPC } from './chat-media-ipc'
import { registerKnowledgeMigrationIPC } from './knowledge-migration-ipc'
import { registerKnowledgeFilesIPC } from './knowledge-files-ipc'
import { registerNativeAudioIPC } from './native-audio-ipc'
import { areUnsafeLocalCapabilitiesEnabled } from '../services/security/containment-capability-profile'

export {
  registerSettingsIPC,
  registerModelsIPC,
  registerPanelIPC,
  registerTranscriptionIPC,
  registerChatIPC,
  registerNotebookIPC,
  registerContextMenuIPC,
  registerMemoryIPC,
  registerContextHandlers,
  registerImportIPC,
  registerAgentIPC,
  registerComposioIPC,
  registerNotebookAgentIPC,
  registerKnowledgeIpcHandlers,
  registerDocumentIpcHandlers,
  registerBrowserChatIPC,
  registerNotificationIPC,
  registerSubscriptionIPC,
  registerSecurityIpcHandlers,
  registerTerminalIPC,
  registerRuntimeIPC,
  registerAppApiIPC,
  registerChatMediaIPC,
  registerKnowledgeMigrationIPC,
  registerKnowledgeFilesIPC,
  registerNativeAudioIPC,
  invalidateChatModelsCache
}

export function registerAllIPC(): void {
  registerSettingsIPC()
  registerModelsIPC()
  registerPanelIPC()
  registerTranscriptionIPC()
  registerChatIPC()
  registerNotebookIPC()
  registerContextMenuIPC()
  registerMemoryIPC()
  registerContextHandlers()
  registerImportIPC()
  registerAgentIPC()
  const unsafeLocalCapabilitiesEnabled = areUnsafeLocalCapabilitiesEnabled(app.isPackaged)

  if (unsafeLocalCapabilitiesEnabled) {
    registerComposioIPC()
  }
  registerNotebookAgentIPC()
  registerKnowledgeIpcHandlers()
  registerDocumentIpcHandlers()
  registerBrowserChatIPC()
  registerNotificationIPC()
  registerSubscriptionIPC()
  registerSecurityIpcHandlers()
  if (unsafeLocalCapabilitiesEnabled) {
    registerTerminalIPC()
    registerRuntimeIPC()
  } else {
    console.warn(
      '[Security] Phase 0 containment active: terminal, runtime, package, and local Composio IPC are disabled'
    )
  }
  registerAppApiIPC()
  registerChatMediaIPC()
  registerKnowledgeMigrationIPC()
  registerKnowledgeFilesIPC()
  registerNativeAudioIPC()
}
