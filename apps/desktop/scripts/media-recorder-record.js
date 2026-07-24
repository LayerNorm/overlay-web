/* eslint-disable @typescript-eslint/no-require-imports -- standalone Electron CommonJS probe */
const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 100, height: 100, show: false, webPreferences: { contextIsolation: false, nodeIntegration: true } })
  win.webContents.on('console-message', (_e, level, message) => console.log('renderer:', message))
  win.loadURL('about:blank')
  win.webContents.executeJavaScript(`
    async function test() {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const dest = ctx.createMediaStreamDestination()
      osc.connect(dest)
      osc.start()
      const options = { mimeType: 'audio/mp4' }
      const mr = new MediaRecorder(dest.stream, options)
      const chunks = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      return new Promise((resolve) => {
        mr.onstop = () => {
          const blob = new Blob(chunks, { type: 'audio/mp4' })
          console.log('mp4 blob size:', blob.size, 'type:', blob.type)
          resolve(blob)
        }
        mr.start()
        setTimeout(() => mr.stop(), 3000)
      })
    }
    test()
  `).then((blob) => {
    console.log('blob returned size:', blob.size, 'type:', blob.type)
    app.quit()
  })
})
