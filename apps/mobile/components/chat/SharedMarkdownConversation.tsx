import React from 'react'
import { View } from 'react-native'
import type { SharedMarkdownSnapshot } from '../../lib/sharedMarkdownBridge'
import { onNativeMarkdownCopy, onNativeMarkdownLink } from '../../services/sharedMarkdownDomActions'
import SharedMarkdownRenderer from './SharedMarkdownRenderer.dom'

export function SharedMarkdownConversation({ snapshot }: { snapshot: SharedMarkdownSnapshot }) {
  return (
    <View style={{ flex: 1 }}>
      <SharedMarkdownRenderer
        dom={{ style: { flex: 1 } }}
        snapshot={snapshot}
        onLink={onNativeMarkdownLink}
        onCopy={onNativeMarkdownCopy}
      />
    </View>
  )
}
