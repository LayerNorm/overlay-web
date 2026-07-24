import { useCallback, useState, type CSSProperties } from 'react'
import { AlertCircle, Download, Play } from 'lucide-react'
import type { GenerationResult } from '@overlay/chat-core'

/** Single image/video cell: mesh placeholder while generating; crossfade to media after load. */
export function MediaSlotOutput({
  genType,
  isMulti,
  modelName,
  result,
}: {
  genType: 'image' | 'video'
  isMulti: boolean
  modelName: string
  result: GenerationResult | undefined
}) {
  const singleBoxStyle: CSSProperties | undefined =
    !isMulti
      ? genType === 'image'
        ? { width: 208, height: 208, minWidth: 208, minHeight: 208, boxSizing: 'border-box' }
        : { width: 288, height: 160, minWidth: 288, minHeight: 160, boxSizing: 'border-box' }
      : undefined

  const multiFrameClass =
    genType === 'image'
      ? 'h-[320px] w-full sm:h-[420px]'
      : 'h-[210px] w-full sm:h-[240px]'
  const errorFrameClass = isMulti ? `${multiFrameClass} flex items-center justify-center` : ''
  const multiStatusLabel = !result || result.status === 'generating'
    ? (genType === 'image' ? 'Creating image' : 'Creating video')
    : ''

  return (
    <div className={`flex min-w-0 flex-col ${isMulti ? 'w-full gap-1.5' : 'gap-2 self-start'}`}>
      {isMulti ? (
        <div className="h-5 text-xs font-medium text-(--muted)">
          {multiStatusLabel}
        </div>
      ) : (!result || result.status === 'generating') ? (
        <p className="text-xs font-medium text-(--muted)">
          {genType === 'image' ? 'Creating image' : 'Creating video'}
        </p>
      ) : null}

      {!result || result.status === 'generating' ? (
        <div
          className={`media-gen-mesh box-border shrink-0 overflow-hidden rounded-xl border border-[#e4e4e7] ${isMulti ? multiFrameClass : ''}`}
          style={singleBoxStyle}
          aria-hidden
        />
      ) : result.status !== 'completed' || !result.url ? (
        <div
          className={`rounded-xl border ${
            isMulti ? errorFrameClass : 'flex items-center gap-2 px-3 py-2 text-xs'
          }`}
          style={{
            ...(!isMulti ? singleBoxStyle : {}),
            background: 'var(--chat-media-error-bg)',
            borderColor: 'var(--chat-media-error-border)',
            color: 'var(--chat-alert-error-text)',
          }}
        >
          {isMulti ? (
            <div className="mx-auto flex max-w-[240px] flex-col items-center gap-2 px-5 text-center">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-(--surface-elevated) text-red-500 shadow-sm">
                <AlertCircle size={18} />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium" style={{ color: 'var(--chat-alert-error-text)' }}>
                  {result.upgradeRequired ? `${genType === 'image' ? 'Image' : 'Video'} generation requires a paid plan` : 'Generation failed'}
                </p>
                {result.upgradeRequired ? (
                  <p className="text-xs leading-relaxed opacity-90">
                    <a href="/pricing" className="underline underline-offset-2 hover:opacity-70">Upgrade here</a> to generate {genType === 'image' ? 'images' : 'videos'}.
                  </p>
                ) : (
                  <p className="text-xs leading-relaxed opacity-90">{result.error ?? 'Please try again.'}</p>
                )}
              </div>
            </div>
          ) : (
            <>
              <AlertCircle size={12} />
              {result.upgradeRequired
                ? <><span>{genType === 'image' ? 'Image' : 'Video'} generation requires a paid plan. </span><a href="/pricing" className="underline underline-offset-2 hover:opacity-70">Upgrade here</a></>
                : (result.error ?? 'Failed')
              }
            </>
          )}
        </div>
      ) : (
        <MediaCompletedReveal
          key={result.url}
          genType={genType}
          isMulti={isMulti}
          modelName={modelName}
          url={result.url}
        />
      )}
    </div>
  )
}

export function MediaCompletedReveal({
  genType,
  isMulti,
  modelName,
  url,
}: {
  genType: 'image' | 'video'
  isMulti: boolean
  modelName: string
  url: string
}) {
  const [ready, setReady] = useState(false)
  const frameClass =
    genType === 'image'
      ? isMulti
        ? 'h-[320px] w-full sm:h-[420px]'
        : ''
      : isMulti
        ? 'h-[210px] w-full sm:h-[240px]'
        : ''

  const singleBoxStyle: CSSProperties | undefined =
    !isMulti
      ? genType === 'image'
        ? { width: 208, height: 208, minWidth: 208, minHeight: 208, boxSizing: 'border-box' }
        : { width: 288, height: 160, minWidth: 288, minHeight: 160, boxSizing: 'border-box' }
      : undefined

  const markReady = useCallback(() => setReady(true), [])

  return (
    <div
      className={`relative group max-w-full shrink-0 overflow-hidden rounded-xl border border-(--border) bg-(--surface-muted) ${isMulti ? 'w-full' : ''} ${frameClass}`}
      style={singleBoxStyle}
    >
      <div
        className={`media-gen-mesh media-gen-mesh--fill pointer-events-none z-10 rounded-xl transition-opacity duration-300 ease-out ${
          ready ? 'opacity-0' : 'opacity-100'
        }`}
        aria-hidden
      />
      {genType === 'image' ? (
        <img
          src={url}
          alt={`Generated by ${modelName}`}
          onLoad={markReady}
          onError={markReady}
          className={`absolute inset-0 z-20 block h-full w-full rounded-xl transition-opacity duration-300 ease-out ${
            isMulti ? 'object-contain object-center' : 'border border-(--border) object-contain'
          } ${ready ? 'opacity-100' : 'opacity-0'}`}
        />
      ) : (
        <video
          src={url}
          controls
          preload="metadata"
          playsInline
          onLoadedData={markReady}
          onLoadedMetadata={markReady}
          onCanPlay={markReady}
          onError={markReady}
          className={`absolute inset-0 z-20 block h-full w-full rounded-xl ${isMulti ? 'object-contain object-center' : 'border border-(--border)'} transition-opacity duration-300 ease-out ${
            ready ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-16 bg-linear-to-b from-black/55 via-black/18 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
      <div className="absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-3 p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <span className="min-w-0 rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-medium leading-none text-white/95 backdrop-blur-[1px]">
          <span className="block truncate">{modelName}</span>
        </span>
        <a
          href={url}
          download={genType === 'image' ? 'generated.png' : 'generated.mp4'}
          className="pointer-events-auto shrink-0 rounded-full bg-(--glass-bg) p-1.5 shadow-sm transition-colors hover:bg-(--surface-elevated)"
          title="Download"
        >
          <Download size={13} className="text-(--foreground)" />
        </a>
      </div>
      {genType === 'video' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-300 ease-out group-hover:opacity-0">
          <span className={`inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white shadow-sm transition-opacity duration-300 ${
            ready ? 'opacity-100' : 'opacity-0'
          }`}>
            <Play size={16} fill="currentColor" />
          </span>
        </div>
      )}
    </div>
  )
}
