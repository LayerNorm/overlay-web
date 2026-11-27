import { contextBridge, ipcRenderer } from 'electron'
import { prepareTranscriptionAudio } from './transcription-audio'
import {
  BRIDGE_CHANNEL,
  BRIDGE_EVENT,
  type DesktopBridge,
  type Events
} from '../../packages/overlay-desktop-bridge/src/index'

const originArg = process.argv.find((arg) => arg.startsWith('--overlay-origin='))
const origin = originArg?.slice('--overlay-origin='.length)
if (process.isMainFrame && origin && location.origin === origin) {
  const bridge: DesktopBridge = {
    handshake: () => ipcRenderer.invoke(BRIDGE_CHANNEL, 'handshake', undefined),
    call: async (method, input) => {
      const value = method === 'transcription.transcribe' ? await prepareTranscriptionAudio(input) : input
      return ipcRenderer.invoke(BRIDGE_CHANNEL, method, value).catch((error: Error) => {
        throw new Error(
          error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
        )
      })
    },
    on: <E extends keyof Events>(event: E, callback: (value: Events[E]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, name: string, value: Events[E]) => {
        if (name === event) callback(value)
      }
      ipcRenderer.on(BRIDGE_EVENT, listener)
      return () => ipcRenderer.removeListener(BRIDGE_EVENT, listener)
    }
  }
  contextBridge.exposeInMainWorld('overlayDesktop', bridge)
}
