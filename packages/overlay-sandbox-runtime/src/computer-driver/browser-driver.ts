export const COMPUTER_BROWSER_DRIVER_SOURCE = String.raw`
def browser_json(path, timeout=2):
    request = urllib.request.Request(
        BROWSER_BASE_URL + path,
        headers={"Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError, urllib.error.URLError, TimeoutError):
        return None


def browser_version():
    value = browser_json("/json/version", timeout=1)
    return value if isinstance(value, dict) else None


def browser_binary():
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        binary = shutil.which(name)
        if binary:
            return binary
    return None


def ensure_browser():
    if browser_version():
        return {"success": True, "browser": "chromium"}
    with input_lock():
        if browser_version():
            return {"success": True, "browser": "chromium"}

        binary = browser_binary()
        if not binary:
            raise DriverError("desktop_unsupported", "Chromium is not installed.", ["chromium"])

        try:
            os.makedirs(BROWSER_PROFILE, exist_ok=True)
            subprocess.Popen(
                [
                    binary,
                    "--remote-debugging-address=127.0.0.1",
                    "--remote-debugging-port=9222",
                    "--user-data-dir=" + BROWSER_PROFILE,
                    "--no-first-run",
                    "--no-default-browser-check",
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=command_environment(),
                start_new_session=True,
                close_fds=True,
            )
        except OSError:
            raise DriverError("desktop_driver_failed", "Chromium could not be started.")

        deadline = time.monotonic() + BROWSER_START_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if browser_version():
                return {"success": True, "browser": "chromium"}
            time.sleep(0.25)
        raise DriverError("desktop_driver_failed", "Chromium did not start in time.")


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


class CDPConnection:
    def __init__(self, websocket_url):
        parsed = urllib.parse.urlsplit(websocket_url)
        if (
            parsed.scheme != "ws"
            or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
            or parsed.port != BROWSER_PORT
        ):
            raise DriverError("desktop_unsupported", "The browser debugger is not on loopback.")
        path = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
        self.socket = socket.create_connection((BROWSER_HOST, BROWSER_PORT), timeout=10)
        self.socket.settimeout(15)
        self.buffer = b""
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            "GET " + path + " HTTP/1.1\r\n"
            "Host: 127.0.0.1:9222\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: " + key + "\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.socket.sendall(request.encode("ascii"))
        response = self.read_until(b"\r\n\r\n").decode("iso-8859-1")
        lines = response.split("\r\n")
        if not lines or " 101 " not in lines[0]:
            self.close()
            raise DriverError("desktop_driver_failed", "The browser debugger connection failed.")
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                name, value = line.split(":", 1)
                headers[name.strip().lower()] = value.strip()
        expected = base64.b64encode(
            hashlib.sha1((key + WEBSOCKET_GUID).encode("ascii")).digest()
        ).decode("ascii")
        if headers.get("sec-websocket-accept") != expected:
            self.close()
            raise DriverError("desktop_driver_failed", "The browser debugger handshake failed.")
        self.next_id = 0

    def read_until(self, marker):
        while marker not in self.buffer:
            chunk = self.socket.recv(4096)
            if not chunk:
                raise DriverError("desktop_driver_failed", "The browser debugger disconnected.")
            self.buffer += chunk
        index = self.buffer.index(marker)
        value = self.buffer[:index]
        self.buffer = self.buffer[index + len(marker):]
        return value

    def read_exact(self, length):
        while len(self.buffer) < length:
            chunk = self.socket.recv(max(4096, length - len(self.buffer)))
            if not chunk:
                raise DriverError("desktop_driver_failed", "The browser debugger disconnected.")
            self.buffer += chunk
        value = self.buffer[:length]
        self.buffer = self.buffer[length:]
        return value

    def send_frame(self, opcode, payload):
        length = len(payload)
        first = bytes([0x80 | opcode])
        if length < 126:
            header = first + bytes([0x80 | length])
        elif length <= 65535:
            header = first + bytes([0x80 | 126]) + struct.pack(">H", length)
        else:
            header = first + bytes([0x80 | 127]) + struct.pack(">Q", length)
        mask = os.urandom(4)
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.socket.sendall(header + mask + masked)

    def read_frame(self):
        first, second = self.read_exact(2)
        final = bool(first & 0x80)
        opcode = first & 0x0F
        masked = bool(second & 0x80)
        length = second & 0x7F
        if length == 126:
            length = struct.unpack(">H", self.read_exact(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self.read_exact(8))[0]
        if length > MAX_CDP_MESSAGE_BYTES:
            raise DriverError("desktop_driver_failed", "The browser debugger response was too large.")
        mask = self.read_exact(4) if masked else None
        payload = self.read_exact(length)
        if mask:
            payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        return final, opcode, payload

    def read_message(self):
        fragments = bytearray()
        message_opcode = None
        while True:
            final, opcode, payload = self.read_frame()
            if opcode == 0x9:
                self.send_frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            if opcode == 0x8:
                raise DriverError("desktop_driver_failed", "The browser debugger closed the connection.")
            if opcode in (0x1, 0x2):
                if message_opcode is not None:
                    raise DriverError("desktop_driver_failed", "The browser debugger sent an invalid frame.")
                message_opcode = opcode
            elif opcode == 0x0:
                if message_opcode is None:
                    raise DriverError("desktop_driver_failed", "The browser debugger sent an invalid frame.")
            else:
                continue
            fragments.extend(payload)
            if len(fragments) > MAX_CDP_MESSAGE_BYTES:
                raise DriverError("desktop_driver_failed", "The browser debugger response was too large.")
            if final:
                if message_opcode != 0x1:
                    raise DriverError("desktop_driver_failed", "The browser debugger sent a non-text response.")
                try:
                    return json.loads(fragments.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    raise DriverError("desktop_driver_failed", "The browser debugger returned invalid JSON.")

    def call(self, method, params=None):
        self.next_id += 1
        request_id = self.next_id
        payload = {"id": request_id, "method": method, "params": params or {}}
        self.send_frame(0x1, json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        while True:
            response = self.read_message()
            if not isinstance(response, dict) or response.get("id") != request_id:
                continue
            if "error" in response:
                raise DriverError("desktop_driver_failed", "The browser command failed.")
            return response.get("result") or {}

    def close(self):
        try:
            self.socket.close()
        except OSError:
            pass

    def __enter__(self):
        return self

    def __exit__(self, _error_type, _error, _traceback):
        self.close()


def page_targets():
    targets = browser_json("/json", timeout=2)
    if not isinstance(targets, list):
        raise DriverError("desktop_unsupported", "The Chromium browser is unavailable.", ["chromium"])
    pages = [
        target for target in targets
        if isinstance(target, dict)
        and target.get("type") == "page"
        and isinstance(target.get("webSocketDebuggerUrl"), str)
    ]
    return pages


def active_page_target():
    pages = page_targets()
    if not pages:
        raise DriverError("desktop_unsupported", "The Chromium browser has no active page.", ["chromium"])
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
        with target_connection() as connection:
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
        inspect = (
            "const tag = element.tagName.toLowerCase(); "
            "const type = String(element.getAttribute('type') || (tag === 'button' ? element.type : '') || '').trim().toLowerCase(); "
            "const accessibleName = element.getAttribute('aria-label') "
            "|| [...(element.labels || [])].map(label => label.innerText || '').join(' ').trim() "
            "|| element.innerText || element.textContent || element.getAttribute('value') || element.value || ''; "
            "return { role: element.getAttribute('role') || tag, tag, type, "
            "name: String(accessibleName).trim(), "
            "isSubmit: (tag === 'button' || tag === 'input') && type === 'submit' && Boolean(element.closest('form')) };"
        )
        expression = browser_ref_expression(request.get("ref"), inspect)
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
        with target_connection(pages[index]) as connection:
            connection.call("Page.bringToFront")
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
        return {"success": True, "targetId": target_id}
    raise DriverError("invalid_input", "Unsupported browser action.")


`
