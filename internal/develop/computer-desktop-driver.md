# Computer desktop driver

Overlay's desktop tools use one provider-neutral Python 3 driver installed inside a desktop-capable sandbox. The driver communicates with the server using one JSON request and response per command. It reports capabilities, captures PNG screenshots, and supports click, move, drag, type, key, scroll, and wait actions. Input uses `xdotool`; screenshots select the first available of ImageMagick `import`, `scrot`, or `ffmpeg` with X11 capture.

Screenshots default to 1280 pixels wide. Input coordinates are expressed in the latest screenshot's space and are scaled against the display geometry reported by `xdotool`, using the same maximum width. This keeps coordinate conversion deterministic without server-side display state.

Desktop input actions serialize inside the sandbox with `flock` on `/tmp/overlay-computer/input.lock`. Lock acquisition is bounded and returns `desktop_busy` when another action holds the lock. The server installs a versioned driver under `/tmp/overlay-computer` only when its marker check fails. If input or screenshot tools are missing and `apt-get` is available, it makes one bounded best-effort `sudo -n apt-get install -y xdotool imagemagick` attempt; missing dependencies remain an explicit `desktop_unsupported` result.
