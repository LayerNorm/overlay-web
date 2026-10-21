# Computer desktop driver

Overlay's desktop tools use one provider-neutral Python 3 driver installed inside a desktop-capable sandbox. The driver communicates with the server using one JSON request and response per command. It reports capabilities, captures PNG screenshots, and supports click, move, drag, type, key, scroll, and wait actions. Input uses `xdotool`; screenshots select the first available of ImageMagick `import`, `scrot`, or `ffmpeg` with X11 capture.

Screenshots default to 1280 pixels wide. Input coordinates are expressed in the latest screenshot's space and are scaled against the display geometry reported by `xdotool`, using the same maximum width. This keeps coordinate conversion deterministic without server-side display state.

Desktop input actions serialize inside the sandbox with `flock` on `/tmp/overlay-computer/input.lock`. Lock acquisition is bounded and returns `desktop_busy` when another action holds the lock. The server installs a versioned driver under `/tmp/overlay-computer` only when its marker check fails. If input, screenshot, or browser tools are missing and `apt-get` is available, it makes one bounded best-effort `sudo -n apt-get install -y xdotool imagemagick chromium` attempt; missing dependencies remain an explicit `desktop_unsupported` result.

## Browser control

`browser_ensure` starts Chromium detached on the desktop display only when `127.0.0.1:9222/json/version` is unavailable. CDP binds to `127.0.0.1` only. The profile at `$HOME/.config/overlay-browser` persists signed-in state across suspend and resume, and the computer's visible desktop uses this same browser.

The driver uses a Python standard-library WebSocket client for CDP. `computer_browser` supports HTTP and HTTPS navigation, back/forward/reload, text snapshots, ref-based click and type, bounded scrolling, Enter/Tab/Escape/arrows/PageDown, tab listing/switching, and new tabs. A snapshot includes the URL, title, visible text bounded to 20,000 characters, and up to 200 visible interactive elements with `data-overlay-ref` ids and viewport bounds. Actions resolve refs from the page DOM; take a fresh snapshot when a ref is missing or stale.

Browser-writing actions share the desktop input lock. Snapshot and tab listing are read-only and do not lock. If Chromium is missing, the bounded best-effort preparation step also attempts to install `chromium`; `computer_open_url` falls back to `xdg-open` only when browser setup reports `desktop_unsupported`.

## Approvals

Typing and key presses through `computer_input`, and typing or pressing keys through `computer_browser`, require approval in Work mode. The existing agent-run approval flow stores the request and displays its tool name. Ordinary Act calls fail closed with `approval_required` before accessing the computer because they have no approval UI. Unattended automations deny approval-required calls and never execute them.

Screenshots, navigation, scrolling, and clicks remain unapproved. Clicks are not yet approval-gated so reading and scrolling feeds stay fluid.

## Terminal sessions

`computer_terminal` runs shell commands as machine-owned sessions and does not require desktop capability, so each tool call can start, read, cancel, or list a session without retaining a server process handle. The command is passed as an argument to `sh -c`, not interpolated into the wrapper. Sessions use ids matching `t-` followed by 12 lowercase hexadecimal characters and store `out.log`, `pid`, `exit`, `started_at`, and `command` under `/tmp/overlay-computer/terminals/<id>/`. At most eight sessions may be running at once. Output reads default to 32 KiB and are capped at 64 KiB. Cancellation signals the process group and escalates from INT to TERM to KILL when needed.

Use terminal sessions for long-running or non-interactive commands such as builds, servers, and watchers. Poll with `read` and cancel when done. The Computer may idle-stop if the agent stops making tool calls, which ends its sessions. Session output is stored under `/tmp` and does not survive a machine stop. The gateway environment for a started command is inherited by its process and is never written to session files.
