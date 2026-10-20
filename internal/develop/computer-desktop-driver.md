# Computer desktop driver

Overlay's desktop tools use one provider-neutral Python 3 driver installed inside a desktop-capable sandbox. The driver communicates with the server using one JSON request and response per command. It reports capabilities, captures PNG screenshots, and supports click, move, drag, type, key, scroll, and wait actions. Input uses `xdotool`; screenshots select the first available of ImageMagick `import`, `scrot`, or `ffmpeg` with X11 capture.

Screenshots default to 1280 pixels wide. Input coordinates are expressed in the latest screenshot's space and are scaled against the display geometry reported by `xdotool`, using the same maximum width. This keeps coordinate conversion deterministic without server-side display state.

Desktop input actions serialize inside the sandbox with `flock` on `/tmp/overlay-computer/input.lock`. Lock acquisition is bounded and returns `desktop_busy` when another action holds the lock. The server installs a versioned driver under `/tmp/overlay-computer` only when its marker check fails. If input, screenshot, or browser tools are missing and `apt-get` is available, it makes one bounded best-effort `sudo -n apt-get install -y xdotool imagemagick chromium` attempt; missing dependencies remain an explicit `desktop_unsupported` result.

## Browser control

`browser_ensure` starts Chromium detached on the desktop display only when `127.0.0.1:9222/json/version` is unavailable. CDP binds to `127.0.0.1` only. The profile at `$HOME/.config/overlay-browser` persists signed-in state across suspend and resume, and the computer's visible desktop uses this same browser.

The driver uses a Python standard-library WebSocket client for CDP. `computer_browser` supports HTTP and HTTPS navigation, back/forward/reload, text snapshots, ref-based click and type, bounded scrolling, Enter/Tab/Escape/arrows/PageDown, tab listing/switching, and new tabs. A snapshot includes the URL, title, visible text bounded to 20,000 characters, and up to 200 visible interactive elements with `data-overlay-ref` ids and viewport bounds. Actions resolve refs from the page DOM; take a fresh snapshot when a ref is missing or stale.

Browser-writing actions share the desktop input lock. Snapshot and tab listing are read-only and do not lock. If Chromium is missing, the bounded best-effort preparation step also attempts to install `chromium`; `computer_open_url` falls back to `xdg-open` only when browser setup reports `desktop_unsupported`.
