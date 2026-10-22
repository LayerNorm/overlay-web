import { COMPUTER_BROWSER_CDP_SOURCE } from './browser-cdp'
import { COMPUTER_BROWSER_PROFILE_RECOVERY_SOURCE } from './browser-profile-recovery'

export const COMPUTER_BROWSER_DRIVER_SOURCE = String.raw`
def browser_response(path, timeout=2, method=None):
    request = urllib.request.Request(
        BROWSER_BASE_URL + path,
        headers={"Accept": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode("utf-8")
    except (OSError, ValueError, urllib.error.URLError, TimeoutError):
        return None


def browser_json(path, timeout=2, method=None):
    response = browser_response(path, timeout=timeout, method=method)
    if response is None:
        return None
    try:
        return json.loads(response)
    except ValueError:
        return None


def browser_version(timeout=1):
    value = browser_json("/json/version", timeout=timeout)
    return value if isinstance(value, dict) else None


def browser_new_page():
    target = browser_json("/json/new?about:blank", timeout=2, method="PUT")
    if (
        not isinstance(target, dict)
        or target.get("type") != "page"
        or not isinstance(target.get("id"), str)
        or not isinstance(target.get("webSocketDebuggerUrl"), str)
    ):
        raise DriverError("desktop_driver_failed", "A Chromium page could not be created.")
    return target


def browser_activate(target):
    target_id = target.get("id") if isinstance(target, dict) else None
    if not isinstance(target_id, str):
        raise DriverError("desktop_driver_failed", "The Chromium page could not be activated.")
    response = browser_response(
        "/json/activate/" + urllib.parse.quote(target_id, safe=""),
        timeout=2,
    )
    if response is None:
        raise DriverError("desktop_driver_failed", "The Chromium page could not be activated.")


${COMPUTER_BROWSER_PROFILE_RECOVERY_SOURCE}

def browser_binary():
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        binary = shutil.which(name)
        if binary:
            return binary
    return None


def visible_chromium_window():
    try:
        result = subprocess.run(
            ["xdotool", "search", "--onlyvisible", "--class", "chrom"],
            capture_output=True,
            text=True,
            env=command_environment(),
            timeout=2,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return True
    return result.returncode == 0 and bool(result.stdout.strip())


def ensure_browser_window():
    pages = page_targets()
    if not pages or not visible_chromium_window():
        target = browser_new_page()
        browser_activate(target)


def browser_ready():
    ensure_browser_window()
    return {"success": True, "browser": "chromium"}


def ensure_browser():
    if browser_version():
        return browser_ready()
    with input_lock():
        if browser_version():
            return browser_ready()

        binary = browser_binary()
        if not binary:
            raise DriverError("desktop_unsupported", "Chromium is not installed.", ["chromium"])

        try:
            os.makedirs(BROWSER_PROFILE, exist_ok=True)
            recover_profile_lock()
            os.makedirs(os.path.dirname(BROWSER_LOG_PATH), exist_ok=True)
            with open(BROWSER_LOG_PATH, "ab", buffering=0) as browser_log:
                child = subprocess.Popen(
                    [
                        binary,
                        "--remote-debugging-address=127.0.0.1",
                        "--remote-debugging-port=9222",
                        "--user-data-dir=" + BROWSER_PROFILE,
                        "--no-first-run",
                        "--no-default-browser-check",
                    ],
                    stdin=subprocess.DEVNULL,
                    stdout=browser_log,
                    stderr=browser_log,
                    env=command_environment(),
                    start_new_session=True,
                    close_fds=True,
                )
        except OSError:
            raise DriverError("desktop_driver_failed", "Chromium could not be started.")

        deadline = time.monotonic() + BROWSER_START_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            remaining = deadline - time.monotonic()
            if browser_version(timeout=min(1, remaining)):
                return browser_ready()
            if child.poll() is not None:
                raise browser_start_error(binary, child)
            time.sleep(min(0.25, max(0, deadline - time.monotonic())))
        raise browser_start_error(binary, child)


def validate_browser_url(value):
    if not isinstance(value, str):
        raise DriverError("invalid_input", "url must be an HTTP or HTTPS URL.")
    try:
        parsed = urllib.parse.urlsplit(value)
        valid_host = bool(parsed.hostname) and parsed.port != 0
    except ValueError:
        valid_host = False
        parsed = None
    if parsed is None or parsed.scheme not in ("http", "https") or not valid_host:
        raise DriverError("invalid_input", "url must be an HTTP or HTTPS URL.")
    return value


${COMPUTER_BROWSER_CDP_SOURCE}


def page_targets():
    targets = browser_json("/json/list", timeout=2)
    if not isinstance(targets, list):
        raise DriverError("desktop_unsupported", "The Chromium browser is unavailable.", ["chromium"])
    pages = [
        target for target in targets
        if isinstance(target, dict)
        and target.get("type") == "page"
        and isinstance(target.get("id"), str)
        and isinstance(target.get("webSocketDebuggerUrl"), str)
    ]
    return pages


def active_page_target():
    pages = page_targets()
    if not pages:
        return browser_new_page()
    return pages[0]


def evaluate(connection, expression):
    result = connection.call("Runtime.evaluate", {
        "expression": expression,
        "returnByValue": True,
        "awaitPromise": True,
    })
    if result.get("exceptionDetails"):
        raise DriverError("desktop_driver_failed", "The browser page action failed.")
    remote = result.get("result")
    if not isinstance(remote, dict):
        raise DriverError("desktop_driver_failed", "The browser page returned no result.")
    return remote.get("value")


SNAPSHOT_EXPRESSION = r"""(() => {
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
      && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < innerHeight && rect.left < innerWidth;
  };
  const elements = [...document.querySelectorAll(
    'a[href],button,input,textarea,select,[role],[tabindex],[contenteditable="true"]'
  )].filter(visible).slice(0, 200).map(element => {
    let ref = element.getAttribute('data-overlay-ref');
    if (!ref || !/^overlay-[0-9]+$/.test(ref)) {
      window.__overlayRefCounter = (window.__overlayRefCounter || 0) + 1;
      ref = 'overlay-' + window.__overlayRefCounter;
      element.setAttribute('data-overlay-ref', ref);
    }
    const rect = element.getBoundingClientRect();
    const label = element.getAttribute('aria-label')
      || [...(element.labels || [])].map(label => label.innerText || '').join(' ').trim()
      || element.getAttribute('title')
      || element.getAttribute('placeholder')
      || element.innerText
      || element.value
      || '';
    return {
      ref,
      role: element.getAttribute('role') || element.tagName.toLowerCase(),
      name: String(label).trim().slice(0, 300),
      bbox: {
        x: Math.max(0, Math.round(rect.left)),
        y: Math.max(0, Math.round(rect.top)),
        width: Math.max(0, Math.round(Math.min(innerWidth, rect.right) - Math.max(0, rect.left))),
        height: Math.max(0, Math.round(Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)))
      }
    };
  });
  return {
    url: location.href,
    title: document.title,
    text: (document.body?.innerText || '').slice(0, 20000),
    elements
  };
})()"""


def target_connection(target=None):
    selected = target or active_page_target()
    return CDPConnection(selected["webSocketDebuggerUrl"])


def browser_ref_expression(ref, action):
    if not isinstance(ref, str) or not re.fullmatch(r"overlay-[0-9]+", ref):
        raise DriverError("invalid_input", "ref must come from the latest browser snapshot.")
    ref_json = json.dumps(ref)
    return (
        "(() => { const element = document.querySelector('[data-overlay-ref=' + "
        "JSON.stringify(" + ref_json + ") + ']'); "
        "if (!element) throw new Error('ref not found'); "
        + action +
        " })()"
    )


def click_inspection_body():
    return (
        "const tag = element.tagName.toLowerCase(); "
        "const type = String(element.getAttribute('type') || (tag === 'button' ? element.type : '') || '').trim().toLowerCase(); "
        "const accessibleName = element.getAttribute('aria-label') "
        "|| [...(element.labels || [])].map(label => label.innerText || '').join(' ').trim() "
        "|| element.innerText || element.textContent || element.getAttribute('value') || element.value || ''; "
        "return { role: element.getAttribute('role') || tag, tag, type, "
        "name: String(accessibleName).trim(), "
        "isSubmit: (tag === 'button' || tag === 'input') && type === 'submit' && Boolean(element.closest('form')) };"
    )


def coordinate_click_expression(x, y):
    return (
        "(() => { const scale = window.devicePixelRatio || 1; "
        "const sideBorder = (window.outerWidth - window.innerWidth) / 2; "
        "const topChrome = window.outerHeight - window.innerHeight - sideBorder; "
        "if (document.visibilityState === 'hidden') return { outsideViewport: true }; "
        "const clientX = " + str(x) + " / scale - window.screenX - sideBorder; "
        "const clientY = " + str(y) + " / scale - window.screenY - topChrome; "
        "if (clientX < 0 || clientY < 0 || clientX >= window.innerWidth || clientY >= window.innerHeight) "
        "return { outsideViewport: true }; "
        "const hit = document.elementFromPoint(clientX, clientY); "
        "if (!hit) return { outsideViewport: true }; "
        "if (hit.tagName.toLowerCase() === 'iframe') return { uninspectable: true, label: 'iframe' }; "
        "const element = hit.closest('button,a,input,[role=button],[role=link],[role=menuitem]'); "
        "if (!element) return { interactive: false }; "
        + click_inspection_body()
        + " })()"
    )


def coordinate_click_approval_result(label, reason=None):
    result = {
        "success": False,
        "error": "approval_required",
        "label": str(label or "")[:80],
        "message": (
            "This click may post, send, buy, or delete something. Call computer_input click again "
            "with confirm: true to ask the user for approval."
        ),
    }
    if reason is not None:
        result["reason"] = reason
    return result


def coordinate_click_approval(x, y):
    try:
        version = browser_version()
    except Exception:
        return None
    if version is None:
        return None
    try:
        target = active_page_target()
        with target_connection(target) as connection:
            info = evaluate(connection, coordinate_click_expression(x, y))
        if not isinstance(info, dict):
            raise DriverError("desktop_driver_failed", "The browser click target could not be inspected.")
        if info.get("outsideViewport") is True or info.get("interactive") is False:
            return None
        if info.get("uninspectable") is True:
            return coordinate_click_approval_result(info.get("label") or "iframe")
        name = str(info.get("name") or "").strip()
        if info.get("isSubmit") is True or RISKY_CLICK_NAME.search(name) is not None:
            return coordinate_click_approval_result(name)
        return None
    except Exception as error:
        reason = error.code if isinstance(error, DriverError) else type(error).__name__
        return coordinate_click_approval_result("Unknown browser control", reason)


def dispatch_browser_key(connection, key):
    key_codes = {
        "Enter": ("Enter", 13),
        "Tab": ("Tab", 9),
        "Escape": ("Escape", 27),
        "ArrowUp": ("ArrowUp", 38),
        "ArrowDown": ("ArrowDown", 40),
        "ArrowLeft": ("ArrowLeft", 37),
        "ArrowRight": ("ArrowRight", 39),
        "PageDown": ("PageDown", 34),
    }
    if key not in key_codes:
        raise DriverError("invalid_input", "keys must be Enter, Tab, Escape, an arrow, or PageDown.")
    code, virtual_key = key_codes[key]
    base = {"key": key, "code": code, "windowsVirtualKeyCode": virtual_key, "nativeVirtualKeyCode": virtual_key}
    connection.call("Input.dispatchKeyEvent", {"type": "keyDown", **base})
    connection.call("Input.dispatchKeyEvent", {"type": "keyUp", **base})


def run_browser(request):
    action = request.get("action")
    if action not in ("snapshot", "tabs"):
        with input_lock():
            return run_browser_action(request, action)
    return run_browser_action(request, action)


def run_browser_action(request, action):
    if action == "navigate":
        url = validate_browser_url(request.get("url"))
        target = active_page_target()
        browser_activate(target)
        with target_connection(target) as connection:
            connection.call("Page.navigate", {"url": url})
        return {"success": True}
    if action in ("back", "forward"):
        with target_connection() as connection:
            history = connection.call("Page.getNavigationHistory")
            entries = history.get("entries") or []
            index = history.get("currentIndex", -1)
            offset = -1 if action == "back" else 1
            destination = index + offset
            if 0 <= destination < len(entries):
                connection.call("Page.navigateToHistoryEntry", {"entryId": entries[destination]["id"]})
                return {"success": True, "navigated": True}
        return {"success": True, "navigated": False}
    if action == "reload":
        with target_connection() as connection:
            connection.call("Page.reload", {"ignoreCache": False})
        return {"success": True}
    if action == "snapshot":
        with target_connection() as connection:
            value = evaluate(connection, SNAPSHOT_EXPRESSION)
        if not isinstance(value, dict):
            raise DriverError("desktop_driver_failed", "The browser snapshot was invalid.")
        return value
    if action == "click":
        expression = browser_ref_expression(request.get("ref"), click_inspection_body())
        with target_connection() as connection:
            info = evaluate(connection, expression)
            if not isinstance(info, dict):
                raise DriverError("desktop_driver_failed", "The browser click target could not be inspected.")
            name = str(info.get("name") or "").strip()
            if request.get("confirm") is not True and (
                info.get("isSubmit") is True or RISKY_CLICK_NAME.search(name) is not None
            ):
                return {
                    "success": False,
                    "error": "approval_required",
                    "label": name[:80],
                    "message": (
                        "This click may post, send, buy, or delete something. Call computer_browser click again "
                        "with confirm: true to ask the user for approval."
                    ),
                }
            click_expression = browser_ref_expression(request.get("ref"), "element.click(); return true;")
            evaluate(connection, click_expression)
        return {"success": True}
    if action == "type":
        text = request.get("text")
        if not isinstance(text, str) or len(text) > 10000:
            raise DriverError("invalid_input", "text must contain at most 10000 characters.")
        expression = browser_ref_expression(request.get("ref"), "element.focus(); return true;")
        with target_connection() as connection:
            evaluate(connection, expression)
            connection.call("Input.insertText", {"text": text})
            if request.get("submit", False):
                dispatch_browser_key(connection, "Enter")
        return {"success": True}
    if action == "scroll":
        direction = request.get("direction")
        amount = required_integer(request.get("amount"), "amount", 1, 25)
        offsets = {
            "up": (0, -1),
            "down": (0, 1),
            "left": (-1, 0),
            "right": (1, 0),
        }
        if direction not in offsets:
            raise DriverError("invalid_input", "direction must be up, down, left, or right.")
        x_offset, y_offset = offsets[direction]
        expression = (
            "window.scrollBy({left: innerWidth * " + str(x_offset * amount)
            + ", top: innerHeight * " + str(y_offset * amount) + ", behavior: 'instant'}); true"
        )
        with target_connection() as connection:
            evaluate(connection, expression)
        return {"success": True}
    if action == "press":
        with target_connection() as connection:
            dispatch_browser_key(connection, request.get("keys"))
        return {"success": True}
    if action == "tabs":
        pages = page_targets()
        return {
            "tabs": [
                {"index": index, "url": target.get("url", ""), "title": target.get("title", "")}
                for index, target in enumerate(pages[:50])
            ]
        }
    if action == "switch_tab":
        index = required_integer(request.get("index"), "index", 0, 49)
        pages = page_targets()
        if index >= len(pages):
            raise DriverError("invalid_input", "index does not identify an open browser tab.")
        browser_activate(pages[index])
        return {"success": True, "index": index}
    if action == "new_tab":
        url = validate_browser_url(request.get("url"))
        version = browser_version()
        if not version or not isinstance(version.get("webSocketDebuggerUrl"), str):
            raise DriverError("desktop_unsupported", "The Chromium browser is unavailable.", ["chromium"])
        with CDPConnection(version["webSocketDebuggerUrl"]) as connection:
            created = connection.call("Target.createTarget", {"url": url})
        target_id = created.get("targetId")
        if not isinstance(target_id, str):
            raise DriverError("desktop_driver_failed", "The browser tab could not be created.")
        browser_activate({"id": target_id})
        return {"success": True, "targetId": target_id}
    raise DriverError("invalid_input", "Unsupported browser action.")


`
