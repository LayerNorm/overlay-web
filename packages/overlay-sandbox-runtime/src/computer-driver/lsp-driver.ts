/**
 * Language-server support for the computer driver. One long-lived daemon per (language, project root) keeps
 * typescript-language-server or pyright warm; each driver call talks to it over a unix socket, so diagnostics after
 * an edit cost one round trip instead of a cold project load. Daemons exit after LSP_IDLE_SECONDS without requests.
 */
export const COMPUTER_LSP_DRIVER_SOURCE = String.raw`
import threading

LSP_ROOT = "/tmp/overlay-computer/lsp"
LSP_DEFAULT_IDLE_SECONDS = 600
LSP_MAX_DIAGNOSTICS = 100
LSP_MAX_LOCATIONS = 200
LSP_SETTLE_SECONDS = 0.4
LSP_LANGUAGES = {
    "typescript": {
        "extensions": (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"),
        "markers": ("tsconfig.json", "jsconfig.json", "package.json"),
        "command": ("typescript-language-server", "--stdio"),
        "package": "typescript-language-server",
    },
    "python": {
        "extensions": (".py", ".pyi"),
        "markers": ("pyrightconfig.json", "pyproject.toml", "setup.py", "setup.cfg"),
        "command": ("pyright-langserver", "--stdio"),
        "package": "pyright",
    },
}
LSP_TOOLS_DIR = os.path.expanduser("~/.overlay-tools/lsp")
LSP_INSTALL_TIMEOUT_SECONDS = 25
LSP_OPS = ("diagnostics", "definition", "references", "hover", "symbols")
LSP_SEVERITIES = {1: "error", 2: "warning", 3: "info", 4: "hint"}
LSP_SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2, "hint": 3}
LSP_SYMBOL_KINDS = {
    1: "file", 2: "module", 3: "namespace", 4: "package", 5: "class", 6: "method", 7: "property", 8: "field",
    9: "constructor", 10: "enum", 11: "interface", 12: "function", 13: "variable", 14: "constant", 15: "string",
    16: "number", 17: "boolean", 18: "array", 19: "object", 20: "key", 21: "null", 22: "enum_member", 23: "struct",
    24: "event", 25: "operator", 26: "type_parameter",
}


def lsp_idle_seconds():
    try:
        return max(5, int(os.environ.get("OVERLAY_LSP_IDLE_SECONDS", LSP_DEFAULT_IDLE_SECONDS)))
    except ValueError:
        return LSP_DEFAULT_IDLE_SECONDS


def lsp_language_for(path):
    lower = path.lower()
    for name, spec in LSP_LANGUAGES.items():
        if lower.endswith(spec["extensions"]):
            return name
    return None


def lsp_language_id(path):
    lower = path.lower()
    if lower.endswith((".py", ".pyi")):
        return "python"
    if lower.endswith(".tsx"):
        return "typescriptreact"
    if lower.endswith(".jsx"):
        return "javascriptreact"
    if lower.endswith((".js", ".mjs", ".cjs")):
        return "javascript"
    return "typescript"


def lsp_root_for(language, path):
    """The git root when there is one (one warm server per repo), else the nearest project marker, else the folder."""
    directory = os.path.dirname(os.path.abspath(path))
    marker_root = None
    current = directory
    while True:
        if os.path.exists(os.path.join(current, ".git")):
            return current
        if marker_root is None and any(
            os.path.exists(os.path.join(current, marker)) for marker in LSP_LANGUAGES[language]["markers"]
        ):
            marker_root = current
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return marker_root or directory


def lsp_which(name):
    """Global npm installs often live outside the driver's PATH (nvm, ~/.npm-global), so look there too."""
    found = shutil.which(name)
    if found:
        return found
    home = os.path.expanduser("~")
    candidates = [os.path.join(LSP_TOOLS_DIR, "node_modules", ".bin"), os.path.join(home, ".npm-global", "bin"), os.path.join(home, ".local", "bin"), "/usr/local/bin"]
    versions = os.path.join(home, ".nvm", "versions", "node")
    if os.path.isdir(versions):
        candidates.extend(os.path.join(versions, version, "bin") for version in sorted(os.listdir(versions), reverse=True))
    for directory in candidates:
        path = os.path.join(directory, name)
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def lsp_tsserver_lib(root, binary):
    """A TypeScript 5 tsserver: the project's own, then the driver-managed copy, then one next to the server binary.
    TypeScript 7 (the native port) ships no tsserver.js, so a global tsc alone is not enough."""
    current = root
    while True:
        candidate = os.path.join(current, "node_modules", "typescript", "lib")
        if os.path.isfile(os.path.join(candidate, "tsserver.js")):
            return candidate, True
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    candidates = [os.path.join(LSP_TOOLS_DIR, "node_modules", "typescript", "lib")]
    if binary:
        real = os.path.realpath(binary)
        candidates.append(os.path.join(os.path.dirname(real), "..", "..", "typescript", "lib"))
        candidates.append(os.path.join(os.path.dirname(binary), "..", "lib", "node_modules", "typescript", "lib"))
    for candidate in candidates:
        candidate = os.path.normpath(candidate)
        if os.path.isfile(os.path.join(candidate, "tsserver.js")):
            return candidate, False
    return None, False


def lsp_install(packages):
    """Installs language-server packages into the driver's own folder, so no global or project state changes."""
    npm = lsp_which("npm")
    if not npm:
        return False
    os.makedirs(LSP_TOOLS_DIR, exist_ok=True)
    environment = dict(os.environ)
    environment["PATH"] = os.path.dirname(npm) + os.pathsep + environment.get("PATH", "")
    try:
        result = subprocess.run(
            [npm, "install", "--prefix", LSP_TOOLS_DIR, "--no-audit", "--no-fund", "--loglevel=error"] + list(packages),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=environment,
            timeout=LSP_INSTALL_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def lsp_ensure_tools(language, root):
    spec = LSP_LANGUAGES[language]
    needed = []
    binary = lsp_which(spec["command"][0])
    if not binary:
        needed.append(spec["package"])
    if language == "typescript" and lsp_tsserver_lib(root, binary)[0] is None:
        needed.append("typescript@5")
    if needed and not lsp_install(needed):
        missing = [name.split("@")[0] for name in needed]
        raise DriverError(
            "lsp_unsupported",
            "The language server needs " + ", ".join(missing) + " and it could not be installed automatically.",
            missing,
        )


def lsp_uri(path):
    return "file://" + urllib.parse.quote(os.path.abspath(path))


def lsp_path_from_uri(uri):
    return urllib.parse.unquote(urllib.parse.urlparse(uri).path)


def lsp_socket_path(language, root):
    key = hashlib.sha1((language + "\0" + root).encode("utf-8")).hexdigest()[:16]
    return os.path.join(LSP_ROOT, key + ".sock")


def lsp_read_line(connection):
    chunks = []
    total = 0
    while True:
        chunk = connection.recv(65536)
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if chunk.endswith(b"\n") or total > 16_000_000:
            break
    return b"".join(chunks)


def lsp_send_line(connection, payload):
    connection.sendall(json.dumps(payload, separators=(",", ":")).encode("utf-8") + b"\n")


def lsp_call(socket_path, payload, timeout):
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(timeout)
    try:
        client.connect(socket_path)
        lsp_send_line(client, payload)
        raw = lsp_read_line(client)
    finally:
        client.close()
    if not raw.strip():
        raise ConnectionResetError("empty language server response")
    return json.loads(raw.decode("utf-8"))


def lsp_simplify_diagnostic(item):
    start = ((item.get("range") or {}).get("start") or {})
    result = {
        "line": int(start.get("line", 0)) + 1,
        "column": int(start.get("character", 0)) + 1,
        "severity": LSP_SEVERITIES.get(item.get("severity"), "error"),
        "message": str(item.get("message", ""))[:500],
    }
    code = item.get("code")
    if isinstance(code, (str, int)) and not isinstance(code, bool):
        result["code"] = code
    source = item.get("source")
    if isinstance(source, str) and source:
        result["source"] = source
    return result


def lsp_line_text(path, line, cache):
    if path not in cache:
        lines = None
        if len(cache) < 50:
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as handle:
                    lines = handle.read().split("\n")
            except OSError:
                lines = None
        cache[path] = lines
    lines = cache[path]
    if not lines or line < 0 or line >= len(lines):
        return ""
    return lines[line].strip()[:200]


def lsp_locations(result):
    if result is None:
        return [], 0
    items = result if isinstance(result, list) else [result]
    cache = {}
    locations = []
    for item in items[:LSP_MAX_LOCATIONS]:
        if not isinstance(item, dict):
            continue
        uri = item.get("targetUri") or item.get("uri")
        span = item.get("targetSelectionRange") or item.get("range") or {}
        if not isinstance(uri, str):
            continue
        path = lsp_path_from_uri(uri)
        start = span.get("start") or {}
        line = int(start.get("line", 0))
        locations.append({
            "path": path,
            "line": line + 1,
            "column": int(start.get("character", 0)) + 1,
            "preview": lsp_line_text(path, line, cache),
        })
    return locations, len(items)


def lsp_hover_text(result):
    if not isinstance(result, dict):
        return ""
    contents = result.get("contents")
    parts = contents if isinstance(contents, list) else [contents]
    texts = []
    for part in parts:
        if isinstance(part, str):
            texts.append(part)
        elif isinstance(part, dict) and isinstance(part.get("value"), str):
            texts.append(part["value"])
    return "\n\n".join(text for text in texts if text)[:4000]


def lsp_symbols(result, limit=500):
    symbols = []

    def visit(items, depth):
        for item in items or []:
            if len(symbols) >= limit or not isinstance(item, dict):
                return
            span = item.get("selectionRange") or item.get("range") or (item.get("location") or {}).get("range") or {}
            start = span.get("start") or {}
            entry = {
                "name": str(item.get("name", ""))[:200],
                "kind": LSP_SYMBOL_KINDS.get(item.get("kind"), "symbol"),
                "line": int(start.get("line", 0)) + 1,
                "column": int(start.get("character", 0)) + 1,
                "depth": depth,
            }
            container = item.get("containerName")
            if isinstance(container, str) and container:
                entry["container"] = container
            symbols.append(entry)
            visit(item.get("children"), depth + 1)

    visit(result if isinstance(result, list) else [], 0)
    return symbols


class LspServer:
    def __init__(self, language, root):
        spec = LSP_LANGUAGES[language]
        binary = lsp_which(spec["command"][0])
        if not binary:
            raise DriverError("lsp_unsupported", spec["command"][0] + " is not installed.", [spec["package"]])
        environment = dict(os.environ)
        environment["PATH"] = os.path.dirname(binary) + os.pathsep + environment.get("PATH", "")
        self.root = root
        self.language = language
        self.binary = binary
        self.process = subprocess.Popen(
            [binary] + list(spec["command"][1:]),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=root,
            env=environment,
        )
        self.write_lock = threading.Lock()
        self.condition = threading.Condition()
        self.next_id = 0
        self.responses = {}
        self.diagnostics = {}
        self.publish_counts = {}
        self.last_publish = 0.0
        self.documents = {}
        self.alive = True
        threading.Thread(target=self.read_loop, daemon=True).start()

    def send(self, message):
        body = json.dumps(message, separators=(",", ":")).encode("utf-8")
        with self.write_lock:
            self.process.stdin.write(("Content-Length: %d\r\n\r\n" % len(body)).encode("ascii") + body)
            self.process.stdin.flush()

    def read_loop(self):
        stream = self.process.stdout
        try:
            while True:
                length = None
                while True:
                    line = stream.readline()
                    if not line:
                        raise EOFError()
                    line = line.strip()
                    if not line:
                        break
                    name, _, value = line.partition(b":")
                    if name.strip().lower() == b"content-length":
                        length = int(value.strip())
                if length is None:
                    continue
                self.handle(json.loads(stream.read(length).decode("utf-8")))
        except Exception:
            pass
        with self.condition:
            self.alive = False
            self.condition.notify_all()

    def handle(self, message):
        if not isinstance(message, dict):
            return
        method = message.get("method")
        if "id" in message and method:
            params = message.get("params") or {}
            if method == "workspace/configuration":
                result = [None for _ in params.get("items", [])]
            elif method == "workspace/workspaceFolders":
                result = [{"uri": lsp_uri(self.root), "name": os.path.basename(self.root) or self.root}]
            else:
                result = None
            with contextlib.suppress(OSError, ValueError):
                self.send({"jsonrpc": "2.0", "id": message["id"], "result": result})
            return
        if "id" in message:
            with self.condition:
                self.responses[message["id"]] = message
                self.condition.notify_all()
            return
        if method == "textDocument/publishDiagnostics":
            params = message.get("params") or {}
            uri = params.get("uri")
            if isinstance(uri, str):
                with self.condition:
                    self.diagnostics[uri] = params.get("diagnostics") or []
                    self.publish_counts[uri] = self.publish_counts.get(uri, 0) + 1
                    self.last_publish = time.time()
                    self.condition.notify_all()

    def request(self, method, params, timeout):
        with self.condition:
            self.next_id += 1
            request_id = self.next_id
        self.send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        deadline = time.time() + timeout
        with self.condition:
            while request_id not in self.responses:
                remaining = deadline - time.time()
                if not self.alive:
                    raise DriverError("lsp_failed", "The language server stopped.")
                if remaining <= 0:
                    raise DriverError(
                        "lsp_timeout",
                        "The language server did not answer in time. It may still be loading the project; try again shortly.",
                    )
                self.condition.wait(remaining)
            response = self.responses.pop(request_id)
        if isinstance(response.get("error"), dict):
            raise DriverError("lsp_failed", str(response["error"].get("message", "The language server request failed."))[:300])
        return response.get("result")

    def notify(self, method, params):
        self.send({"jsonrpc": "2.0", "method": method, "params": params})

    def initialize(self, timeout):
        folder = {"uri": lsp_uri(self.root), "name": os.path.basename(self.root) or self.root}
        self.request("initialize", {
            "processId": os.getpid(),
            "rootUri": folder["uri"],
            "rootPath": self.root,
            "workspaceFolders": [folder],
            "capabilities": {
                "textDocument": {
                    "synchronization": {"didSave": True, "dynamicRegistration": False},
                    "publishDiagnostics": {"relatedInformation": False},
                    "hover": {"contentFormat": ["plaintext", "markdown"]},
                    "definition": {"linkSupport": False},
                    "references": {},
                    "documentSymbol": {"hierarchicalDocumentSymbolSupport": True},
                },
                "workspace": {"configuration": True, "workspaceFolders": True},
            },
            "initializationOptions": self.initialization_options(),
        }, timeout)
        self.notify("initialized", {})

    def initialization_options(self):
        if self.language != "typescript":
            return {}
        library, own = lsp_tsserver_lib(self.root, self.binary)
        if library is None or own:
            return {}
        return {"tsserver": {"path": library}}

    def sync(self, path):
        """Opens or refreshes a document from disk. Returns (uri, publish count to wait past, or None if current)."""
        uri = lsp_uri(path)
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        with self.condition:
            before = self.publish_counts.get(uri, 0)
            known = uri in self.diagnostics
        current = self.documents.get(uri)
        if current is None:
            self.documents[uri] = (1, text)
            self.notify("textDocument/didOpen", {
                "textDocument": {"uri": uri, "languageId": lsp_language_id(path), "version": 1, "text": text},
            })
            return uri, before
        if current[1] == text:
            return uri, (None if known else before)
        version = current[0] + 1
        self.documents[uri] = (version, text)
        self.notify("textDocument/didChange", {
            "textDocument": {"uri": uri, "version": version},
            "contentChanges": [{"text": text}],
        })
        self.notify("textDocument/didSave", {"textDocument": {"uri": uri}})
        return uri, before

    def wait_diagnostics(self, waits, timeout):
        """Waits for a fresh publish for every synced file, then for the server to go quiet briefly."""
        deadline = time.time() + timeout
        with self.condition:
            while True:
                pending = [uri for uri, before in waits if before is not None and self.publish_counts.get(uri, 0) <= before]
                remaining = deadline - time.time()
                if not pending or not self.alive or remaining <= 0:
                    break
                self.condition.wait(remaining)
            if pending:
                return pending
            while self.alive:
                quiet = time.time() - self.last_publish
                remaining = deadline - time.time()
                if quiet >= LSP_SETTLE_SECONDS or remaining <= 0:
                    break
                self.condition.wait(min(remaining, LSP_SETTLE_SECONDS - quiet))
        return []

    def stop(self):
        with contextlib.suppress(Exception):
            self.request("shutdown", None, 2)
            self.notify("exit", None)
        with contextlib.suppress(Exception):
            self.process.terminate()
            self.process.wait(timeout=2)
        with contextlib.suppress(Exception):
            self.process.kill()


def lsp_position(payload):
    line = payload.get("line")
    column = payload.get("column")
    if not isinstance(line, int) or isinstance(line, bool) or line < 1 or not isinstance(column, int) or isinstance(column, bool) or column < 1:
        raise DriverError("invalid_input", "line and column (1-based) are required for this action.")
    return {"line": line - 1, "character": column - 1}


def lsp_handle(server, payload):
    op = payload.get("op")
    path = payload.get("path")
    timeout = float(payload.get("timeout") or 15)
    if op == "diagnostics":
        paths = [path] + [extra for extra in payload.get("paths") or [] if extra != path]
        present = [candidate for candidate in paths if os.path.isfile(candidate)]
        waits = [server.sync(candidate) for candidate in present]
        pending = set(server.wait_diagnostics(waits, timeout))
        files = []
        for candidate in present:
            uri = lsp_uri(candidate)
            with server.condition:
                raw = [item for item in server.diagnostics.get(uri, []) if isinstance(item, dict)]
            simplified = sorted(
                (lsp_simplify_diagnostic(item) for item in raw),
                key=lambda item: (LSP_SEVERITY_ORDER.get(item["severity"], 4), item["line"], item["column"]),
            )
            entry = {"path": candidate, "diagnostics": simplified[:LSP_MAX_DIAGNOSTICS], "total": len(simplified)}
            if uri in pending:
                entry["pending"] = True
            files.append(entry)
        return {"files": files}
    uri, _ = server.sync(path)
    document = {"uri": uri}
    if op == "symbols":
        symbols = lsp_symbols(server.request("textDocument/documentSymbol", {"textDocument": document}, timeout))
        return {"symbols": symbols}
    position = lsp_position(payload)
    if op == "hover":
        result = server.request("textDocument/hover", {"textDocument": document, "position": position}, timeout)
        return {"hover": lsp_hover_text(result)}
    if op == "definition":
        result = server.request("textDocument/definition", {"textDocument": document, "position": position}, timeout)
        locations, total = lsp_locations(result)
        return {"locations": locations, "total": total}
    if op == "references":
        result = server.request("textDocument/references", {
            "textDocument": document,
            "position": position,
            "context": {"includeDeclaration": True},
        }, timeout)
        locations, total = lsp_locations(result)
        return {"locations": locations, "total": total}
    raise DriverError("invalid_input", "Unsupported language server action.")


def lsp_spawn_daemon(language, root):
    os.makedirs(LSP_ROOT, mode=0o700, exist_ok=True)
    log_path = lsp_socket_path(language, root)[:-5] + ".log"
    with open(log_path, "ab") as log:
        subprocess.Popen(
            [sys.executable, os.path.abspath(__file__), "--lsp-daemon", language, root],
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            cwd=root,
            env=dict(os.environ),
            start_new_session=True,
            close_fds=True,
        )


def lsp_request(request):
    path = request.get("path")
    op = request.get("op")
    if not isinstance(path, str) or not path.startswith("/") or len(path) > 4096 or "\x00" in path:
        raise DriverError("invalid_input", "path must be an absolute file path.")
    if op not in LSP_OPS:
        raise DriverError("invalid_input", "op must be one of: " + ", ".join(LSP_OPS) + ".")
    language = lsp_language_for(path)
    if not language:
        raise DriverError("lsp_unsupported_language", "Language servers are available for TypeScript/JavaScript and Python files.")
    if not os.path.isfile(path):
        raise DriverError("not_found", "No file at " + path + ".")
    extra = request.get("paths") or []
    if not isinstance(extra, list) or len(extra) > 20:
        raise DriverError("invalid_input", "paths must be a list of at most 20 files.")
    extra = [
        candidate for candidate in extra
        if isinstance(candidate, str) and candidate.startswith("/") and "\x00" not in candidate and lsp_language_for(candidate) == language
    ]
    timeout_ms = request.get("timeoutMs")
    timeout = 15.0
    if isinstance(timeout_ms, int) and not isinstance(timeout_ms, bool):
        timeout = min(max(timeout_ms / 1000, 1.0), 22.0)

    root = lsp_root_for(language, path)
    lsp_ensure_tools(language, root)
    socket_path = lsp_socket_path(language, root)
    payload = {"op": op, "path": path, "paths": extra, "timeout": timeout}
    for key in ("line", "column"):
        if key in request:
            payload[key] = request.get(key)
    deadline = time.time() + timeout + 5
    spawned = False
    while True:
        try:
            response = lsp_call(socket_path, payload, max(1.0, deadline - time.time()))
            break
        except socket.timeout:
            raise DriverError(
                "lsp_timeout",
                "The language server did not answer in time. It may still be loading the project; try again shortly.",
            )
        except (FileNotFoundError, ConnectionRefusedError, ConnectionResetError):
            if not spawned:
                lsp_spawn_daemon(language, root)
                spawned = True
            if time.time() > deadline:
                raise DriverError("lsp_timeout", "The language server did not start in time.")
            time.sleep(0.1)
    if isinstance(response, dict) and isinstance(response.get("error"), dict):
        error = response["error"]
        raise DriverError(str(error.get("code", "lsp_failed")), str(error.get("message", "The language server request failed.")))
    if not isinstance(response, dict):
        raise DriverError("lsp_failed", "The language server returned invalid output.")
    response["language"] = language
    response["root"] = root
    return response


def lsp_stop():
    stopped = 0
    if os.path.isdir(LSP_ROOT):
        for name in os.listdir(LSP_ROOT):
            if not name.endswith(".sock"):
                continue
            with contextlib.suppress(OSError, ValueError):
                lsp_call(os.path.join(LSP_ROOT, name), {"op": "shutdown"}, 5)
                stopped += 1
    return {"stopped": stopped}


def lsp_daemon_main(language, root):
    if language not in LSP_LANGUAGES or not os.path.isdir(root):
        return 2
    os.makedirs(LSP_ROOT, mode=0o700, exist_ok=True)
    socket_path = lsp_socket_path(language, root)
    lock_handle = open(socket_path + ".lock", "a", encoding="utf-8")
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return 0
    with contextlib.suppress(FileNotFoundError):
        os.unlink(socket_path)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(socket_path)
    os.chmod(socket_path, 0o600)
    listener.listen(16)
    listener.settimeout(5)
    server = None
    failure = None
    try:
        server = LspServer(language, root)
        server.initialize(90)
    except DriverError as error:
        failure = {"code": error.code, "message": error.message}
    except Exception:
        failure = {"code": "lsp_start_failed", "message": "The language server could not start."}
    idle = lsp_idle_seconds()
    last_activity = time.time()
    try:
        while failure is not None or server.alive:
            try:
                connection, _ = listener.accept()
            except socket.timeout:
                if time.time() - last_activity > idle:
                    break
                continue
            last_activity = time.time()
            stop = False
            with connection:
                connection.settimeout(60)
                try:
                    payload = json.loads(lsp_read_line(connection).decode("utf-8"))
                    if not isinstance(payload, dict):
                        raise DriverError("invalid_input", "The request must be a JSON object.")
                    if payload.get("op") == "shutdown":
                        response = {"stopped": True}
                        stop = True
                    elif failure is not None:
                        response = {"error": failure}
                        stop = True
                    else:
                        response = lsp_handle(server, payload)
                except DriverError as error:
                    response = {"error": {"code": error.code, "message": error.message}}
                except Exception:
                    response = {"error": {"code": "lsp_failed", "message": "The language server request failed."}}
                with contextlib.suppress(OSError):
                    lsp_send_line(connection, response)
            if stop:
                break
    finally:
        if server is not None:
            server.stop()
        with contextlib.suppress(OSError):
            listener.close()
        with contextlib.suppress(OSError):
            os.unlink(socket_path)
    return 0
`
