# Overlay native audio helper

This macOS-only helper keeps an `AVAudioEngine` graph prepared, but stopped, between recordings.
`prepare()` preallocates the graph; only the `start` command starts microphone hardware. `stop`
releases the hardware and then prepares the graph for the next recording.

Privacy and lifecycle invariants:

- The input device must report `inputRunning: false` while the helper is idle.
- No rolling buffer exists before the user starts recording.
- Audio is written as 16 kHz mono PCM WAV in Overlay's private temporary directory.
- Electron validates the returned path and file size, reads it once, and deletes it.
- A default-input-device listener rebuilds the stopped graph after device changes.
- Selected non-default Chromium devices are resolved to CoreAudio by their permission-gated
  display label. If a device cannot be mapped safely, Overlay uses its existing on-demand browser
  fallback instead of silently recording from a different microphone.

The design was informed by
[`drewburchfield/macos-mic-keepwarm`](https://github.com/drewburchfield/macos-mic-keepwarm),
especially its device-change and Bluetooth teardown findings. Overlay intentionally does not copy
its continuous-capture approach because continuous capture keeps macOS's microphone indicator on.
