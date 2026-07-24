/* eslint-disable @typescript-eslint/no-require-imports -- standalone Electron CommonJS probe */
const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 100, height: 100, show: false, webPreferences: { contextIsolation: false, nodeIntegration: true } })
  win.webContents.on('console-message', (_e, level, message) => {
    console.log('renderer:', message)
  })
  win.loadURL('about:blank')
  win.webContents.executeJavaScript(`
    const types = ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/wav', 'audio/ogg', 'audio/ogg;codecs=opus'];
    types.forEach(t => console.log(t, MediaRecorder.isTypeSupported(t)));
    'done'
  `).then(() => {
    setTimeout(() => app.quit(), 500)
  })
})
