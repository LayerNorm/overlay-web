import { contextBridge, ipcRenderer } from 'electron'
import { prepareTranscriptionAudio } from './transcription-audio'
if (process.isMainFrame && location.protocol === 'file:' && !process.argv.some(arg => arg.startsWith('--overlay-origin=')))
  contextBridge.exposeInMainWorld('recorder', {
    onStart: (callback: (model: string, epoch: number) => void) => {
      ipcRenderer.on('recorder:start', (_event, model, epoch) => callback(model, epoch))
    },
    onStop: (callback: () => void) => {
      ipcRenderer.on('recorder:stop', callback)
    },
    onCancel: (callback: () => void) => {
      ipcRenderer.on('recorder:cancel', callback)
    },
    transcribe: async (input: unknown, epoch: number) => ipcRenderer.invoke('recorder:transcribe', await prepareTranscriptionAudio(input), epoch),
    cancel: () => ipcRenderer.send('recorder:cancel')
  })
