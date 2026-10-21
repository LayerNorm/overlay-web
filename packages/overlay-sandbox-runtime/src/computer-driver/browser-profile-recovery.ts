export const COMPUTER_BROWSER_PROFILE_RECOVERY_SOURCE = String.raw`
def profile_lock_pid():
    lock_path = os.path.join(BROWSER_PROFILE, "SingletonLock")
    try:
        target = os.readlink(lock_path)
        pid = int(target.rsplit("-", 1)[1])
    except (OSError, ValueError, IndexError):
        return None
    return pid if pid > 0 else None


def process_is_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    try:
        with open("/proc/" + str(pid) + "/stat", "r", encoding="ascii") as process_stat:
            state = process_stat.read().rpartition(")")[2].strip().split()[0]
        if state == "Z":
            return False
    except (OSError, IndexError):
        pass
    return True


def process_uses_browser_profile(pid):
    try:
        with open("/proc/" + str(pid) + "/cmdline", "rb") as command_line:
            arguments = command_line.read().split(b"\0")
    except OSError:
        return False
    expected_profile = os.path.normcase(os.path.abspath(BROWSER_PROFILE))
    prefix = b"--user-data-dir="
    for argument in arguments:
        if not argument.startswith(prefix):
            continue
        profile = os.fsdecode(argument[len(prefix):])
        if os.path.normcase(os.path.abspath(profile)) == expected_profile:
            return True
    return False


def wait_for_process_exit(pid, timeout):
    deadline = time.monotonic() + timeout
    while process_is_alive(pid) and time.monotonic() < deadline:
        time.sleep(0.1)
    return not process_is_alive(pid)


def remove_profile_singleton_files():
    for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
        try:
            os.unlink(os.path.join(BROWSER_PROFILE, name))
        except FileNotFoundError:
            pass


def recover_profile_lock():
    pid = profile_lock_pid()
    if pid is None:
        return
    if not process_is_alive(pid):
        remove_profile_singleton_files()
        return
    if not process_uses_browser_profile(pid):
        return
    try:
        process_group = os.getpgid(pid)
        os.killpg(process_group, signal.SIGTERM)
    except ProcessLookupError:
        pass
    except OSError:
        return
    if not wait_for_process_exit(pid, 5):
        if not process_uses_browser_profile(pid):
            return
        try:
            process_group = os.getpgid(pid)
            os.killpg(process_group, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError:
            return
        if not wait_for_process_exit(pid, 1):
            return
    remove_profile_singleton_files()


def browser_log_excerpt():
    try:
        with open(BROWSER_LOG_PATH, "rb") as browser_log:
            browser_log.seek(0, os.SEEK_END)
            size = browser_log.tell()
            browser_log.seek(max(0, size - 1200))
            excerpt = browser_log.read().decode("utf-8", errors="replace")
    except OSError:
        excerpt = ""
    return " ".join(excerpt.split())[-300:] or "no browser output"


def browser_start_error(binary, child):
    exit_code = child.poll()
    exit_status = "running" if exit_code is None else str(exit_code)
    message = "Chromium did not start in time. (" + os.path.basename(binary)
    message += "; exit " + exit_status + "; " + browser_log_excerpt() + ")"
    return DriverError("desktop_driver_failed", message)
`
