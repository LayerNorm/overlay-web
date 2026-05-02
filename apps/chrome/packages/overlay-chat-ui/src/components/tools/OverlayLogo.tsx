/** 16×16 overlay mark for tool-call rails (extension uses `/overlay-logo.png`). */
export const OVERLAY_LOGO_SRC = '/overlay-logo.png'

export function ToolLineLogo() {
  return (
    <img
      src={OVERLAY_LOGO_SRC}
      alt=""
      width={16}
      height={16}
      className="mt-0.5 size-4 shrink-0 select-none"
      draggable={false}
    />
  )
}

/** Vertical connector between consecutive tool rows. */
export function ToolLogoColumn({ connectTop, connectBottom }: { connectTop: boolean; connectBottom: boolean }) {
  const showLine = connectTop || connectBottom
  const logoBottom = 'calc(0.125rem + 1rem)'
  return (
    <div className="relative flex w-4 shrink-0 flex-col items-center self-stretch">
      {showLine ? (
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
      ) : null}
      <div className="relative z-[1] shrink-0 rounded-full bg-[var(--background)] p-px">
        <ToolLineLogo />
      </div>
      <div className="min-h-0 flex-1" />
    </div>
  )
}
