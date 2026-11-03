export type UploadedFileInput = {
  userId: string
  workspaceId?: string
  name: string
  parentId?: string
  r2Key: string
  sizeBytes: number
  sourceChecksumSha256?: string
  mimeType?: string
  extension?: string
  scope?: 'personal' | 'workspace'
}

export type ArtifactExecutionReference = {
  actorUserId: string
  runId: string
  workflowRunId: string
}

export type ComputerArtifactInput = {
  artifactId: string
  sourcePath: string
  name: string
  mimeType: string
  parentId?: string
  scope: 'personal' | 'workspace'
}

export type ComputerArtifactSnapshot = {
  sourceComputerId: string
  stagingPath: string
  checksumSha256: string
  sizeBytes: number
  mimeType: string
}

export type ComputerArtifactLookup = {
  reference: ArtifactExecutionReference
  input: ComputerArtifactInput
}

export type ComputerArtifactPrepare = ComputerArtifactLookup & {
  snapshot: ComputerArtifactSnapshot
}

export type ComputerArtifactRecord = ComputerArtifactInput & ComputerArtifactSnapshot & {
  userId: string
  workspaceId: string
  rootRunId: string
  r2Key: string
  uploadExpiresAt: number
  fileId?: string
}

export type ComputerArtifactManifest = ComputerArtifactRecord & {
  createdAt: number
  updatedAt: number
}

export type ComputerArtifactCommit = ComputerArtifactLookup & {
  r2Key: string
  checksumSha256: string
  sizeBytes: number
}

export type PublishedComputerArtifact = ComputerArtifactInput & {
  artifactIdentity: string
  fileId: string
  rootRunId: string
  checksumSha256: string
  sizeBytes: number
  workspaceId: string
  mimeType: string
}
