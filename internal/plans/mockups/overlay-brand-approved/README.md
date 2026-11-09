# Overlay approved brand assets

The approved wordmark uses Libre Baskerville Regular glyph outlines. Its O has
Overlay's eyes and is enlarged by 5% around its bottom center. The gap between
the O and v includes an extra 3 px at the mockup's 40 px font size, scaling
proportionally with the wordmark. The O and its eyes sit 2 px lower at that same
40 px size; the remaining letters stay fixed. The standalone icon stays centered.
No installed font
is needed to render the SVG assets.

- `overlay-wordmark.svg`: full wordmark, inheriting `currentColor` when inlined.
- `overlay-icon.svg`: standalone Overlay identity, using exactly the same O and eyes.
- `*-black.svg` / `*-white.svg`: explicit colors for use as images.
- `*-black.png` / `*-white.png`: transparent raster exports. Wordmarks are 2400 px
  wide; icons are 1024 px square.

Use black on light backgrounds and white on dark backgrounds. Prefer SVG whenever
possible. Scale proportionally; do not stretch, separately resize the O, or change
letter spacing. Transparent padding prevents the enlarged O from being clipped.

The static assets do not animate. In the loading mockup, only the nested
`brand-eyes` group moves, using the production chat-thread eye motion: 2.4 seconds,
ease-in-out, horizontally from center to -95 to +95 font units and back. Reduced
motion disables it. The O body and wordmark stay fixed.

The full wordmark and standalone icon are the shared visual source for future
product adoption. This asset pack and mockup do not deploy changes to the app.

Font outlines are derived from the repository's Libre Baskerville Regular font;
its license is included as `FONT-LICENSE.txt`.
