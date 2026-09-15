/**
 * Knowledge-base service — wraps the typed `KnowledgeBasesClient`
 * (list/personal/create/update/remove, sources, diagnostics, reindex,
 * search, extraction preview, grants, share directory). Uploads go through
 * `appRequest` FormData in the same pattern as `aiService.uploadDocument`.
 * KB sharing uses the dedicated `/knowledge-bases/[id]/grants` +
 * `/knowledge-bases/share-directory` model (user/group/role principals,
 * viewer|editor roles) — not the unified workspace `/shares`.
 */
import type { KnowledgeBase } from '@overlay/app-core'
import type {
  KnowledgeBaseSearchResponse,
  KnowledgeBaseSourceDetail,
} from '@overlay/api-client'
import { appRequest } from './appApi'
import { mobileOverlayAppClient } from './overlayClient'

const client = () => mobileOverlayAppClient.knowledgeBases

// Several knowledge-bases types are not re-exported by the package index —
// derive them from the client methods instead.
export type KnowledgeBaseDiagnosticsResponse = Awaited<
  ReturnType<ReturnType<typeof client>['diagnostics']>
>
export type KnowledgeSourcePreview = Awaited<
  ReturnType<ReturnType<typeof client>['extractionPreview']>
>['preview']
export type ReindexKnowledgeBaseResponse = Awaited<
  ReturnType<ReturnType<typeof client>['reindex']>
>
export type CreateKnowledgeBaseInput = Parameters<
  ReturnType<typeof client>['create']
>[0]
export type CreateKnowledgeBaseSourceInput = Parameters<
  ReturnType<typeof client>['createSource']
>[1]

export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  const { knowledgeBases } = await client().list()
  return knowledgeBases
}

export async function ensurePersonalKnowledgeBase(title?: string): Promise<KnowledgeBase> {
  const { knowledgeBase } = await client().ensurePersonal(title ? { title } : {})
  return knowledgeBase
}

export async function createKnowledgeBase(input: CreateKnowledgeBaseInput): Promise<KnowledgeBase> {
  const { knowledgeBase } = await client().create(input)
  return knowledgeBase
}

export async function updateKnowledgeBase(
  knowledgeBaseId: string,
  patch: Partial<CreateKnowledgeBaseInput>,
): Promise<KnowledgeBase> {
  const { knowledgeBase } = await client().update({ knowledgeBaseId, ...patch })
  return knowledgeBase
}

export async function removeKnowledgeBase(knowledgeBaseId: string): Promise<void> {
  await client().remove(knowledgeBaseId)
}

// ── Sources ──

export type { KnowledgeBaseSourceDetail }

export async function listKnowledgeBaseSources(
  knowledgeBaseId: string,
): Promise<KnowledgeBaseSourceDetail[]> {
  const { sources } = await client().listSources(knowledgeBaseId)
  return sources
}

export async function createKnowledgeBaseSource(
  knowledgeBaseId: string,
  input: CreateKnowledgeBaseSourceInput,
): Promise<void> {
  await client().createSource(knowledgeBaseId, input)
}

/** Multipart source upload — RN FormData file part ({uri,name,type}). */
export async function uploadKnowledgeBaseSource(
  knowledgeBaseId: string,
  file: { uri: string; name: string; mimeType: string },
): Promise<void> {
  const form = new FormData()
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob)
  const res = await appRequest(
    `/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/sources/upload`,
    { method: 'POST', formData: form },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Could not upload source')
  }
}

export async function updateKnowledgeBaseSource(
  knowledgeBaseId: string,
  patch: { sourceId: string; enabled?: boolean; retry?: boolean; refresh?: boolean },
): Promise<void> {
  await client().updateSource(knowledgeBaseId, patch)
}

export async function removeKnowledgeBaseSource(
  knowledgeBaseId: string,
  sourceId: string,
): Promise<void> {
  await client().removeSource(knowledgeBaseId, { sourceId })
}

// ── Diagnostics + reindex ──

export async function knowledgeBaseDiagnostics(
  knowledgeBaseId: string,
): Promise<KnowledgeBaseDiagnosticsResponse> {
  return client().diagnostics(knowledgeBaseId)
}

export async function knowledgeSourceExtractionPreview(
  knowledgeBaseId: string,
  sourceId: string,
): Promise<KnowledgeSourcePreview> {
  const { preview } = await client().extractionPreview(knowledgeBaseId, sourceId)
  return preview
}

export async function reindexKnowledgeBase(
  knowledgeBaseId: string,
  options: { sourceId?: string; onlyStale?: boolean } = {},
): Promise<ReindexKnowledgeBaseResponse> {
  return client().reindex(knowledgeBaseId, options)
}

// ── Search ──

export async function searchKnowledgeBase(
  knowledgeBaseId: string,
  query: string,
  limit = 10,
): Promise<KnowledgeBaseSearchResponse> {
  return client().search(knowledgeBaseId, { query, limit })
}

// ── Grants + share directory (dedicated KB model — NOT unified /shares) ──

export type KnowledgeBaseShareDirectory = Awaited<
  ReturnType<ReturnType<typeof client>['listShareDirectory']>
>
export type KnowledgeBaseGrant = Awaited<
  ReturnType<ReturnType<typeof client>['listGrants']>
>['grants'][number]

export async function listKnowledgeBaseGrants(
  knowledgeBaseId: string,
): Promise<KnowledgeBaseGrant[]> {
  const { grants } = await client().listGrants(knowledgeBaseId)
  return grants
}

export async function knowledgeBaseShareDirectory(): Promise<KnowledgeBaseShareDirectory> {
  return client().listShareDirectory()
}

export async function shareKnowledgeBase(
  knowledgeBaseId: string,
  input: {
    principalType: 'user' | 'group' | 'role'
    principalId: string
    accessRole: 'viewer' | 'editor'
  },
): Promise<KnowledgeBaseGrant> {
  const { grant } = await client().share(knowledgeBaseId, input)
  return grant
}

export async function revokeKnowledgeBaseShare(
  knowledgeBaseId: string,
  grantId: string,
): Promise<void> {
  await client().revokeShare(knowledgeBaseId, { grantId })
}
