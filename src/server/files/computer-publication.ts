import 'server-only'

import { randomUUID } from 'node:crypto'
import { authorizeComputerPublication, type ArtifactPublicationAuthority } from './ArtifactPublicationAuthority'
import { FileService } from './FileService'
import { ConvexFileRepository } from './ConvexFileRepository'
import type { ComputerArtifactInput, ComputerArtifactManifest, PublishedComputerArtifact } from '@/shared/storage/file-publication'

const COMPUTER_PUBLICATION_LEASE_MS = 240_000
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024

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

export type ComputerPublicationInstance = {
  writeFiles(files: Array<{ path: string; contents: Uint8Array; mode?: number }>): Promise<void>
  runCommand(args: { command: string; timeoutMs: number }): Promise<{
    wait(): Promise<{ exitCode: number; stdout: string }>
  }>
}

type ResolvedComputer = {
  ok: true
  computer: { id: string }
  operate<T>(operation: (instance: ComputerPublicationInstance) => Promise<T>, deadlineMs?: number): Promise<T>
} | { ok: false; error: string }

export type ComputerPublicationRequest = ComputerArtifactInput

function canonicalResult(manifest: ComputerArtifactManifest): PublishedComputerArtifact {
  if (!manifest.fileId) throw new Error('artifact_not_committed')
  return {
    artifactId: manifest.artifactId,
    sourcePath: manifest.sourcePath,
    name: manifest.name,
    ...(manifest.parentId ? { parentId: manifest.parentId } : {}),
    scope: manifest.scope,
    artifactIdentity: JSON.stringify([manifest.rootRunId, manifest.artifactId]),
    fileId: manifest.fileId,
    rootRunId: manifest.rootRunId,
    checksumSha256: manifest.checksumSha256,
    sizeBytes: manifest.sizeBytes,
    workspaceId: manifest.workspaceId,
    mimeType: manifest.mimeType,
  }
}

function safeFailure(error: unknown) {
  const value = error instanceof Error ? error.message : ''
  const errors: Record<string, string> = {
    HARNESS_PUBLICATION_NOT_AUTHORIZED: 'This run is no longer authorized to publish this file.',
    artifact_authority_expired: 'The publication authorization expired. Start a new artifact with a new artifactId.',
    ARTIFACT_AUTHORITY_EXPIRED: 'The publication authorization expired. Start a new artifact with a new artifactId.',
    artifact_identity_conflict: 'This artifactId is already pinned to different bytes or metadata. Use a new artifactId.',
    artifact_mime_invalid: 'The requested MIME type must match the frozen artifact.',
    ARTIFACT_SOURCE_UNAVAILABLE: 'The source file is missing or could not be safely snapshotted.',
    ARTIFACT_UPLOAD_CONFLICT: 'The object key already contains different bytes. Use a new artifactId.',
    ARTIFACT_UPLOAD_UNCERTAIN: 'Upload status is uncertain; retry with the same artifactId to reconcile it.',
    artifact_destination_mismatch: 'The destination does not match the authorized workspace scope.',
    artifact_size_limit_exceeded: 'The file exceeds the configured upload limit.',
    ARTIFACT_SIZE_LIMIT_EXCEEDED: 'The file exceeds the configured upload limit.',
    ARTIFACT_HEAD_MISMATCH: 'The uploaded object metadata does not match the frozen artifact.',
    ARTIFACT_CHECKSUM_MISMATCH: 'The uploaded object bytes do not match the frozen SHA-256.',
    ARTIFACT_READBACK_OVERSIZE: 'The uploaded object exceeded the frozen size.',
    ARTIFACT_READBACK_TRUNCATED: 'The uploaded object was truncated during verification.',
    artifact_source_path_invalid: 'Use an absolute canonical source path on the Computer.',
    artifact_name_invalid: 'Use a basename of at most 255 characters.',
    artifact_identity_invalid: 'Use a stable artifactId of at most 128 letters, digits, underscores, or hyphens.',
  }
  const message = errors[value] ?? 'Artifact publication is temporarily unavailable.'
  const retryable = !errors[value] || value === 'ARTIFACT_READBACK_FAILED'
  return {
    success: false as const,
    error: errors[value] ? value : 'ARTIFACT_PUBLICATION_FAILED',
    message: `${message}${retryable ? ' Retry with the same artifactId for identical bytes; use a new artifactId for different bytes.' : ''}`,
    retryable,
  }
}

export async function runHelper(instance: ComputerPublicationInstance, config: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = randomUUID()
  const helperPath = `/tmp/overlay-artifact-${id}.py`
  const configPath = `/tmp/overlay-artifact-${id}.json`
  try {
    await instance.writeFiles([
      { path: helperPath, contents: new TextEncoder().encode(COMPUTER_PUBLICATION_HELPER), mode: 0o600 },
      { path: configPath, contents: new TextEncoder().encode(JSON.stringify({ maxBytes: MAX_ARTIFACT_BYTES, ...config })), mode: 0o600 },
    ])
    const handle = await instance.runCommand({ command: `python3 ${helperPath} ${configPath}`, timeoutMs: COMPUTER_PUBLICATION_LEASE_MS - 10_000 })
    const result = await handle.wait()
    const lastLine = result.stdout.trim().split('\n').at(-1)
    if (result.exitCode !== 0 || !lastLine) return { kind: 'helper_error' }
    try {
      const parsed = JSON.parse(lastLine) as Record<string, unknown>
      return typeof parsed.kind === 'string' ? parsed : { kind: 'helper_error' }
    } catch (_error) {
      return { kind: 'helper_error' }
    }
  } catch (_error) {
    return { kind: 'helper_error' }
  } finally {
    try {
      await instance.runCommand({
        command: `rm -f -- ${helperPath} ${configPath}`,
        timeoutMs: 5_000,
      })
    } catch (_error) {
      // The Python helper removes itself and its configuration after execution.
    }
  }
}

async function runOnComputer<T>(
  computer: ResolvedComputer & { ok: true },
  operation: (instance: ComputerPublicationInstance) => Promise<T>,
): Promise<T> {
  return await computer.operate(operation, COMPUTER_PUBLICATION_LEASE_MS)
}

export async function publishComputerFile(args: {
  request: ComputerPublicationRequest
  authority: ArtifactPublicationAuthority | undefined
  resolveComputer(): Promise<ResolvedComputer>
}): Promise<{ success: true; artifact: PublishedComputerArtifact } | ReturnType<typeof safeFailure>> {
  const service = new FileService({ repository: new ConvexFileRepository() })
  try {
    if (!args.authority) throw new Error('HARNESS_PUBLICATION_NOT_AUTHORIZED')
    const authority = args.authority
    const userId = authority.access.actorUserId
    const workspaceId = authority.access.workspaceId
    const input: ComputerArtifactInput = {
      artifactId: args.request.artifactId,
      sourcePath: args.request.sourcePath,
      name: args.request.name,
      mimeType: args.request.mimeType,
      ...(args.request.parentId ? { parentId: args.request.parentId } : {}),
      scope: args.request.scope,
    }
    const reference = await authorizeComputerPublication({
      userId,
      workspaceId,
      artifactPublicationAuthority: authority,
    })
    let manifest = await service.getComputerArtifact(reference, input)
    if (manifest?.fileId) return { success: true, artifact: canonicalResult(manifest) }
    if (manifest) {
      const reconciled = await service.verifyAndCommitComputerArtifact({ manifest, authority })
      if (reconciled.kind === 'published') return { success: true, artifact: reconciled.artifact }
    }

    const computer = await args.resolveComputer()
    if (!computer.ok) throw new Error('COMPUTER_UNAVAILABLE')
    const snapshotResult = await runOnComputer(computer, instance => runHelper(instance, {
      operation: 'snapshot',
      sourcePath: input.sourcePath,
      savedPath: manifest && manifest.sourceComputerId === computer.computer.id ? manifest.stagingPath : null,
      newPath: `/tmp/overlay-artifact-${randomUUID()}.bin`,
      expectedChecksum: manifest?.checksumSha256 ?? null,
      expectedSize: manifest?.sizeBytes ?? null,
      maxBytes: service.getComputerArtifactMaxBytes(),
    }))
    if (snapshotResult.kind === 'identity_mismatch') throw new Error('artifact_identity_conflict')
    if (snapshotResult.kind !== 'snapshot'
      || typeof snapshotResult.path !== 'string'
      || typeof snapshotResult.checksumSha256 !== 'string'
      || typeof snapshotResult.sizeBytes !== 'number') {
      throw new Error('ARTIFACT_SOURCE_UNAVAILABLE')
    }
    manifest = await service.prepareComputerArtifact({
      reference,
      input,
      snapshot: {
        sourceComputerId: computer.computer.id,
        stagingPath: snapshotResult.path,
        checksumSha256: snapshotResult.checksumSha256,
        sizeBytes: snapshotResult.sizeBytes,
        mimeType: args.request.mimeType,
      },
    })
    if (manifest.fileId) return { success: true, artifact: canonicalResult(manifest) }
    let uploadResult: Record<string, unknown> = { kind: 'helper_error' }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await authorizeComputerPublication({
          userId,
          workspaceId,
          artifactPublicationAuthority: authority,
        })
      }
      const url = await service.getComputerArtifactUploadUrl(manifest)
      uploadResult = await runOnComputer(computer, instance => runHelper(instance, {
        operation: 'upload',
        stagingPath: manifest!.stagingPath,
        url,
        sizeBytes: manifest!.sizeBytes,
        checksumSha256: manifest!.checksumSha256,
        mimeType: manifest!.mimeType,
        maxBytes: service.getComputerArtifactMaxBytes(),
      }))
      const reconciled = await service.verifyAndCommitComputerArtifact({ manifest, authority })
      if (reconciled.kind === 'published') {
        await runOnComputer(computer, instance => runHelper(instance, {
          operation: 'remove',
          stagingPath: manifest!.stagingPath,
        }))
        return { success: true, artifact: reconciled.artifact }
      }
      if (attempt === 0 && uploadResult.kind === 'http' && uploadResult.status === 403) continue
      break
    }
    if (uploadResult.kind === 'http' && (uploadResult.status === 409 || uploadResult.status === 412)) {
      throw new Error('ARTIFACT_UPLOAD_CONFLICT')
    }
    throw new Error('ARTIFACT_UPLOAD_UNCERTAIN')
  } catch (error) {
    return safeFailure(error)
  }
}
