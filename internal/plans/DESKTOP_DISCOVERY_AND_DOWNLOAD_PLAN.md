# Desktop discovery and download

Status: Phases 1 and 2 merged, deployed and verified in production on 2026-11-17. Phases 3 and 4 not started.

How a visitor learns that Overlay has a Mac app, and how they go from that to a
signed-in app on their computer. Mockup:
[mockups/desktop-discovery.html](mockups/desktop-discovery.html) (rebuild with
`node internal/plans/mockups/build-desktop-discovery.mjs`). It is the live
marketing page with the proposed changes applied; the bar at the bottom switches
page and visitor and can outline everything that is new, and the page's own
theme button switches light and dark.

## Where things stand

- Overlay Desktop 0.3.1 is published as a signed, notarized macOS build on the
  public desktop repository's GitHub Releases.
- `/download` is on in production and its button resolves to the newest
  installer.
- Before this plan nothing on the site linked to `/download`; a visitor found
  the app only by knowing the address.
- The app is for Macs with Apple silicon. There is no Intel, Windows or Linux
  build.

## Decisions proposed

1. **One destination.** Every entry point leads to `/download`. The file itself
   is never linked from anywhere else, so the install steps and requirements are
   always on screen when a download starts.
2. **One click.** A button that says "Download for Mac" starts the download and
   lands on the install steps. A link that says "Download" (navigation, footer)
   opens the page without starting anything.
3. **Only offer it where it works.** The hero offers the download to Mac
   visitors. Everyone else keeps "Star on GitHub" and is told plainly, on the
   download page, that the app is for Mac and that the web app works everywhere.
4. **Say what it is for.** The landing section describes what the desktop app
   adds that a browser can't: threads on your own computer in folders you
   choose, dictation into any app, and chat over any window.
5. **No new design language.** Everything reuses the landing page's existing
   sections, cards, buttons and type.
6. **The Apple logo marks the download.** Every "Download for Mac" button
   carries the Apple mark from the landing page's logo set, in the button's text
   colour.

## Discovery on the landing page

| Place | Change | Who sees it |
| --- | --- | --- |
| Top navigation | "Download" after Blog | Everyone on wide screens |
| Hero buttons | "Download for Mac" beside "Get started", in place of "Star on GitHub" | Mac visitors |
| New section "Overlay for Mac" | After "One place to get things done": headline, one sentence, download button, requirement line, and a small card showing This computer, a working folder, dictation and the chat panel | Everyone |
| "Hire your first AI employee" card | The Web column becomes "Web and Mac": Get started, Download for Mac | Everyone |
| Footer, Product column | "Desktop app" | Everyone |

The GitHub link stays in the navigation for all visitors, so the hero swap does
not remove it from the page.

## Download flow

**Mac visitor**

1. Clicks "Download for Mac" anywhere. The browser opens `/download?start=1`.
2. The page starts the download and reads "Your download has started", with the
   file name and "Download again".
3. "Install in three steps" sits directly below: open the download, drag Overlay
   to Applications, open Overlay and sign in.
4. Sign-in opens in the browser and returns to the app.

Arriving at `/download` without `start=1` shows the same page with the
"Download for Mac" button and the same three steps.

**Windows, Linux or phone visitor**

The page says the app is for Mac with Apple silicon, offers "Open Overlay in
your browser" as the main button, and "Copy link for your Mac" beside it. No
install steps are shown.

**If the release can't be loaded**

Keep today's behaviour: the page says so and links to GitHub Releases.

## How the page knows the visitor's computer

The marketing pages are static, so the choice is made in the browser before the
first paint, the same way the landing theme is: a small inline script sets a
platform attribute on the page, both hero buttons are in the markup, and CSS
shows one. Without JavaScript the hero shows "Star on GitHub" and the download
page shows the Mac version.

An Intel Mac can't be told apart from an Apple silicon Mac reliably, so the
requirement is stated in the version line on every download button's page
rather than detected.

## Discovery inside the web app (after the landing page)

These are the moments someone is already looking for the desktop app:

- **A thread's computer menu in a browser.** "This computer" is listed with
  "Needs the desktop app" and a Download link, instead of being absent.
- **A local thread opened in a browser.** The read-only notice gains "Get the
  desktop app" for people who don't have it on that computer.
- **Settings.** A "Desktop app" row with the version and the download link.

These need their own mockup in the app shell before they are built.

## What to measure

Three events, each with where the click came from (navigation, hero, section,
card, footer, in-app):

- Download button clicked.
- Download page opened, with the visitor's platform.
- First sign-in from the desktop app.

The first and last together say how many people who start a download end up
using the app.

## Known gaps to close before promoting the app widely

- **Node.js.** Release 0.3.0 needed Node.js installed to run a thread on this
  computer. Release 0.3.1, published 2026-11-17, ships the Agent Host and its
  own Node.js runtime inside the app. Checked on the published signed,
  notarized build: the bundled host starts with no Node.js on the path. Not
  yet checked: a real thread run from the installed 0.3.1 app. The download
  grew from about 131 MB to about 170 MB.
- **Installer notarization.** The app inside the installer is notarized; the
  disk image itself is not stapled, so the first open needs a network
  connection.
- **Releases need the owner.** The `v*` tag for a release must be created by a
  repository owner before the publish step can attach files to it.
- **Apple silicon only (decided 2026-11-17).** The app stays Apple silicon only
  for now. An Intel Mac owner can still download a build that won't open, so the
  requirement is stated beside every download button. If Intel is added later,
  it is one universal installer, not a second download.

## Phases

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Publish the signed build; turn on `/download` in production | Done |
| 1 | Landing page: navigation, hero, "Overlay for Mac" section, card row, footer | Merged and live. Verified on the PR preview and in production |
| 2 | Download page: one-click start, "Your download has started", install steps, non-Mac page | Merged and live. One-click start verified on the PR preview; in production the page, button target and release data were checked without starting a download. Not tested in Safari, Firefox or on real non-Mac devices |
| 3 | Measurement events | Not started |
| 4 | In-app entry points | Needs a mockup |

## Built as mocked up (2026-11-17)

The owner approved building the mockup as shown, which settles three choices
that can be revisited:

1. Mac visitors see "Download for Mac" in the hero in place of "Star on GitHub".
2. The landing section leads with running threads on your own computer, before
   the app bundles its own runtime.
3. "Download" is a fifth link in the top navigation.

Two details differ from the first mockup:

- `/download` is always a page. With `OVERLAY_DESKTOP_DOWNLOADS_ENABLED` off it
  points to the source repository instead of redirecting to the home page, so
  the new links never lead nowhere on a self-hosted site.
- The landing section's small line reads "Apple silicon · Open source" without a
  version, because the home page is static; the version is on the download page.
