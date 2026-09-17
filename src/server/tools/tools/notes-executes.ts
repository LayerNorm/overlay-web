import 'server-only'

import { callInternalApi, callInternalApiGet, toolAuthBody } from './internal-api'
import { buildServiceAuthToken, getServiceAuthHeaderName } from '@/server/auth/service-auth'
import { unwrapPaginatedData } from '@/shared/api/pagination'
import type { OverlayToolsOptions } from './types'

export async function executeListNotes(
  options: OverlayToolsOptions,
  _input: Record<string, never>,
) {
  try {
    const params = new URLSearchParams({ userId: options.userId })
    params.set('kind', 'note')
    params.set('limit', '100')
    const res = await callInternalApiGet(
      `/api/v1/files?${params}`,
      options.accessToken,
      options.baseUrl,
      options.forwardCookie,
      options.serverSecret,
      options.userId,
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Failed to list notes' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Failed to list notes' }
    }
    const notes = unwrapPaginatedData<{
      _id: string
      name?: string
      updatedAt: number
    }>(await res.json())
    const slim = notes.map((n) => ({
      noteId: n._id,
      title: n.name || 'Untitled',
      updatedAt: n.updatedAt,
    }))
    return { success: true, notes: slim }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to list notes',
    }
  }
}

export async function executeGetNote(options: OverlayToolsOptions, input: { noteId: string }) {
  try {
    const params = new URLSearchParams({
      userId: options.userId,
      fileId: input.noteId.trim(),
    })
    const res = await callInternalApiGet(
      `/api/v1/files?${params}`,
      options.accessToken,
      options.baseUrl,
      options.forwardCookie,
      options.serverSecret,
      options.userId,
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Note not found' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Note not found' }
    }
    const note = (await res.json()) as {
      _id: string
      name?: string
      content?: string
      textContent?: string
      updatedAt: number
    }
    return {
      success: true,
      note: {
        noteId: note._id,
        title: note.name || 'Untitled',
        content: note.textContent ?? note.content ?? '',
        tags: [],
        updatedAt: note.updatedAt,
      },
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load note',
    }
  }
}

export async function executeCreateNote(
  options: OverlayToolsOptions,
  input: { title?: string; content: string; tags?: string[] },
) {
  try {
    const res = await callInternalApi(
      '/api/v1/files',
      {
        kind: 'note',
        name: input.title ?? 'Untitled',
        textContent: input.content,
        ...toolAuthBody(options),
      },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Failed to create note' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Failed to create note' }
    }
    const data = (await res.json()) as { id?: string }
    return { success: true, noteId: data.id }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create note',
    }
  }
}

export async function executeUpdateNote(
  options: OverlayToolsOptions,
  input: { noteId: string; title?: string; content?: string; tags?: string[] },
) {
  try {
    const res = await callInternalApi(
      '/api/v1/files',
      {
        fileId: input.noteId,
        name: input.title,
        textContent: input.content,
        ...toolAuthBody(options),
      },
      options.accessToken,
      options.baseUrl,
      { method: 'PATCH', forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Failed to update note' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Failed to update note' }
    }
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update note',
    }
  }
}

export async function executeDeleteNote(options: OverlayToolsOptions, input: { noteId: string }) {
  try {
    const url = options.baseUrl
      ? `${options.baseUrl}/api/v1/files?fileId=${encodeURIComponent(input.noteId.trim())}`
      : `/api/v1/files?fileId=${encodeURIComponent(input.noteId.trim())}`
    const serviceAuthHeader =
      options.serverSecret
        ? await buildServiceAuthToken({
            userId: options.userId,
            method: 'DELETE',
            path: '/api/v1/files',
          })
        : null
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        ...(serviceAuthHeader ? { [getServiceAuthHeaderName()]: serviceAuthHeader } : {}),
        ...(options.forwardCookie ? { Cookie: options.forwardCookie } : {}),
      },
      body: JSON.stringify({
        userId: options.userId,
        accessToken: options.accessToken,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Failed to delete note' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Failed to delete note' }
    }
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete note',
    }
  }
}
