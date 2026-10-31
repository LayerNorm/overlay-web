import { contextBridge, ipcRenderer } from 'electron'
import { prepareTranscriptionAudio } from './transcription-audio'
if (
  process.isMainFrame &&
  location.protocol === 'file:' &&
  !process.argv.some((arg) => arg.startsWith('--overlay-origin='))
)
  contextBridge.exposeInMainWorld('recorder', {
    onStart: (callback: (model: string, epoch: number, deviceId: string) => void) => {
      ipcRenderer.on('recorder:start', (_event, model, epoch, deviceId) =>
        callback(model, epoch, deviceId)
      )
    },
    onStop: (callback: () => void) => {
      ipcRenderer.on('recorder:stop', callback)
    },
    onCancel: (callback: () => void) => {
      ipcRenderer.on('recorder:cancel', callback)
    },
    transcribe: async (input: unknown, epoch: number) =>
      ipcRenderer.invoke('recorder:transcribe', await prepareTranscriptionAudio(input), epoch),
    pointer: (interactive: boolean) => ipcRenderer.send('recorder:pointer', interactive),
    ready: (epoch: number, firstAudioMs: number) =>
      ipcRenderer.send('recorder:ready', epoch, firstAudioMs),
    failed: (epoch: number) => ipcRenderer.send('recorder:failed', epoch),
    finish: () => ipcRenderer.send('recorder:finish'),
    copy: (epoch: number) => ipcRenderer.invoke('recorder:copy', epoch),
    cancel: () => ipcRenderer.send('recorder:cancel')
  })
