'use client'

import { useMemo } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  createFixtureKnowledgeSurfaceAdapters,
  type KnowledgeSurfaceAdapters,
} from '@overlay/app-core'
import {
  FileViewer,
  SharedKnowledgeSurface,
  isEditableType,
} from '@overlay/modules-react/knowledge'
import { useGuestGate } from '@/components/providers/GuestGateProvider'
import { SHOWCASE_KNOWLEDGE_NODES } from './showcase-data'

export function PublicShowcaseKnowledgeView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { requireAuth } = useGuestGate()

  const adapters = useMemo<KnowledgeSurfaceAdapters>(() => {
    const fixture = createFixtureKnowledgeSurfaceAdapters({ nodes: SHOWCASE_KNOWLEDGE_NODES })
    const gated = async (): Promise<never> => {
      requireAuth('nav')
      throw new Error('Sign in to change this workspace.')
    }
    return {
      ...fixture,
      repository: {
        ...fixture.repository,
        create: gated,
        rename: gated,
        move: gated,
        delete: gated,
        upload: gated,
      },
    }
  }, [requireAuth])

  const route = useMemo(() => ({
    file: searchParams?.get('file') ?? null,
    memory: null,
    folder: searchParams?.get('folder') ?? null,
    view: searchParams?.get('view') ?? null,
    layout: searchParams?.get('layout') ?? null,
    outputFilter: searchParams?.get('out') ?? null,
  }), [searchParams])

  return (
    <SharedKnowledgeSurface
      mode="files"
      initialFiles={SHOWCASE_KNOWLEDGE_NODES}
      initialMemories={[]}
      route={route}
      onUpdateQuery={(updates) => {
        const params = new URLSearchParams(searchParams?.toString() ?? '')
        params.set('showcase', '1')
        for (const [key, value] of Object.entries(updates)) {
          if (value === null || value === undefined || value === '') params.delete(key)
          else params.set(key, value)
        }
        window.history.pushState(null, '', `${pathname}?${params.toString()}`)
      }}
      adapters={adapters}
      memories={{
        list: async () => [],
        create: async () => {
          requireAuth('nav')
          return { ok: false, error: 'Sign in to save memories.' }
        },
        delete: async () => {
          requireAuth('nav')
          return false
        },
      }}
      files={{
        saveContent: async () => {
          requireAuth('nav')
          return false
        },
        upload: async () => {
          requireAuth('nav')
          return { ok: false, error: 'Sign in to upload files.' }
        },
        isEditable: isEditableType,
        contentUrl: (file) => file.downloadUrl,
        entityChanged: () => {},
      }}
      renderFileViewer={({ file, name, content, url }) => (
        <FileViewer
          name={name}
          content={content}
          url={url ?? file.downloadUrl}
        />
      )}
    />
  )
}
