import { COMPUTER_BROWSER_DRIVER_SOURCE } from './browser-driver'
import { COMPUTER_TERMINAL_DRIVER_SOURCE } from './terminal-driver'

export const DRIVER_VERSION = '4'

export const COMPUTER_DRIVER_SOURCE = String.raw`#!/usr/bin/env python3
import base64
import contextlib
import errno
import fcntl
import hashlib
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

VERSION = "4"
DEFAULT_MAX_WIDTH = 1280
LOCK_PATH = os.environ.get("OVERLAY_COMPUTER_INPUT_LOCK_PATH", "/tmp/overlay-computer/input.lock")
SHOT_PATH = "/tmp/overlay-computer/shot.png"
LOCK_WAIT_SECONDS = 0.5
SCREENSHOT_TOOLS = (("imagemagick", "import"), ("scrot", "scrot"), ("ffmpeg", "ffmpeg"))
BROWSER_HOST = "127.0.0.1"
BROWSER_PORT = 9222
BROWSER_BASE_URL = "http://127.0.0.1:9222"
BROWSER_START_TIMEOUT_SECONDS = 20
BROWSER_PROFILE = os.path.expanduser("~/.config/overlay-browser")
WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_CDP_MESSAGE_BYTES = 4_000_000
RISKY_CLICK_NAME = re.compile(
    r"\b(post|tweet|reply|repost|send|publish|share|buy|pay|purchase|order|checkout|delete|remove|confirm|submit|subscribe|unsubscribe|follow|unfollow|transfer)\b",
    re.IGNORECASE,
)


class DriverError(Exception):
    def __init__(self, code, message, missing=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.missing = missing or []


def display_name():
    return os.environ.get("DISPLAY") or ":0"


def command_environment():
    return dict(os.environ, DISPLAY=display_name())


def available_screenshot_tool():
    for package, executable in SCREENSHOT_TOOLS:
        path = shutil.which(executable)
        if path:
            return package, path
    return None, None


def read_display_geometry(required=False):
    xdotool = shutil.which("xdotool")
    if not xdotool:
        if required:
            raise DriverError("desktop_unsupported", "Desktop input requires xdotool.", ["xdotool"])
        return 0, 0
    try:
        result = subprocess.run(
            [xdotool, "getdisplaygeometry"],
            capture_output=True,
            text=True,
            env=command_environment(),
            timeout=5,
            check=False,
        )
        width, height = (int(value) for value in result.stdout.split())
        if result.returncode != 0 or width <= 0 or height <= 0:
            raise ValueError("invalid geometry")
        return width, height
    except (OSError, ValueError, subprocess.TimeoutExpired):
        if required:
            raise DriverError("desktop_unsupported", "The desktop display geometry is unavailable.", ["xdotool"])
        return 0, 0


def capabilities():
    xdotool = shutil.which("xdotool")
    width, height = read_display_geometry()
    screenshot_package, _ = available_screenshot_tool()
    missing = []
    if not xdotool or width <= 0 or height <= 0:
        missing.append("xdotool")
    if not screenshot_package:
        missing.append("imagemagick")
    return {
        "version": VERSION,
        "display": display_name(),
        "screen": {"width": width, "height": height},
        "input": bool(xdotool and width > 0 and height > 0),
        "screenshot": bool(screenshot_package),
        "missing": missing,
    }


def require_xdotool():
    xdotool = shutil.which("xdotool")
    if not xdotool:
        raise DriverError("desktop_unsupported", "Desktop input requires xdotool.", ["xdotool"])
    return xdotool


@contextlib.contextmanager
def input_lock():
    os.makedirs(os.path.dirname(LOCK_PATH), exist_ok=True)
    handle = open(LOCK_PATH, "a", encoding="utf-8")
    deadline = time.monotonic() + LOCK_WAIT_SECONDS
    while True:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except OSError as error:
            if error.errno not in (errno.EAGAIN, errno.EACCES):
                handle.close()
                raise
            if time.monotonic() >= deadline:
                handle.close()
                raise DriverError("desktop_busy", "Another desktop action is still running.")
            time.sleep(0.025)
    try:
        yield
    finally:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


def run_xdotool(xdotool, *arguments):
    try:
        result = subprocess.run(
            [xdotool, *[str(argument) for argument in arguments]],
            capture_output=True,
            text=True,
            env=command_environment(),
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise DriverError("desktop_driver_failed", "The desktop input command failed.")
    if result.returncode != 0:
        raise DriverError("desktop_driver_failed", "The desktop input command failed.")
    return result.stdout


def required_integer(value, name, minimum=0, maximum=100000):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
        raise DriverError("invalid_input", name + " is outside the supported range.")
    return value


def max_width_for(request):
    return required_integer(request.get("maxWidth", DEFAULT_MAX_WIDTH), "maxWidth", 1, 8192)


def scale_for(width, max_width):
    return min(1.0, max_width / width)


def map_point(x, y, width, height, max_width):
    x = required_integer(x, "x")
    y = required_integer(y, "y")
    scale = scale_for(width, max_width)
    screenshot_width = min(width, max_width)
    screenshot_height = max(1, int(round(height * scale)))
    if x >= screenshot_width or y >= screenshot_height:
        raise DriverError("invalid_input", "The point is outside the screenshot.")
    return int(round(x / scale)), int(round(y / scale))


def button_number(value, default=1):
    if value is None:
        return default
    if isinstance(value, str):
        named = {"left": 1, "middle": 2, "right": 3}
        if value.lower() in named:
            return named[value.lower()]
        raise DriverError("invalid_input", "button must be left, middle, or right.")
    return required_integer(value, "button", 1, 3)


def screenshot_dimensions(path):
    try:
        with open(path, "rb") as image:
            header = image.read(24)
        if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
            raise ValueError("not a PNG")
        return struct.unpack(">II", header[16:24])
    except (OSError, ValueError, struct.error):
        raise DriverError("desktop_driver_failed", "The screenshot could not be read.")


def capture_screenshot(max_width):
    width, height = read_display_geometry(required=True)
    package, executable = available_screenshot_tool()
    if not executable:
        raise DriverError("desktop_unsupported", "A screenshot tool is required.", ["imagemagick"])
    os.makedirs(os.path.dirname(SHOT_PATH), exist_ok=True)
    try:
        os.unlink(SHOT_PATH)
    except FileNotFoundError:
        pass

    try:
        if package == "imagemagick":
            arguments = [executable, "-window", "root"]
            if width > max_width:
                arguments.extend(["-resize", str(max_width) + "x>"])
            arguments.append(SHOT_PATH)
        elif package == "scrot":
            if width > max_width:
                root, extension = os.path.splitext(SHOT_PATH)
                thumbnail = root + "-thumb" + extension
                try:
                    os.unlink(thumbnail)
                except FileNotFoundError:
                    pass
                percentage = "{:.6f}".format(max_width * 100 / width)
                arguments = [executable, "-t", percentage, SHOT_PATH]
                result = subprocess.run(
                    arguments,
                    capture_output=True,
                    text=True,
                    env=command_environment(),
                    timeout=15,
                    check=False,
                )
                if result.returncode != 0 or not os.path.isfile(thumbnail):
                    raise DriverError("desktop_driver_failed", "The screenshot could not be captured.")
                os.replace(thumbnail, SHOT_PATH)
                arguments = None
            else:
                arguments = [executable, SHOT_PATH]
        else:
            arguments = [
                executable,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "x11grab",
                "-video_size",
                str(width) + "x" + str(height),
                "-i",
                display_name(),
                "-frames:v",
                "1",
            ]
            if width > max_width:
                arguments.extend(["-vf", "scale=" + str(max_width) + ":-1"])
            arguments.append(SHOT_PATH)

        if arguments:
            result = subprocess.run(
                arguments,
                capture_output=True,
                text=True,
                env=command_environment(),
                timeout=15,
                check=False,
            )
            if result.returncode != 0:
                raise DriverError("desktop_driver_failed", "The screenshot could not be captured.")
    except (OSError, subprocess.TimeoutExpired):
        raise DriverError("desktop_driver_failed", "The screenshot could not be captured.")

    image_width, image_height = screenshot_dimensions(SHOT_PATH)
    return {"width": image_width, "height": image_height}


def current_mouse_position(xdotool):
    output = run_xdotool(xdotool, "getmouselocation", "--shell")
    values = {}
    for line in output.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    try:
        return int(values["X"]), int(values["Y"])
    except (KeyError, ValueError):
        raise DriverError("desktop_driver_failed", "The pointer position is unavailable.")


def run_input(request):
    xdotool = require_xdotool()
    with input_lock():
        width, height = read_display_geometry(required=True)
        max_width = max_width_for(request)
        action = request.get("command")

        if action == "click":
            x, y = map_point(request.get("x"), request.get("y"), width, height, max_width)
            count = required_integer(request.get("count", 1), "count", 1, 25)
            button = button_number(request.get("button"))
            run_xdotool(xdotool, "mousemove", "--sync", x, y)
            run_xdotool(xdotool, "click", "--repeat", count, "--delay", 80, button)
        elif action == "move":
            x, y = map_point(request.get("x"), request.get("y"), width, height, max_width)
            run_xdotool(xdotool, "mousemove", "--sync", x, y)
        elif action == "drag":
            start = request.get("from")
            end = request.get("to")
            if not isinstance(start, dict) or not isinstance(end, dict):
                raise DriverError("invalid_input", "drag requires from and to points.")
            start_x, start_y = map_point(start.get("x"), start.get("y"), width, height, max_width)
            end_x, end_y = map_point(end.get("x"), end.get("y"), width, height, max_width)
            button = button_number(request.get("button"))
            run_xdotool(xdotool, "mousemove", "--sync", start_x, start_y)
            run_xdotool(xdotool, "mousedown", button)
            try:
                run_xdotool(xdotool, "mousemove", "--sync", end_x, end_y)
            finally:
                run_xdotool(xdotool, "mouseup", button)
        elif action == "type":
            text = request.get("text")
            if not isinstance(text, str) or len(text) > 10000:
                raise DriverError("invalid_input", "text must contain at most 10000 characters.")
            run_xdotool(xdotool, "type", "--clearmodifiers", "--delay", 1, "--", text)
        elif action == "key":
            keys = request.get("keys")
            if not isinstance(keys, str) or not keys.strip() or len(keys) > 100:
                raise DriverError("invalid_input", "keys must be a non-empty xdotool key sequence.")
            run_xdotool(xdotool, "key", "--clearmodifiers", "--", keys)
        elif action == "scroll":
            direction = request.get("direction")
            buttons = {"up": 4, "down": 5, "left": 6, "right": 7}
            if direction not in buttons:
                raise DriverError("invalid_input", "direction must be up, down, left, or right.")
            amount = required_integer(request.get("amount"), "amount", 1, 25)
            x = request.get("x")
            y = request.get("y")
            if x is not None or y is not None:
                current_x, current_y = current_mouse_position(xdotool)
                scale = scale_for(width, max_width)
                screenshot_x = int(round(current_x * scale)) if x is None else x
                screenshot_y = int(round(current_y * scale)) if y is None else y
                target_x, target_y = map_point(screenshot_x, screenshot_y, width, height, max_width)
                run_xdotool(xdotool, "mousemove", "--sync", target_x, target_y)
            run_xdotool(xdotool, "click", "--repeat", amount, "--delay", 80, buttons[direction])
        else:
            raise DriverError("invalid_input", "Unsupported desktop input command.")
    return {"success": True}


${COMPUTER_TERMINAL_DRIVER_SOURCE}
${COMPUTER_BROWSER_DRIVER_SOURCE}

def dispatch(request):
    if not isinstance(request, dict):
        raise DriverError("invalid_input", "The request must be a JSON object.")
    command = request.get("command")
    if command == "terminal_start":
        return terminal_start(request)
    if command == "terminal_read":
        return terminal_read(request)
    if command == "terminal_cancel":
        return terminal_cancel(request)
    if command == "terminal_list":
        return terminal_list()
    if command == "capabilities":
        return capabilities()
    if command == "screenshot":
        return capture_screenshot(max_width_for(request))
    if command == "wait":
        milliseconds = required_integer(request.get("ms"), "ms", 0, 10000)
        time.sleep(milliseconds / 1000)
        return {"success": True}
    if command == "browser_ensure":
        return ensure_browser()
    if command == "browser":
        return run_browser(request)
    if command in ("click", "move", "drag", "type", "key", "scroll"):
        return run_input(request)
    raise DriverError("invalid_input", "Unsupported desktop command.")


def emit_error(error):
    payload = {"code": error.code, "message": error.message}
    if error.missing:
        payload["missing"] = error.missing
    sys.stdout.write(json.dumps({"error": payload}, separators=(",", ":")) + "\n")


def main():
    try:
        raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
        request = json.loads(raw)
        result = dispatch(request)
        sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
    except DriverError as error:
        emit_error(error)
        return 1
    except (json.JSONDecodeError, UnicodeDecodeError):
        emit_error(DriverError("invalid_input", "The request must be valid JSON."))
        return 1
    except Exception:
        emit_error(DriverError("desktop_driver_failed", "The desktop command failed."))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
`
