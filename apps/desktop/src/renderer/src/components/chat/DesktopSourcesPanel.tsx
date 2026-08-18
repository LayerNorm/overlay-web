import { useCallback, useMemo, type CSSProperties } from 'react'
import type { WebSourceItem } from '@overlay/chat-core'
import { SourcesPanel } from '@overlay/chat-react/sources-panel'
import type { PanelTheme } from '../../hooks/usePanelTheme'
import { panelThemeToSharedCssVars } from './themeBridge'

import overlayLogoUrl from '../../../../../resources/logos/overlay-chat-mark.png'

export interface DesktopSourcesPanelProps {
  open: boolean
  onClose: () => void
  sources: WebSourceItem[]
  theme: PanelTheme
}

export function DesktopSourcesPanel({
  open,
  onClose,
  sources,
  theme
}: DesktopSourcesPanelProps): React.ReactElement<any> {
  const scopeStyle = useMemo(() => panelThemeToSharedCssVars(theme, overlayLogoUrl), [theme])
  const openSource = useCallback((url: string) => {
    void window.bridge.openExternal(url)
  }, [])

  return (
    <div
      className="overlay-chat-surface shared-chat-scope contents"
      data-theme={theme.isDark ? 'dark' : 'light'}
      style={scopeStyle as CSSProperties}
    >
      <SourcesPanel
        open={open}
        onClose={onClose}
        onOpenSource={openSource}
        sources={sources}
        variant="inline"
      />
    </div>
  )
}
