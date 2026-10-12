/**
 * Runs before first paint to apply the saved light/dark theme. It is inlined in the root layout, which prerenders into
 * the static shell, so under the nonce-based CSP it can only run if its hash is allowed (`INLINE_SCRIPT_HASHES` in
 * `src/proxy.ts`). Editing this text changes the hash; the CSP test fails until the hash is updated.
 */
export const THEME_INIT_SCRIPT = `
              (function () {
                try {
                  var raw = window.localStorage.getItem('overlay.app.settings');
                  if (!raw) return;
                  var theme = JSON.parse(raw).theme;
                  if (theme === 'light' || theme === 'dark') {
                    document.documentElement.dataset.theme = theme;
                    document.documentElement.style.colorScheme = theme;
                  }
                } catch (_) {}
              })();
            `
