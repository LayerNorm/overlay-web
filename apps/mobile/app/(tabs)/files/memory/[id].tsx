import React from 'react'
import { SettingsEditorScreen } from '../../../../components/settings/SettingsEditors'

/** A memory opened from a chat citation: the same native editor as Settings › Memories. */
export default function MemoryDetailScreen(): React.ReactElement {
  return <SettingsEditorScreen editor="memory" />
}
