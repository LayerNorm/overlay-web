import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ChatErrorBoundaryProps {
  children: ReactNode
  fallbackTitle?: string
}

interface ChatErrorBoundaryState {
  hasError: boolean
  errorMessage: string
}

/**
 * Keeps chat render crashes local so a single bad message can't blank the whole
 * MainWindow under the root Sentry.ErrorBoundary.
 */
export class ChatErrorBoundary extends Component<ChatErrorBoundaryProps, ChatErrorBoundaryState> {
  state: ChatErrorBoundaryState = {
    hasError: false,
    errorMessage: ''
  }

  static getDerivedStateFromError(error: Error): ChatErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unknown chat error'
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ChatErrorBoundary] Chat surface crashed:', error, info.componentStack)
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, errorMessage: '' })
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          boxSizing: 'border-box'
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            borderRadius: 12,
            border: '1px solid rgba(128,128,128,0.25)',
            background: 'rgba(128,128,128,0.06)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            {this.props.fallbackTitle || 'Chat failed to render'}
          </div>
          <div
            style={{
              fontSize: 13,
              opacity: 0.75,
              lineHeight: 1.45,
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            Something went wrong while rendering this conversation. Retry to reload just the chat
            surface.
          </div>
          {this.state.errorMessage ? (
            <div
              style={{
                fontSize: 12,
                opacity: 0.55,
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                wordBreak: 'break-word'
              }}
            >
              {this.state.errorMessage}
            </div>
          ) : null}
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              alignSelf: 'flex-start',
              marginTop: 4,
              height: 32,
              padding: '0 12px',
              borderRadius: 8,
              border: '1px solid rgba(128,128,128,0.3)',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            Retry chat
          </button>
        </div>
      </div>
    )
  }
}
