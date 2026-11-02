import 'server-only'

import { randomUUID } from 'node:crypto'
import { authorizeComputerPublication, type ArtifactPublicationAuthority } from './ArtifactPublicationAuthority'
import { COMPUTER_PUBLICATION_HELPER } from './computer-publication-helper'
import type { ComputerArtifactInput, ComputerArtifactManifest, PublishedComputerArtifact } from '@/shared/storage/file-publication'

export { COMPUTER_PUBLICATION_HELPER }

const COMPUTER_PUBLICATION_LEASE_MS = 240_000
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024

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

type FailureDefinition = {
  message: string
  retryable: boolean
}

const FAILURE_DEFINITIONS: Record<string, FailureDefinition> = {
  HARNESS_PUBLICATION_NOT_AUTHORIZED: {
    message: 'This run is no longer authorized to publish this file.',
    retryable: false,
  },
  HARNESS_ACCESS_DENIED: {
    message: 'This run is no longer authorized to publish this file.',
    retryable: false,
  },
  WORKSPACE_ACCESS_DENIED: {
    message: 'You no longer have access to this workspace destination.',
    retryable: false,
  },
  RESOURCE_SCOPE_FORBIDDEN: {
    message: 'You no longer have access to this file destination.',
    retryable: false,
  },
  Unauthorized: {
    message: 'This run is no longer authorized to publish this file.',
    retryable: false,
  },
  artifact_authority_expired: {
    message: 'The publication authorization expired. Start a new artifact with a new artifactId.',
    retryable: false,
  },
  ARTIFACT_AUTHORITY_EXPIRED: {
    message: 'The publication authorization expired. Start a new artifact with a new artifactId.',
    retryable: false,
  },
  artifact_identity_conflict: {
    message: 'This artifactId is already pinned to different bytes or metadata. Use a new artifactId.',
    retryable: false,
  },
  artifact_mime_invalid: {
    message: 'The requested MIME type must match the frozen artifact.',
    retryable: false,
  },
  FILE_MIME_NOT_ALLOWED: {
    message: 'This MIME type is not allowed for Files publication.',
    retryable: false,
  },
  ARTIFACT_SOURCE_UNAVAILABLE: {
    message: 'The source file is missing or could not be safely snapshotted.',
    retryable: false,
  },
  ARTIFACT_UPLOAD_CONFLICT: {
    message: 'The object key already contains different bytes. Use a new artifactId.',
    retryable: false,
  },
  ARTIFACT_UPLOAD_UNCERTAIN: {
    message: 'Upload status is uncertain.',
    retryable: true,
  },
  artifact_destination_mismatch: {
    message: 'The destination does not match the authorized workspace scope.',
    retryable: false,
  },
  artifact_manifest_not_found: {
    message: 'The publication manifest is no longer available. Start a new artifact with a new artifactId.',
    retryable: false,
  },
  artifact_upload_intent_ineligible: {
    message: 'The upload authorization is no longer eligible. Start a new artifact with a new artifactId.',
    retryable: false,
  },
  upload_intent_expired: {
    message: 'The upload authorization expired. Start a new artifact with a new artifactId.',
    retryable: false,
  },
  upload_intent_not_found: {
    message: 'The upload authorization was not found. Start a new artifact with a new artifactId.',
    retryable: false,
  },
  storage_limit_exceeded: {
    message: 'Overlay storage limit reached.',
    retryable: false,
  },
  r2_global_budget_exceeded: {
    message: 'Overlay storage limit reached.',
    retryable: false,
  },
  r2_budget_check_failed: {
    message: 'Storage availability could not be verified.',
    retryable: true,
  },
  artifact_size_limit_exceeded: {
    message: 'The file exceeds the configured upload limit.',
    retryable: false,
  },
  ARTIFACT_SIZE_LIMIT_EXCEEDED: {
    message: 'The file exceeds the configured upload limit.',
    retryable: false,
  },
  ARTIFACT_HEAD_MISMATCH: {
    message: 'The uploaded object metadata does not match the frozen artifact.',
    retryable: false,
  },
  ARTIFACT_HEAD_FAILED: {
    message: 'The uploaded object could not be checked.',
    retryable: true,
  },
  ARTIFACT_CHECKSUM_MISMATCH: {
    message: 'The uploaded object bytes do not match the frozen SHA-256.',
    retryable: false,
  },
  ARTIFACT_READBACK_OVERSIZE: {
    message: 'The uploaded object exceeded the frozen size.',
    retryable: false,
  },
  ARTIFACT_READBACK_TRUNCATED: {
    message: 'The uploaded object was truncated during verification.',
    retryable: true,
  },
  ARTIFACT_READBACK_FAILED: {
    message: 'The uploaded object could not be verified.',
    retryable: true,
  },
  ARTIFACT_SOURCE_PATH_INVALID: {
    message: 'Use an absolute canonical source path on the Computer.',
    retryable: false,
  },
  artifact_source_path_invalid: {
    message: 'Use an absolute canonical source path on the Computer.',
    retryable: false,
  },
  artifact_name_invalid: {
    message: 'Use a basename of at most 255 characters.',
    retryable: false,
  },
  artifact_identity_invalid: {
    message: 'Use a stable artifactId of at most 128 letters, digits, underscores, or hyphens.',
    retryable: false,
  },
  artifact_snapshot_invalid: {
    message: 'The source snapshot metadata is invalid. Check the source file and retry with a new artifactId.',
    retryable: false,
  },
  COMPUTER_UNAVAILABLE: {
    message: 'Computer access is unavailable. Check that a Computer is enabled, bound, and accessible.',
    retryable: false,
  },
  helper_error: {
    message: 'The Computer publication helper failed safely.',
    retryable: true,
  },
  network: {
    message: 'The Computer could not reach file storage.',
    retryable: true,
  },
  timeout: {
    message: 'The Computer file operation timed out.',
    retryable: true,
  },
}

function extractFailureCode(error: unknown): string | undefined {
  const candidates: string[] = []
  if (error && typeof error === 'object' && 'payload' in error) {
    const payload = (error as { payload?: unknown }).payload
    if (payload && typeof payload === 'object' && 'error' in payload
      && typeof (payload as { error?: unknown }).error === 'string') {
      candidates.push((payload as { error: string }).error)
    }
  }
  if (error instanceof Error) candidates.push(error.message)
  for (const candidate of candidates) {
    const identifiers = new Set(candidate.match(/[A-Za-z0-9_]+/g) ?? [])
    for (const code of Object.keys(FAILURE_DEFINITIONS)) {
      if (identifiers.has(code)) return code
    }
    if (candidate.startsWith('File type not allowed:')) return 'FILE_MIME_NOT_ALLOWED'
    if (candidate.startsWith('File is too large for direct upload.')) return 'ARTIFACT_SIZE_LIMIT_EXCEEDED'
  }
  return undefined
}

export function safeFailure(error: unknown) {
  const code = extractFailureCode(error)
  const definition = code ? FAILURE_DEFINITIONS[code] : undefined
  const retryable = definition?.retryable ?? true
  const message = definition?.message ?? 'Artifact publication failed for an unknown reason.'
  return {
    success: false as const,
    error: code ?? 'ARTIFACT_PUBLICATION_UNKNOWN',
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
  userId: string
  workspaceId?: string
  resolveComputer(): Promise<ResolvedComputer>
}): Promise<{ success: true; artifact: PublishedComputerArtifact } | ReturnType<typeof safeFailure>> {
  try {
    const { fileService: service } = await import('./http')
    if (!args.authority) throw new Error('HARNESS_PUBLICATION_NOT_AUTHORIZED')
    const input: ComputerArtifactInput = {
      artifactId: args.request.artifactId,
      sourcePath: args.request.sourcePath,
      name: args.request.name,
      mimeType: args.request.mimeType,
      ...(args.request.parentId ? { parentId: args.request.parentId } : {}),
      scope: args.request.scope,
    }
    let reference = await authorizeComputerPublication({
      userId: args.userId,
      workspaceId: args.workspaceId,
      artifactPublicationAuthority: args.authority,
    })
    let manifest = await service.getComputerArtifact(reference, input)
    if (manifest?.fileId) return { success: true, artifact: canonicalResult(manifest) }
    if (manifest) {
      const reconciled = await service.verifyAndCommitComputerArtifact({ manifest, authority: args.authority })
      if (reconciled.kind === 'published') return { success: true, artifact: reconciled.artifact }
    }

    const computer = await args.resolveComputer()
    if (!computer.ok) throw new Error('COMPUTER_UNAVAILABLE')
    reference = await authorizeComputerPublication({
      userId: args.userId,
      workspaceId: args.workspaceId,
      artifactPublicationAuthority: args.authority,
    })
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
      reference = await authorizeComputerPublication({
        userId: args.userId,
        workspaceId: args.workspaceId,
        artifactPublicationAuthority: args.authority,
      })
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
      const reconciled = await service.verifyAndCommitComputerArtifact({
        manifest,
        authority: args.authority,
      })
      if (reconciled.kind === 'published') {
        try {
          await runOnComputer(computer, instance => runHelper(instance, {
            operation: 'remove',
            stagingPath: manifest!.stagingPath,
          }))
        } catch (_error) {
          // Publication is already verified; cleanup is best effort.
        }
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
