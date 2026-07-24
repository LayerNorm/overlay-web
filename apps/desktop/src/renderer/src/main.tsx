import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Tailwind utilities + shared @overlay/chat-react component styles (scoped).
// Preflight is disabled; resets are scoped to .shared-chat-scope.
import './styles/shared-chat.css'

const fixtureWindow = new URLSearchParams(window.location.search).get('window')
const isChatParityFixture = import.meta.env.DEV && fixtureWindow === 'chat-parity-fixture'
const isFileParityFixture = import.meta.env.DEV && fixtureWindow === 'file-parity-fixture'

// Global font-family fallback so the whole desktop UI uses the system font
// instead of falling back to Times New Roman when inline styles are missing.
const GLOBAL_FONT_CSS = `
html, body, #root {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
`
const globalStyleSheet = document.createElement('style')
globalStyleSheet.textContent = GLOBAL_FONT_CSS
document.head.appendChild(globalStyleSheet)
// Shared components use root-relative assets on the web. In Electron they must
// resolve beside the packaged renderer HTML, so the shared asset helper reads
// this host-provided base instead of embedding platform-specific imports.
document.documentElement.dataset.overlayAssetBase = '.'

const root = createRoot(document.getElementById('root')!)

if (isFileParityFixture) {
  void import('./pages/FileParityFixtureWindow').then(({ FileParityFixtureWindow }) => {
    root.render(<FileParityFixtureWindow />)
  })
} else if (isChatParityFixture) {
  void Promise.all([
    import('./pages/ChatParityFixtureWindow'),
    import('./styles/chat-parity-fixture.css')
  ]).then(([{ ChatParityFixtureWindow }]) => {
    root.render(
      <StrictMode>
        <ChatParityFixtureWindow />
      </StrictMode>
    )
  })
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
