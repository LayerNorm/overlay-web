;(() => {
  let recorder,
    stream,
    pending = false,
    epoch = 0
  const status = document.getElementById('status')
  const release = () => {
    if (recorder) {
      recorder.onstop = null
      recorder.ondataavailable = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    stream?.getTracks().forEach((track) => track.stop())
    recorder = undefined
    stream = undefined
  }
  const invalidate = () => {
    epoch++
    pending = false
    release()
  }
  window.recorder.onStart(async (selected, recordingEpoch) => {
    if (pending || recorder?.state === 'recording') return
    const started = ++epoch
    pending = true
    status.textContent = 'Opening microphone…'
    let acquired
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (started !== epoch) {
        acquired.getTracks().forEach((track) => track.stop())
        return
      }
      stream = acquired
      const capture = new MediaRecorder(acquired)
      recorder = capture
      const chunks = []
      capture.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      capture.onstop = async () => {
        acquired.getTracks().forEach((track) => track.stop())
        if (started !== epoch) return
        stream = undefined
        status.textContent = 'Transcribing…'
        try {
          const audio = new Uint8Array(await new Blob(chunks).arrayBuffer())
          if (started !== epoch) return
          await window.recorder.transcribe(
            { audio, mime: capture.mimeType.split(';')[0], model: selected },
            recordingEpoch
          )
        } catch {
          if (started !== epoch) return
          status.textContent = 'Dictation failed. Check Desktop settings.'
          setTimeout(() => {
            if (started === epoch) {
              invalidate()
              window.recorder.cancel()
            }
          }, 3000)
        }
      }
      capture.onstart = () => {
        if (started === epoch) status.textContent = 'Listening…'
      }
      capture.start()
      pending = false
    } catch {
      acquired?.getTracks().forEach((track) => track.stop())
      if (started !== epoch) return
      pending = false
      status.textContent = 'Allow microphone access in System Settings.'
      setTimeout(() => {
        if (started === epoch) {
          invalidate()
          window.recorder.cancel()
        }
      }, 3000)
    }
  })
  window.recorder.onStop(() => {
    if (recorder?.state === 'recording') recorder.stop()
    else {
      invalidate()
      window.recorder.cancel()
    }
  })
  window.recorder.onCancel(invalidate)
})()
