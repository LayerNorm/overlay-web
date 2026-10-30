# Computer desktop driver

Computer operations release their wake claim if provider reconnection fails. An expired wake, stop, idle, or bound provision claim is recovered by confirming a stop and settling usage before reserving and resuming the same machine. Recovery requires the exact expired claim and cannot preempt live activity or deletion; failed settlement keeps the computer blocked rather than bypassing accounting.

Recovery claims include `recoveryProtocol: 'computer-recovery-v1'`. Older Convex validators reject this marker, so the web-first rollout cannot stop machines without the new atomic recovery guards. Recovery becomes available after the matching backend is synchronized through the canonical-main release workflow.

Overlay's desktop tools use one provider-neutral Python 3 driver installed inside a desktop-capable sandbox. The driver communicates with the server using one JSON request and response per command. It reports capabilities, captures PNG screenshots, and supports click, move, drag, type, key, scroll, and wait actions. Input uses `xdotool`; screenshots select the first available of ImageMagick `import`, `scrot`, or `ffmpeg` with X11 capture.

Input failures keep the stable user-facing message and include bounded exit, timeout, or spawn status, the xdotool subcommand, and stderr. Typed text is redacted from stderr.

## Human takeover

Workspace members with access to a Computer can take control while it is ready. The takeover records the controlling user and timestamp. Agent input, browser writes, and URL opening are blocked until control is released. Screenshots, browser snapshots and tabs, terminal sessions, and shell commands remain available. A completed stop or deletion clears the takeover state.

## Risky browser clicks

The browser driver inspects referenced elements and pixel-click targets before clicking. Submit controls and names that look like posting, sending, purchasing, deleting, or other consequential actions require a second call with `confirm: true`. Personal Chat uses the durable AgentRun approval flow for these actions. Pixel clicks outside the browser or on non-browser windows proceed normally because they cannot be inspected as page controls.

Screenshots default to 1280 pixels wide. Input coordinates are expressed in the latest screenshot's space and are scaled against the display geometry reported by `xdotool`, using the same maximum width. This keeps coordinate conversion deterministic without server-side display state.

Desktop input actions serialize inside the sandbox with `flock` on `/tmp/overlay-computer/input.lock`. Lock acquisition is bounded and returns `desktop_busy` when another action holds the lock. The server installs a versioned driver under `/tmp/overlay-computer` only when its marker check fails. If input, screenshot, or browser tools are missing and `apt-get` is available, it makes one bounded best-effort `sudo -n apt-get install -y xdotool imagemagick chromium` attempt; missing dependencies remain an explicit `desktop_unsupported` result.

## Browser control

`browser_ensure` starts Chromium detached on the desktop display only when `127.0.0.1:9222/json/version` is unavailable. Once CDP is available, it checks `/json/list`, creates and activates an `about:blank` page when none exists, and best-effort checks for a visible Chromium window with `xdotool`, creating and activating a page when needed. Navigation and tab switching activate their selected targets. CDP binds to `127.0.0.1` only. The profile at `$HOME/.config/overlay-browser` persists signed-in state across suspend and resume, and the computer's visible desktop uses this same browser.

The driver uses a Python standard-library WebSocket client for CDP. `computer_browser` supports HTTP and HTTPS navigation, back/forward/reload, text snapshots, ref-based click and type, bounded scrolling, Enter/Tab/Escape/arrows/PageDown, tab listing/switching, and new tabs. A snapshot includes the URL, title, visible text bounded to 20,000 characters, and up to 200 visible interactive elements with `data-overlay-ref` ids and viewport bounds. Actions resolve refs from the page DOM; take a fresh snapshot when a ref is missing or stale.

Browser-writing actions share the desktop input lock. Snapshot and tab listing are read-only and do not lock. If Chromium is missing, the bounded best-effort preparation step also attempts to install `chromium`; `computer_open_url` falls back to `xdg-open` only when browser setup reports `desktop_unsupported`.

## Approvals

Typing and key presses through `computer_input`, and typing or pressing keys through `computer_browser`, require approval in personal Chat. Confirmed clicks on risky browser controls also require approval in personal Chat. The existing agent-run approval flow stores the request and displays its tool name. Calls without an approval-capable personal run fail closed with `approval_required` before accessing the computer. Unattended automations deny approval-required calls and never execute them.

Screenshots, navigation, scrolling, and ordinary clicks remain unapproved. Risky browser controls are inspected before a coordinate click, so reading and scrolling feeds stay fluid.

## Terminal sessions

`computer_terminal` runs shell commands as machine-owned sessions and does not require desktop capability, so each tool call can start, read, cancel, or list a session without retaining a server process handle. The command is passed as an argument to `sh -c`, not interpolated into the wrapper. Sessions use ids matching `t-` followed by 12 lowercase hexadecimal characters and store `out.log`, `pid`, `exit`, `started_at`, and `command` under `/tmp/overlay-computer/terminals/<id>/`. At most eight sessions may be running at once. Output reads default to 32 KiB and are capped at 64 KiB. Cancellation signals the process group and escalates from INT to TERM to KILL when needed.

Use terminal sessions for long-running or non-interactive commands such as builds, servers, and watchers. Poll with `read` and cancel when done. The Computer may idle-stop if the agent stops making tool calls, which ends its sessions. Session output is stored under `/tmp` and does not survive a machine stop. The gateway environment for a started command is inherited by its process and is never written to session files.

## Driver verification

Driver tests use temporary filesystem roots and a dynamically assigned mock CDP port, so concurrent suites cannot consume each other's browser or terminal state. Coordinate-scaling tests supply explicit click approval; the browser suite separately verifies the approval gate. Procfs profile-ownership recovery and terminal process groups require Linux (`/proc` and `setsid`); these cases remain required in Linux CI and report explicit platform skips on macOS.
