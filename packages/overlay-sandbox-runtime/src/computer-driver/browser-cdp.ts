export const COMPUTER_BROWSER_CDP_SOURCE = String.raw`
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
`
