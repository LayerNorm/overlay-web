import React from 'react'
import { NotesEditorScreen } from '../../components/notes/NotesEditorScreen'
import { useWorkspace } from '../../contexts/WorkspaceContext'

export default function NotesTabScreen(): React.ReactElement {
  const { activeWorkspaceId } = useWorkspace()
  return <NotesEditorScreen key={activeWorkspaceId} />
}
