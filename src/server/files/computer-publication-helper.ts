import 'server-only'

export const COMPUTER_PUBLICATION_HELPER = String.raw`import base64
import hashlib
import json
import os
import stat
import sys
import urllib.error
import urllib.request

def valid_path(path):
    return isinstance(path, str) and path.startswith("/") and len(path) <= 4096 and "\x00" not in path and os.path.normpath(path) == path

def signature(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)

def open_regular(path):
    if not valid_path(path):
        raise ValueError("path")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(path, flags)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        os.close(fd)
        raise ValueError("not_regular")
    return fd, info

def hash_file(path, maximum):
    fd, before = open_regular(path)
    digest = hashlib.sha256()
    total = 0
    try:
        while True:
            part = os.read(fd, 1024 * 1024)
            if not part:
                break
            total += len(part)
            if total > maximum:
                raise ValueError("oversize")
            digest.update(part)
        after = os.fstat(fd)
        if signature(before) != signature(after) or total != after.st_size:
            raise ValueError("changed")
    finally:
        os.close(fd)
    return total, digest.hexdigest()

def snapshot(source, destination, maximum):
    if not valid_path(source) or not valid_path(destination):
        raise ValueError("path")
    before = os.stat(source, follow_symlinks=False)
    if not stat.S_ISREG(before.st_mode) or before.st_size <= 0 or before.st_size > maximum:
        raise ValueError("source")
    source_fd, opened = open_regular(source)
    if signature(before) != signature(opened):
        os.close(source_fd)
        raise ValueError("changed")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    target_fd = os.open(destination, flags, 0o600)
    digest = hashlib.sha256()
    total = 0
    try:
        while True:
            part = os.read(source_fd, 1024 * 1024)
            if not part:
                break
            total += len(part)
            if total > maximum:
                raise ValueError("oversize")
            digest.update(part)
            view = memoryview(part)
            while view:
                view = view[os.write(target_fd, view):]
        after = os.fstat(source_fd)
        current = os.stat(source, follow_symlinks=False)
        if signature(opened) != signature(after) or signature(before) != signature(current) or total != after.st_size:
            raise ValueError("changed")
        os.fsync(target_fd)
    except Exception:
        os.close(source_fd)
        os.close(target_fd)
        try:
            os.unlink(destination)
        except OSError:
            pass
        raise
    os.close(source_fd)
    os.close(target_fd)
    if total <= 0:
        os.unlink(destination)
        raise ValueError("source")
    return total, digest.hexdigest()

def main(config):
    maximum = int(config["maxBytes"])
    if config["operation"] == "snapshot":
        saved = config.get("savedPath")
        expected_hash = config.get("expectedChecksum")
        expected_size = config.get("expectedSize")
        if saved and valid_path(saved):
            try:
                size, checksum = hash_file(saved, maximum)
                if (expected_hash is None or checksum == expected_hash) and (expected_size is None or size == expected_size):
                    return {"kind": "snapshot", "path": saved, "sizeBytes": size, "checksumSha256": checksum}
            except Exception:
                pass
        destination = config["newPath"]
        size, checksum = snapshot(config["sourcePath"], destination, maximum)
        if expected_hash is not None and (checksum != expected_hash or size != expected_size):
            os.unlink(destination)
            return {"kind": "identity_mismatch"}
        return {"kind": "snapshot", "path": destination, "sizeBytes": size, "checksumSha256": checksum}
    if config["operation"] == "upload":
        path = config["stagingPath"]
        size, checksum = hash_file(path, maximum)
        if size != config["sizeBytes"] or checksum != config["checksumSha256"]:
            return {"kind": "identity_mismatch"}
        fd, info = open_regular(path)
        try:
            with os.fdopen(fd, "rb", closefd=False) as data:
                data.seek(0)
                request = urllib.request.Request(
                    config["url"],
                    data=data,
                    method="PUT",
                    headers={
                        "Content-Length": str(info.st_size),
                        "Content-Type": config["mimeType"],
                        "x-amz-checksum-sha256": base64.b64encode(bytes.fromhex(checksum)).decode("ascii"),
                        "If-None-Match": "*",
                    },
                )
                class NoRedirect(urllib.request.HTTPRedirectHandler):
                    def redirect_request(self, req, fp, code, msg, headers, newurl):
                        return None
                opener = urllib.request.build_opener(NoRedirect())
                with opener.open(request, timeout=220):
                    return {"kind": "uploaded"}
        finally:
            os.close(fd)
    if config["operation"] == "remove":
        path = config["stagingPath"]
        if valid_path(path) and path.startswith("/tmp/overlay-artifact-"):
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass
        return {"kind": "removed"}
    return {"kind": "invalid_operation"}

config_path = sys.argv[1]
try:
    with open(config_path, "r", encoding="utf-8") as source:
        config = json.load(source)
    try:
        result = main(config)
    except urllib.error.HTTPError as error:
        result = {"kind": "http", "status": error.code}
    except urllib.error.URLError:
        result = {"kind": "network"}
    except TimeoutError:
        result = {"kind": "timeout"}
    except Exception:
        result = {"kind": "helper_error"}
    print(json.dumps(result, separators=(",", ":")))
finally:
    try:
        os.unlink(config_path)
    except OSError:
        pass
    try:
        os.unlink(os.path.abspath(__file__))
    except OSError:
        pass
`
