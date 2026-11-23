/**
 * Screen recordings as proof of work. One recording at a time per computer: ffmpeg captures the X display into a
 * crash-safe Matroska file; annotations are timestamped notes; stop finalizes an MP4 whose chapters are the notes.
 */
export const COMPUTER_RECORDING_DRIVER_SOURCE = String.raw`
RECORDING_ROOT = "/tmp/overlay-computer/recordings"
RECORDING_ACTIVE_PATH = "/tmp/overlay-computer/recordings/active"
RECORDING_ID_PATTERN = re.compile(r"^r-[0-9a-f]{12}$")
RECORDING_DEFAULT_SECONDS = 600
RECORDING_MAX_SECONDS = 1800
RECORDING_MAX_BYTES = 95 * 1024 * 1024
RECORDING_MAX_ANNOTATIONS = 200
RECORDING_STATUSES = ("setup", "step", "pass", "fail")
RECORDING_STOP_WAIT_SECONDS = 10


def recording_directory(recording_id):
    if not isinstance(recording_id, str) or not RECORDING_ID_PATTERN.fullmatch(recording_id):
        raise DriverError("invalid_input", "The recording id is invalid.")
    return os.path.join(RECORDING_ROOT, recording_id)


def recording_read(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return default


def recording_process_running(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    try:
        with open("/proc/%d/stat" % pid, "r", encoding="utf-8") as handle:
            return handle.read().split(")")[-1].split()[0] != "Z"
    except OSError:
        return True


def recording_active():
    recording_id = recording_read(RECORDING_ACTIVE_PATH)
    if not recording_id or not RECORDING_ID_PATTERN.fullmatch(recording_id):
        return None
    directory = os.path.join(RECORDING_ROOT, recording_id)
    if os.path.exists(os.path.join(directory, "stopped")):
        return None
    return recording_id


def recording_annotations(directory):
    annotations = []
    try:
        with open(os.path.join(directory, "annotations.jsonl"), "r", encoding="utf-8") as handle:
            for line in handle:
                with contextlib.suppress(ValueError):
                    item = json.loads(line)
                    if isinstance(item, dict):
                        annotations.append(item)
    except OSError:
        pass
    return annotations


def recording_start(request):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise DriverError("recording_unsupported", "Screen recording requires ffmpeg.", ["ffmpeg"])
    width, height = read_display_geometry(required=True)
    max_seconds = request.get("maxSeconds", RECORDING_DEFAULT_SECONDS)
    if not isinstance(max_seconds, int) or isinstance(max_seconds, bool) or not 5 <= max_seconds <= RECORDING_MAX_SECONDS:
        raise DriverError("invalid_input", "maxSeconds must be between 5 and %d." % RECORDING_MAX_SECONDS)
    fps = request.get("fps", 10)
    if not isinstance(fps, int) or isinstance(fps, bool) or not 1 <= fps <= 30:
        raise DriverError("invalid_input", "fps must be between 1 and 30.")
    title = request.get("title")
    if title is not None and (not isinstance(title, str) or len(title) > 200):
        raise DriverError("invalid_input", "title must be at most 200 characters.")
    os.makedirs(RECORDING_ROOT, mode=0o700, exist_ok=True)
    with terminal_start_lock():
        current = recording_active()
        if current:
            raise DriverError("recording_active", "A recording is already running (" + current + "). Stop it first.", detail={"id": current})
        recording_id = "r-" + secrets.token_hex(6)
        directory = recording_directory(recording_id)
        os.makedirs(directory, mode=0o700)
        # Even dimensions are required by yuv420p; scale large screens down to at most 1280 wide to keep files small.
        scale = "scale='min(1280,iw)':-2"
        log = open(os.path.join(directory, "ffmpeg.log"), "ab")
        try:
            process = subprocess.Popen(
                [
                    ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
                    "-f", "x11grab", "-draw_mouse", "1", "-framerate", str(fps),
                    "-video_size", "%dx%d" % (width, height), "-i", display_name(),
                    "-t", str(max_seconds), "-fs", str(RECORDING_MAX_BYTES),
                    "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
                    "-pix_fmt", "yuv420p", "-g", str(fps * 2),
                    "-y", os.path.join(directory, "capture.mkv"),
                ],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
                env=command_environment(),
                start_new_session=True,
                close_fds=True,
            )
        except OSError:
            shutil.rmtree(directory, ignore_errors=True)
            raise DriverError("recording_start_failed", "The screen recording could not be started.")
        finally:
            log.close()
        started_at = time.time()
        terminal_write_text(os.path.join(directory, "pid"), str(process.pid))
        terminal_write_text(os.path.join(directory, "started_at"), repr(started_at))
        terminal_write_text(os.path.join(directory, "meta.json"), json.dumps({
            "title": title or "", "maxSeconds": max_seconds, "fps": fps, "width": width, "height": height,
        }))
        terminal_write_text(RECORDING_ACTIVE_PATH, recording_id)
    time.sleep(0.5)
    if process.poll() is not None:
        detail = (recording_read(os.path.join(directory, "ffmpeg.log"), "") or "")[-300:]
        with contextlib.suppress(OSError):
            os.unlink(RECORDING_ACTIVE_PATH)
        shutil.rmtree(directory, ignore_errors=True)
        raise DriverError("recording_start_failed", "ffmpeg exited right away: " + (detail or "no output"))
    return {"id": recording_id, "maxSeconds": max_seconds, "fps": fps}


def recording_annotate(request):
    directory = recording_directory(request.get("id"))
    if not os.path.isdir(directory):
        raise DriverError("not_found", "No such recording.")
    if os.path.exists(os.path.join(directory, "stopped")):
        raise DriverError("recording_stopped", "This recording has already stopped.")
    label = request.get("label")
    status = request.get("status", "step")
    if not isinstance(label, str) or not label.strip() or len(label) > 200:
        raise DriverError("invalid_input", "label must contain between 1 and 200 characters.")
    if status not in RECORDING_STATUSES:
        raise DriverError("invalid_input", "status must be one of: " + ", ".join(RECORDING_STATUSES) + ".")
    started_at = float(recording_read(os.path.join(directory, "started_at"), "0") or 0)
    existing = recording_annotations(directory)
    if len(existing) >= RECORDING_MAX_ANNOTATIONS:
        raise DriverError("recording_limit", "A recording can have at most %d annotations." % RECORDING_MAX_ANNOTATIONS)
    note = {"t": round(max(0.0, time.time() - started_at), 2), "label": " ".join(label.split()), "status": status}
    with open(os.path.join(directory, "annotations.jsonl"), "a", encoding="utf-8") as handle:
        handle.write(json.dumps(note) + "\n")
    return {"id": request.get("id"), "annotation": note, "count": len(existing) + 1}


def recording_escape(value):
    return re.sub(r"([=;#\\\n])", r"\\\1", value)


def recording_probe_duration(path):
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    with contextlib.suppress(OSError, ValueError, subprocess.TimeoutExpired):
        result = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
            capture_output=True, text=True, timeout=20, check=False,
        )
        return float(result.stdout.strip())
    return None


def recording_stop(request):
    recording_id = request.get("id")
    directory = recording_directory(recording_id)
    if not os.path.isdir(directory):
        raise DriverError("not_found", "No such recording.")
    output = os.path.join(directory, "recording.mp4")
    pid = int(recording_read(os.path.join(directory, "pid"), "0") or 0)
    if pid and recording_process_running(pid):
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.kill(pid, signal.SIGINT)
        deadline = time.time() + RECORDING_STOP_WAIT_SECONDS
        while time.time() < deadline and recording_process_running(pid):
            time.sleep(0.1)
        if recording_process_running(pid):
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.kill(pid, signal.SIGKILL)
    terminal_write_text(os.path.join(directory, "stopped"), repr(time.time()))
    if recording_read(RECORDING_ACTIVE_PATH) == recording_id:
        with contextlib.suppress(OSError):
            os.unlink(RECORDING_ACTIVE_PATH)
    capture = os.path.join(directory, "capture.mkv")
    if not os.path.isfile(capture) or os.path.getsize(capture) == 0:
        raise DriverError("recording_empty", "The recording captured nothing.")
    meta = {}
    with contextlib.suppress(ValueError):
        meta = json.loads(recording_read(os.path.join(directory, "meta.json"), "{}") or "{}")
    duration = recording_probe_duration(capture) or 0.0
    annotations = sorted(recording_annotations(directory), key=lambda item: float(item.get("t", 0)))
    annotations = [item for item in annotations if float(item.get("t", 0)) <= duration + 1] if duration else annotations
    lines = [";FFMETADATA1"]
    if meta.get("title"):
        lines.append("title=" + recording_escape(meta["title"]))
    for index, item in enumerate(annotations):
        start = int(float(item.get("t", 0)) * 1000)
        end = int(float(annotations[index + 1].get("t", 0)) * 1000) if index + 1 < len(annotations) else int(duration * 1000)
        if end <= start:
            end = start + 1
        lines += [
            "[CHAPTER]", "TIMEBASE=1/1000", "START=%d" % start, "END=%d" % end,
            "title=" + recording_escape("[" + str(item.get("status", "step")) + "] " + str(item.get("label", ""))),
        ]
    metadata_path = os.path.join(directory, "chapters.txt")
    terminal_write_text(metadata_path, "\n".join(lines) + "\n")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise DriverError("recording_unsupported", "Screen recording requires ffmpeg.", ["ffmpeg"])
    result = subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", capture, "-i", metadata_path,
            "-map", "0:v", "-map_metadata", "1", "-map_chapters", "1", "-c", "copy", "-movflags", "+faststart",
            "-y", output,
        ],
        capture_output=True, text=True, timeout=120, check=False,
    )
    if result.returncode != 0 or not os.path.isfile(output):
        raise DriverError("recording_finalize_failed", "The recording could not be finalized: " + result.stderr.strip()[-300:])
    counts = {status: 0 for status in RECORDING_STATUSES}
    for item in annotations:
        if item.get("status") in counts:
            counts[item["status"]] += 1
    return {
        "id": recording_id,
        "path": output,
        "sizeBytes": os.path.getsize(output),
        "durationSeconds": round(duration, 2),
        "title": meta.get("title") or "",
        "annotations": annotations,
        "counts": counts,
    }


def recording_status():
    recording_id = recording_active()
    if not recording_id:
        return {"active": None}
    directory = os.path.join(RECORDING_ROOT, recording_id)
    started_at = float(recording_read(os.path.join(directory, "started_at"), "0") or 0)
    pid = int(recording_read(os.path.join(directory, "pid"), "0") or 0)
    return {
        "active": {
            "id": recording_id,
            "elapsedSeconds": round(time.time() - started_at, 1),
            "capturing": bool(pid and recording_process_running(pid)),
            "annotations": len(recording_annotations(directory)),
        },
    }
`
