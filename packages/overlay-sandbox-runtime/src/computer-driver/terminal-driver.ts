export const COMPUTER_TERMINAL_DRIVER_SOURCE = String.raw`
import secrets
import select
import signal
import termios

TERMINAL_ROOT = "/tmp/overlay-computer/terminals"
TERMINAL_LOCK_PATH = "/tmp/overlay-computer/terminals.lock"
TERMINAL_ID_PATTERN = re.compile(r"^t-[0-9a-f]{12}$")
TERMINAL_LIMIT = 8
TERMINAL_DEFAULT_READ_BYTES = 32 * 1024
TERMINAL_MAX_READ_BYTES = 64 * 1024
TERMINAL_CANCEL_WAIT_SECONDS = 1
TERMINAL_PTY_DEFAULT_COLS = 120
TERMINAL_PTY_DEFAULT_ROWS = 32
TERMINAL_WRITE_MAX_BYTES = 16 * 1024
TERMINAL_SCREEN_MAX_BYTES = 512 * 1024
TERMINAL_HOST_START_SECONDS = 3


@contextlib.contextmanager
def terminal_start_lock():
    os.makedirs(os.path.dirname(TERMINAL_LOCK_PATH), exist_ok=True)
    handle = open(TERMINAL_LOCK_PATH, "a", encoding="utf-8")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


def terminal_directory(session_id):
    if not isinstance(session_id, str) or not TERMINAL_ID_PATTERN.fullmatch(session_id):
        raise DriverError("invalid_input", "The terminal session id is invalid.")
    return os.path.join(TERMINAL_ROOT, session_id)


def terminal_write_text(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(value)


def terminal_write_exit(directory, exit_code):
    temporary_path = os.path.join(directory, "exit.tmp")
    terminal_write_text(temporary_path, str(exit_code) + "\n")
    os.replace(temporary_path, os.path.join(directory, "exit"))


def terminal_pty_size(directory):
    try:
        with open(os.path.join(directory, "pty"), "r", encoding="utf-8") as handle:
            cols, rows = (int(value) for value in handle.read().split())
        return cols, rows
    except (OSError, ValueError):
        return None


def terminal_load_session(session_id):
    directory = terminal_directory(session_id)
    try:
        with open(os.path.join(directory, "pid"), "r", encoding="utf-8") as handle:
            pid = int(handle.read().strip())
    except (OSError, ValueError):
        raise DriverError("terminal_not_found", "The terminal session was not found.")
    return directory, pid


def terminal_exit_code(directory):
    try:
        with open(os.path.join(directory, "exit"), "r", encoding="utf-8") as handle:
            return int(handle.read().strip())
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        raise DriverError("terminal_driver_failed", "The terminal session exit status is invalid.")


def terminal_group_running(pid):
    try:
        os.killpg(pid, 0)
        return True
    except OSError as error:
        if error.errno == errno.ESRCH:
            return False
        if error.errno == errno.EPERM:
            return True
        raise


def terminal_running(directory, pid):
    if terminal_exit_code(directory) is not None:
        return False
    return terminal_group_running(pid)


def terminal_running_count():
    if not os.path.isdir(TERMINAL_ROOT):
        return 0
    running = 0
    for session_id in os.listdir(TERMINAL_ROOT):
        if not TERMINAL_ID_PATTERN.fullmatch(session_id):
            continue
        try:
            directory, pid = terminal_load_session(session_id)
            if terminal_running(directory, pid):
                running += 1
        except DriverError:
            continue
    return running


def terminal_start(request):
    command = request.get("terminalCommand")
    cwd = request.get("cwd")
    if not isinstance(command, str) or not command.strip() or len(command) > 100000 or "\x00" in command:
        raise DriverError("invalid_input", "command must contain between 1 and 100000 characters.")
    if cwd is not None and (
        not isinstance(cwd, str) or not cwd or len(cwd) > 4096 or "\x00" in cwd
    ):
        raise DriverError("invalid_input", "cwd must be a valid path.")

    pty_mode = request.get("pty") is True
    cols = required_integer(request.get("cols", TERMINAL_PTY_DEFAULT_COLS), "cols", 20, 400)
    rows = required_integer(request.get("rows", TERMINAL_PTY_DEFAULT_ROWS), "rows", 5, 200)
    if pty_mode and cwd is not None and not os.path.isdir(cwd):
        raise DriverError("invalid_input", "cwd must be an existing directory.")

    setsid = shutil.which("setsid")
    shell = shutil.which("sh")
    if not setsid or not shell:
        missing = [name for name, path in (("setsid", setsid), ("sh", shell)) if not path]
        raise DriverError("terminal_unsupported", "Terminal sessions require setsid and sh.", missing)

    os.makedirs(TERMINAL_ROOT, mode=0o700, exist_ok=True)
    with terminal_start_lock():
        if terminal_running_count() >= TERMINAL_LIMIT:
            raise DriverError("terminal_limit", "The computer already has 8 running terminal sessions.")

        session_id = "t-" + secrets.token_hex(6)
        directory = terminal_directory(session_id)
        os.makedirs(directory, mode=0o700)
        started_at = time.time()
        terminal_write_text(os.path.join(directory, "started_at"), repr(started_at))
        terminal_write_text(os.path.join(directory, "command"), command)

        if pty_mode:
            return terminal_start_pty(session_id, directory, cwd, cols, rows)

        wrapper = 'sh -c "$1"; status=$?; printf "%s\\n" "$status" > "$2/exit.tmp" && mv "$2/exit.tmp" "$2/exit"'
        output_path = os.path.join(directory, "out.log")
        try:
            with open(output_path, "ab") as output:
                process = subprocess.Popen(
                    [setsid, shell, "-c", wrapper, "overlay-terminal", command, directory],
                    cwd=cwd,
                    stdin=subprocess.DEVNULL,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    env=dict(os.environ),
                    close_fds=True,
                )
        except (OSError, ValueError):
            shutil.rmtree(directory, ignore_errors=True)
            raise DriverError("terminal_start_failed", "The terminal command could not be started.")
        terminal_write_text(os.path.join(directory, "pid"), str(process.pid))
    return {"id": session_id, "pid": process.pid}


def terminal_start_pty(session_id, directory, cwd, cols, rows):
    terminal_write_text(os.path.join(directory, "pty"), "%d %d\n" % (cols, rows))
    os.mkfifo(os.path.join(directory, "in.fifo"), 0o600)
    open(os.path.join(directory, "out.log"), "ab").close()
    host_request = json.dumps({"command": "terminal_pty_host", "id": session_id, "cwd": cwd})
    try:
        host = subprocess.Popen(
            [sys.executable, os.path.abspath(__file__), host_request],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=dict(os.environ),
            close_fds=True,
            start_new_session=True,
        )
    except (OSError, ValueError):
        shutil.rmtree(directory, ignore_errors=True)
        raise DriverError("terminal_start_failed", "The terminal command could not be started.")
    deadline = time.monotonic() + TERMINAL_HOST_START_SECONDS
    while time.monotonic() < deadline:
        if os.path.exists(os.path.join(directory, "pid")):
            directory, pid = terminal_load_session(session_id)
            return {"id": session_id, "pid": pid, "pty": True, "cols": cols, "rows": rows}
        if host.poll() is not None:
            break
        time.sleep(0.02)
    with contextlib.suppress(OSError):
        host.kill()
    shutil.rmtree(directory, ignore_errors=True)
    raise DriverError("terminal_start_failed", "The terminal command could not be started.")


def terminal_pty_host(request):
    """Owns one pseudo-terminal: copies its output to out.log and in.fifo input into it until the command exits."""
    directory = terminal_directory(request.get("id"))
    if os.path.exists(os.path.join(directory, "pid")):
        raise DriverError("invalid_input", "The terminal session already has a process.")
    with open(os.path.join(directory, "command"), "r", encoding="utf-8") as handle:
        command = handle.read()
    cols, rows = terminal_pty_size(directory) or (TERMINAL_PTY_DEFAULT_COLS, TERMINAL_PTY_DEFAULT_ROWS)
    cwd = request.get("cwd")
    shell = shutil.which("sh") or "/bin/sh"
    environment = dict(os.environ)
    environment.update({"TERM": "xterm-256color", "COLUMNS": str(cols), "LINES": str(rows)})

    master, slave = os.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    pid = os.fork()
    if pid == 0:
        try:
            os.setsid()
            os.close(master)
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
            for target in (0, 1, 2):
                os.dup2(slave, target)
            if slave > 2:
                os.close(slave)
            if cwd:
                os.chdir(cwd)
            os.execvpe(shell, [shell, "-c", command], environment)
        except BaseException:
            os._exit(127)
    os.close(slave)
    temporary_pid = os.path.join(directory, "pid.tmp")
    terminal_write_text(temporary_pid, str(pid))
    os.replace(temporary_pid, os.path.join(directory, "pid"))

    os.set_blocking(master, False)
    fifo = os.open(os.path.join(directory, "in.fifo"), os.O_RDWR | os.O_NONBLOCK)
    output = open(os.path.join(directory, "out.log"), "ab", buffering=0)
    pending = b""
    status = None
    drain_until = None
    try:
        while True:
            writers = [master] if pending else []
            try:
                readable, writable, _ = select.select([master, fifo], writers, [], 0.2)
            except InterruptedError:
                continue
            if master in readable:
                try:
                    data = os.read(master, 65536)
                except BlockingIOError:
                    data = None
                except OSError:
                    data = b""
                if data == b"":
                    break
                if data:
                    output.write(data)
            if fifo in readable:
                with contextlib.suppress(BlockingIOError):
                    pending += os.read(fifo, 65536)
            if pending and master in writable:
                try:
                    pending = pending[os.write(master, pending):]
                except BlockingIOError:
                    pass
                except OSError:
                    pending = b""
            if status is None:
                finished, raw = os.waitpid(pid, os.WNOHANG)
                if finished:
                    status = raw
                    drain_until = time.monotonic() + 0.3
            elif not readable and time.monotonic() > drain_until:
                break
    finally:
        if status is None:
            _, status = os.waitpid(pid, 0)
        code = os.waitstatus_to_exitcode(status)
        if code < 0:
            code = 128 - code
        if terminal_exit_code(directory) is None:
            terminal_write_exit(directory, code)
        output.close()
        os.close(fifo)
        os.close(master)
    return {"id": request.get("id"), "exitCode": code}


def terminal_write(request):
    directory, pid = terminal_load_session(request.get("id"))
    data = request.get("data")
    if not isinstance(data, str) or not data:
        raise DriverError("invalid_input", "data must be a non-empty string.")
    payload = data.encode("utf-8")
    if len(payload) > TERMINAL_WRITE_MAX_BYTES:
        raise DriverError("invalid_input", "data must be at most 16384 bytes.")
    fifo_path = os.path.join(directory, "in.fifo")
    if not os.path.exists(fifo_path):
        raise DriverError("terminal_no_input", "This session was not started with pty: true, so it does not accept input.")
    if not terminal_running(directory, pid):
        raise DriverError("terminal_not_running", "The terminal session has exited.")
    try:
        descriptor = os.open(fifo_path, os.O_WRONLY | os.O_NONBLOCK)
    except OSError:
        raise DriverError("terminal_not_running", "The terminal session is not accepting input.")
    written = 0
    deadline = time.monotonic() + 2
    try:
        while written < len(payload) and time.monotonic() < deadline:
            try:
                written += os.write(descriptor, payload[written:])
            except BlockingIOError:
                time.sleep(0.01)
    finally:
        os.close(descriptor)
    return {"id": request.get("id"), "bytes": written, "complete": written == len(payload)}


def terminal_read(request):
    directory, pid = terminal_load_session(request.get("id"))
    cursor_path = os.path.join(directory, "cursor")
    if request.get("offset") is None:
        # Without an explicit offset, return only output the agent has not read yet.
        try:
            with open(cursor_path, "r", encoding="utf-8") as handle:
                offset = int(handle.read().strip() or 0)
        except (OSError, ValueError):
            offset = 0
    else:
        offset = required_integer(request.get("offset"), "offset", 0, 2**63 - 1)
    requested_max_bytes = required_integer(
        request.get("maxBytes", TERMINAL_DEFAULT_READ_BYTES),
        "maxBytes",
        1,
        2**31 - 1,
    )
    max_bytes = min(requested_max_bytes, TERMINAL_MAX_READ_BYTES)
    try:
        with open(os.path.join(directory, "out.log"), "rb") as output:
            size = os.fstat(output.fileno()).st_size
            start = min(offset, size)
            output.seek(start)
            content = output.read(max_bytes)
    except OSError:
        raise DriverError("terminal_not_found", "The terminal session output was not found.")
    next_offset = start + len(content)
    if request.get("peek") is not True:
        temporary_cursor = cursor_path + ".tmp"
        terminal_write_text(temporary_cursor, str(next_offset))
        os.replace(temporary_cursor, cursor_path)
    result = {
        "output": content.decode("utf-8", errors="replace"),
        "offset": start,
        "nextOffset": next_offset,
        "size": size,
        "running": terminal_running(directory, pid),
        "exitCode": terminal_exit_code(directory),
        "truncated": next_offset < size,
    }
    pty_size = terminal_pty_size(directory)
    if pty_size:
        result["pty"] = True
        result["cols"], result["rows"] = pty_size
        screen_bytes = request.get("screenBytes")
        if screen_bytes is not None:
            screen_bytes = min(required_integer(screen_bytes, "screenBytes", 1, 2**31 - 1), TERMINAL_SCREEN_MAX_BYTES)
            tail_start = max(0, next_offset - screen_bytes)
            with open(os.path.join(directory, "out.log"), "rb") as output:
                output.seek(tail_start)
                result["tail"] = output.read(next_offset - tail_start).decode("utf-8", errors="replace")
            result["tailStart"] = tail_start
    return result


def terminal_cancel(request):
    directory, pid = terminal_load_session(request.get("id"))
    requested_signal = request.get("signal", "INT")
    signal_numbers = {"INT": signal.SIGINT, "TERM": signal.SIGTERM, "KILL": signal.SIGKILL}
    if requested_signal not in signal_numbers:
        raise DriverError("invalid_input", "signal must be INT, TERM, or KILL.")

    escalation = ["INT", "TERM", "KILL"]
    escalation = escalation[escalation.index(requested_signal):]
    last_signal = requested_signal
    for signal_name in escalation:
        if not terminal_group_running(pid):
            break
        last_signal = signal_name
        try:
            os.killpg(pid, signal_numbers[signal_name])
        except ProcessLookupError:
            break
        deadline = time.monotonic() + TERMINAL_CANCEL_WAIT_SECONDS
        while time.monotonic() < deadline and terminal_group_running(pid):
            time.sleep(0.025)

    running = terminal_group_running(pid)
    exit_code = terminal_exit_code(directory)
    if not running and exit_code is None:
        terminal_write_exit(directory, 128 + signal_numbers[last_signal])
        exit_code = terminal_exit_code(directory)
    return {"id": request.get("id"), "running": running, "exitCode": exit_code}


def terminal_list():
    sessions = []
    if not os.path.isdir(TERMINAL_ROOT):
        return {"sessions": []}
    for session_id in os.listdir(TERMINAL_ROOT):
        if not TERMINAL_ID_PATTERN.fullmatch(session_id):
            continue
        try:
            directory, pid = terminal_load_session(session_id)
            with open(os.path.join(directory, "command"), "r", encoding="utf-8") as handle:
                command = handle.read()
            with open(os.path.join(directory, "started_at"), "r", encoding="utf-8") as handle:
                started_at = float(handle.read().strip())
            sessions.append({
                "id": session_id,
                "command": command[:500] + ("..." if len(command) > 500 else ""),
                "running": terminal_running(directory, pid),
                "exitCode": terminal_exit_code(directory),
                "pty": terminal_pty_size(directory) is not None,
                "started_at": started_at,
            })
        except (DriverError, OSError, ValueError):
            continue
    sessions.sort(key=lambda session: session["started_at"], reverse=True)
    return {"sessions": sessions[:20]}
`
