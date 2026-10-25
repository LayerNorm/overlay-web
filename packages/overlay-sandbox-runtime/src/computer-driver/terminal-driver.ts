export const COMPUTER_TERMINAL_DRIVER_SOURCE = String.raw`
import secrets
import signal

TERMINAL_ROOT = "/tmp/overlay-computer/terminals"
TERMINAL_LOCK_PATH = "/tmp/overlay-computer/terminals.lock"
TERMINAL_ID_PATTERN = re.compile(r"^t-[0-9a-f]{12}$")
TERMINAL_LIMIT = 8
TERMINAL_DEFAULT_READ_BYTES = 32 * 1024
TERMINAL_MAX_READ_BYTES = 64 * 1024
TERMINAL_CANCEL_WAIT_SECONDS = 1


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


def terminal_read(request):
    directory, pid = terminal_load_session(request.get("id"))
    offset = required_integer(request.get("offset", 0), "offset", 0, 2**63 - 1)
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
    return {
        "output": content.decode("utf-8", errors="replace"),
        "nextOffset": next_offset,
        "running": terminal_running(directory, pid),
        "exitCode": terminal_exit_code(directory),
        "truncated": next_offset < size,
    }


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
                "started_at": started_at,
            })
        except (DriverError, OSError, ValueError):
            continue
    sessions.sort(key=lambda session: session["started_at"], reverse=True)
    return {"sessions": sessions[:20]}
`
