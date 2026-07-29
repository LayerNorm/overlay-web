import { ipcMain } from '../services/security/secure-ipc-main'
import { nativeAudioCaptureService } from '../services/native-audio-capture-service'

export function registerNativeAudioIPC(): void {
  ipcMain.handle(
    'native-audio:configure',
    async (_event, options?: { useDefaultDevice?: boolean; deviceLabel?: string }) => {
      await nativeAudioCaptureService.configure({
        useDefaultDevice: options?.useDefaultDevice !== false,
        deviceLabel: options?.deviceLabel
      })
    }
  )
  ipcMain.handle(
    'native-audio:start',
    async (_event, options?: { useDefaultDevice?: boolean; deviceLabel?: string }) => {
      const useDefaultDevice = options?.useDefaultDevice !== false
      return nativeAudioCaptureService.start({
        useDefaultDevice,
        deviceLabel: options?.deviceLabel
      })
    }
  )
  ipcMain.handle('native-audio:stop', () => nativeAudioCaptureService.stop())
  ipcMain.handle('native-audio:cancel', () => nativeAudioCaptureService.cancel())
  ipcMain.handle('native-audio:pause', () => nativeAudioCaptureService.pause())
  ipcMain.handle('native-audio:resume', () => nativeAudioCaptureService.resume())
}
