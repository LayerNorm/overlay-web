import React from 'react'
import type { Theme } from '../../constants/theme'
import { T } from '../shell/primitives'

export function WorkMarkdown({ text, theme }: { text: string; theme: Theme }) {
  return <T style={{ color: theme.muted, lineHeight: 22 }}>{text}</T>
}
