/* eslint-disable @typescript-eslint/no-require-imports -- standalone Electron CommonJS QA script */
const { app, ipcMain } = require('electron')
require('tsx')
const dotenv = require('dotenv')
dotenv.config({ path: '.env.local' })
app.whenReady().then(async () => {
  try {
    const { keyCacheService } = require('../src/main/services/key-cache-service.ts')
    const { registerTranscriptionIPC } = require('../src/main/ipc/transcription-ipc.ts')
    keyCacheService.getKey = async (label) => {
      if (label === 'groq') return process.env.GROQ_API_KEY || null
      return null
    }
    registerTranscriptionIPC()
    const handler = ipcMain._invokeHandlers.get('stt:transcribe')
    const fs = require('node:fs')
    const buf = fs.readFileSync('scripts/test-recording.webm').buffer
    const start = Date.now()
    const result = await handler({}, { mime: 'audio/webm', buf, duration: 111 })
    console.log('result in', Date.now() - start, 'ms:', result)
  } catch (err) {
    console.error('err', err)
  } finally {
    app.quit()
  }
})
