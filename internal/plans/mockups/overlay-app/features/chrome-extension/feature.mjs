// The Chrome extension's side panel (internal/plans/CHROME_EXTENSION_PARITY_PLAN.md): the production web app at
// side-panel width, with a thread in which Atlas uses the person's own Chrome (`chrome_browser` tool rows) and the
// proposed Settings → Browser. `chrome-extension.html` frames this output inside a Chrome window with the in-page
// consent bar, the "Atlas is using this tab" pill and the download confirmation.
//   MOCKUP_FEATURE=chrome-extension node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))
const fixtures = JSON.stringify(fileURLToPath(new URL('./fixtures.ts', import.meta.url)))

// Proposed production describer for `chrome_browser` rows: "Opened northwind-supply.example/orders", "Clicked “Export CSV”".
const DESCRIBER = `computer_screenshot: call => call.make(VERBS.screenshot),
  chrome_browser: (call) => {
    const action = inputString(call, 'action')
    const label = inputString(call, 'label')
    const url = inputString(call, 'url')
    const host = (value) => target(value.replace(/^https?:\\/\\//, '').replace(/\\/$/, ''))
    if ((action === 'new_tab' || action === 'navigate') && url) return call.make(VERBS.opened, { target: host(url), title: url })
    if (action === 'click') return call.make(tense('Clicking', 'Clicked'), label ? { target: '“' + clip(label, 48) + '”' } : { target: 'the page' })
    if (action === 'select') return call.make(tense('Choosing', 'Chose'), { target: inputString(call, 'value') ?? 'an option', ...(label ? { detail: 'in “' + label + '”' } : {}) })
    if (action === 'type' || action === 'fill_form') return call.make(tense('Typing', 'Typed'), { target: label ? 'in “' + clip(label, 48) + '”' : 'in the page' })
    if (action === 'download') {
      const name = typeof call.output?.filename === 'string' ? call.output.filename : undefined
      return call.make(tense('Downloading', 'Downloaded'), { target: name ? target(name) : 'a file' })
    }
    if (action === 'snapshot' || action === 'read_text') {
      const title = typeof call.output?.title === 'string' ? call.output.title : undefined
      return call.make(VERBS.read, { target: title ? target(title) : 'the page' })
    }
    if (action === 'back') return call.make(tense('Going back', 'Went back'))
    if (action === 'screenshot') return call.make(VERBS.screenshot)
    return null
  },`

export default {
  out: 'chrome-extension-app.html',
  title: 'Overlay | Chrome side panel mockup',
  patches: [
    {
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installChromeExtensionFixtures } from ${fixtures}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallChromeExtensionFixtures()\n']],
    },
    {
      file: 'packages/overlay-chat-core/src/tool-call-description.ts',
      replace: [['computer_screenshot: call => call.make(VERBS.screenshot),', DESCRIBER]],
    },
    {
      // Settings → Browser appears only inside the extension's side panel; the mockup always shows it.
      file: 'src/app/app/settings/page.tsx',
      imports: `import { ChromeBrowserSettings } from ${components}\n`,
      replace: [
        ["if (section === 'desktop') return <DesktopSettings />", "if (section === 'desktop') return <DesktopSettings />\n  if (section === 'browser') return <ChromeBrowserSettings />"],
        [
          "const sections = useMemo(() => desktop ? [...appShell.settingsSections, { id: 'desktop', label: 'Desktop', icon: 'laptop' }] : appShell.settingsSections, [appShell.settingsSections, desktop])",
          "const sections = useMemo(() => [...appShell.settingsSections, { id: 'browser', label: 'Browser', icon: 'chrome' }], [appShell.settingsSections, desktop])",
        ],
      ],
    },
    {
      file: 'src/components/layout/sidebar/useAppSidebarState.ts',
      replace: [[
        "[...appShell.settingsSections, ...(desktop ? [{ id: 'desktop', label: 'Desktop', icon: 'laptop' as const, order: 100 }] : [])]",
        "[...appShell.settingsSections, { id: 'browser', label: 'Browser', icon: 'chrome' as const, order: 100 }]",
      ]],
    },
  ],
}
