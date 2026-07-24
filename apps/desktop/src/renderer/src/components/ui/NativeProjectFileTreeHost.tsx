import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  NativeProjectFileTree,
  buildNativeProjectFileTree,
} from '@overlay/modules-react/projects'

export function NativeProjectFileTreeHost({
  workingFolder,
  modifiedFiles = new Set<string>(),
  onClose,
  onFileClick,
  isClosing = false,
}: {
  workingFolder: string
  modifiedFiles?: Set<string>
  onClose(): void
  onFileClick?(path: string): void
  isClosing?: boolean
}): React.ReactElement {
  const [paths, setPaths] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.bridge.workspace.listFiles(workingFolder)
      if (!result.success) throw new Error(result.error ?? 'Failed to list files')
      setPaths(result.paths)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [workingFolder])

  useEffect(() => { void load() }, [load])
  const nodes = useMemo(() => buildNativeProjectFileTree(paths), [paths])
  const label = workingFolder.split('/').filter(Boolean).at(-1) ?? workingFolder

  return (
    <NativeProjectFileTree
      label={label}
      nodes={nodes}
      modifiedPaths={modifiedFiles}
      loading={loading}
      error={error}
      closing={isClosing}
      onRefresh={() => { void load() }}
      onClose={onClose}
      onOpenFile={onFileClick}
    />
  )
}
