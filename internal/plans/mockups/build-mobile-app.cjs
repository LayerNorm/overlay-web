/* eslint-disable @typescript-eslint/no-require-imports */
async function main() {
  const fs = require("node:fs");
  const path = require("node:path");
  const { build } = require("esbuild");
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const stem = path.join(__dirname, "mobile-app");
  const ui = path.resolve(__dirname, "../../../packages/overlay-ui/src");
  const exports = {
    "@overlay/ui": `export { cn } from '${ui}/utils/cn'`,
    "@overlay/ui/primitives": [
      "button",
      "sidebar",
      "popover",
      "panel-resize-handle",
    ]
      .map((n) => `export * from '${ui}/components/ui/${n}'`)
      .join("\n"),
    "@overlay/ui/overlays": `export { DelayedTooltip } from '${ui}/components/overlays/DelayedTooltip'`,
    "@overlay/ui/control-reset": `export * from '${ui}/control-reset'`,
  };
  const bundle = await build({
    entryPoints: [stem + ".tsx"],
    bundle: true,
    minify: true,
    write: false,
    outfile: stem + ".js",
    alias: { "@": path.resolve(__dirname, "../../../src") },
    plugins: [
      {
        name: "focused-ui",
        setup(b) {
          b.onResolve({ filter: /^@overlay\/ui(?:\/.*)?$/ }, (a) =>
            exports[a.path] ? { path: a.path, namespace: "ui" } : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "ui" }, (a) => ({
            contents: exports[a.path],
            resolveDir: ui,
          }));
        },
      },
    ],
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const source = fs
    .readFileSync(stem + ".css", "utf8")
    .replace(
      "@import 'tailwindcss'",
      `@import '${require.resolve("tailwindcss/index.css")}'`,
    );
  const css = await postcss([tailwind({ optimize: true })]).process(source, {
    from: stem + ".css",
  });
  const fonts = fs
    .readFileSync(path.join(__dirname, "agent-thread-activity.css"), "utf8")
    .match(/@font-face\{[^}]+\}/g)
    .join("\n");
  const componentCss = bundle.outputFiles
    .filter((f) => f.path.endsWith(".css"))
    .map((f) => f.text)
    .join("\n");
  const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
  fs.writeFileSync(
    stem + ".html",
    `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overlay mobile</title><style>${fonts}\n${css.css}\n${componentCss}</style></head><body><div id="root"></div><script>${js.replace(/<\//g, "<\\/")}</script></body></html>`.replace(/[\t ]+$/gm, ""),
  );
  console.log("Built internal/plans/mockups/mobile-app.html");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
