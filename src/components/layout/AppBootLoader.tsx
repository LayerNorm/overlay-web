import { Loader2 } from 'lucide-react'
import { OverlayMark } from '@/components/orb/Orb'

/**
 * Unified app boot loader: the brand lockup appears once (mark fades in, word
 * reveals from behind it), then the whole lockup breathes like the chat stream
 * marker, with the "Opening workspace…" line beneath on the same screen.
 *
 * `settled` renders the identical screen with the entrance already played;
 * the workspace-hydration gate uses it so handing off from the animated boot
 * loader shows no re-flash.
 */
export function AppBootLoader({ settled = false }: { settled?: boolean }) {
  return (
    <div className="flex h-screen items-center justify-center overflow-hidden bg-background text-foreground">
      <div
        className={`flex flex-col items-center${settled ? ' app-brand-loader--steady' : ''}`}
      >
        <div className="app-brand-loader-pulse">
          <div
            className="app-brand-loader flex items-center"
            role="status"
            aria-label="Loading overlay"
          >
            <span className="app-brand-loader-logo relative z-10 flex items-center bg-background">
              <OverlayMark size={18} />
            </span>
            <span className="ml-2 overflow-hidden py-1">
              <span
                className="app-brand-loader-word block text-2xl font-medium tracking-tight"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                overlay
              </span>
            </span>
          </div>
        </div>
        <div className="app-brand-loader-wsline mt-[30px] flex items-center text-sm text-muted">
          <Loader2 size={16} className="mr-2 animate-spin" />
          <span>Opening workspace&hellip;</span>
        </div>
      </div>
    </div>
  )
}
