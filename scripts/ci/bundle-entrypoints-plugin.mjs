export class BundleEntrypointsPlugin {
  apply(compiler) {
    const name = 'OverlayBundleEntrypoints'
    compiler.hooks.thisCompilation.tap(name, compilation => {
      compilation.hooks.processAssets.tap({
        name, stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
      }, () => {
        const entries = Object.fromEntries([...compilation.entrypoints].map(([entry, value]) => [
          entry, value.getFiles().filter(file => file.endsWith('.js') && !file.endsWith('.hot-update.js')),
        ]))
        compilation.emitAsset('analyze/entrypoints.json', new compiler.webpack.sources.RawSource(
          JSON.stringify({ version: 1, entries }),
        ))
      })
    })
  }
}
