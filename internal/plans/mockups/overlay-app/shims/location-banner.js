/**
 * The mockup keeps the app URL in the hash, so it opens from disk. App code that reads
 * window.location directly is compiled to read this object instead (see the build's define map).
 */
;(function () {
  var ORIGIN = 'https://mockup.overlay'
  function appHref() {
    var raw = globalThis.location.hash.slice(1)
    return raw.charAt(0) === '/' ? raw : '/app/work'
  }
  function appUrl() {
    return new URL(appHref(), ORIGIN)
  }
  function go(target, replace) {
    var url = new URL(String(target), appUrl())
    if (url.origin !== ORIGIN) return
    var next = '#' + url.pathname + url.search
    if (replace) globalThis.history.replaceState(null, '', next)
    else globalThis.history.pushState(null, '', next)
    globalThis.dispatchEvent(new PopStateEvent('popstate'))
  }
  globalThis.__mockupLocation = {
    get pathname() { return appUrl().pathname },
    get search() { return appUrl().search },
    get hash() { return '' },
    get origin() { return ORIGIN },
    get host() { return 'mockup.overlay' },
    get hostname() { return 'mockup.overlay' },
    get protocol() { return 'https:' },
    get href() { return appUrl().href },
    set href(value) { go(value, false) },
    assign: function (value) { go(value, false) },
    replace: function (value) { go(value, true) },
    reload: function () {},
    toString: function () { return appUrl().href },
  }
})();
