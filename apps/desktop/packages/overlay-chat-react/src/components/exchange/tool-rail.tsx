import { OVERLAY_LOGO_SRC } from '@overlay/chat-core'
import React from 'react'
import { useChatReactConfig } from '../../context/chat-react-config'

export function ToolLineLogo() {
  const { toolLogoUrl } = useChatReactConfig()
  return (
    // Platform-neutral shared code cannot use Next.js Image in Electron.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={toolLogoUrl ?? OVERLAY_LOGO_SRC}
      alt=""
      width={8}
      height={8}
      className="mt-[5px] size-2 shrink-0 select-none"
      draggable={false}
    />
  )
}

/** Vertical connector between consecutive tool rows (logo stays top-aligned; line in logo column). */
export function ToolLogoColumn({
  connectTop,
  connectBottom
}: {
  connectTop: boolean
  connectBottom: boolean
}) {
  const showLine = connectTop || connectBottom
  const logoBottom = 'calc(0.3125rem + 0.5rem)' /* mt-[5px] + size-2 */
  return (
    <div className="relative flex w-2 shrink-0 flex-col items-center self-stretch">
      {showLine && (
        <div
          className="absolute left-1/2 z-0 w-px -translate-x-1/2 bg-[var(--surface-subtle)]"
          aria-hidden
          style={
            connectTop && connectBottom
              ? { top: 0, bottom: 0 }
              : connectTop
                ? { top: 0, height: logoBottom }
                : { top: logoBottom, bottom: 0 }
          }
        />
      )}
      <div className="relative z-[1] shrink-0 rounded-full bg-[var(--background)]">
        <ToolLineLogo />
      </div>
      <div className="min-h-0 flex-1" />
    </div>
  )
}

/**
 * Standalone reasoning block: while the reasoning part is actively streaming we auto-expand
 * and render the text through `MarkdownMessage` (same formatting as the main assistant reply).
 * Once the reasoning finishes we collapse to a single row with a chevron the user can toggle.
 */
