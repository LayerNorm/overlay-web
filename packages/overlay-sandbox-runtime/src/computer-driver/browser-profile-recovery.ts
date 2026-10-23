export const COMPUTER_BROWSER_PROFILE_RECOVERY_SOURCE = String.raw`
def profile_lock_pid(target):
    try:
        pid = int(target.rsplit("-", 1)[1])
    except (ValueError, IndexError):
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
    except FileNotFoundError:
        return False
    except OSError:
        return None
    expected_profile = os.path.normcase(os.path.abspath(BROWSER_PROFILE))
    prefix = b"--user-data-dir="
    for index, argument in enumerate(arguments):
        if argument == b"--user-data-dir" and index + 1 < len(arguments):
            profile = os.fsdecode(arguments[index + 1])
        elif argument.startswith(prefix):
            profile = os.fsdecode(argument[len(prefix):])
        else:
            continue
        if os.path.normcase(os.path.abspath(profile)) == expected_profile:
            return True
    return False


def browser_profile_may_be_in_use():
    try:
        processes = os.listdir("/proc")
    except OSError:
        return True
    for entry in processes:
        if entry.isdigit() and process_is_alive(int(entry)):
            if process_uses_browser_profile(int(entry)) is not False:
                return True
    return False


def wait_for_process_exit(pid, timeout):
    deadline = time.monotonic() + timeout
    while process_is_alive(pid) and time.monotonic() < deadline:
        time.sleep(0.1)
    return not process_is_alive(pid)


def remove_profile_singleton_files(expected_lock):
    try:
        if os.readlink(os.path.join(BROWSER_PROFILE, "SingletonLock")) != expected_lock:
            return
    except OSError:
        return
    for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
        try:
            os.unlink(os.path.join(BROWSER_PROFILE, name))
        except FileNotFoundError:
            pass


def recover_profile_lock():
    try:
        expected_lock = os.readlink(os.path.join(BROWSER_PROFILE, "SingletonLock"))
    except OSError:
        return
    pid = profile_lock_pid(expected_lock)
    if pid is None:
        return
    owner_alive = process_is_alive(pid)
    owns_profile = process_uses_browser_profile(pid) if owner_alive else False
    if not owner_alive or owns_profile is False:
        # A resumed VM can reuse the old host's PID for an unrelated process.
        if not browser_profile_may_be_in_use():
            remove_profile_singleton_files(expected_lock)
        return
    if owns_profile is not True:
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
    remove_profile_singleton_files(expected_lock)


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
