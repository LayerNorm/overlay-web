# Native sign-in repair

The sign-in entry still used `buildCustomAuthUrl` and `consumeTransferToken`, including at Phase 2a (`f78639e`) and its shell predecessor (`617feb6`). The startup/401 commit `350b030` changed neither that entry nor API base configuration.

The desktop-link endpoint is still present in web source. An unauthenticated GET to the PR469 Preview with a bogus token and verifier received a Vercel Authentication redirect, not an application response. Following redirects returned HTTP 200 `text/html` after two redirects. `consumeTransferToken` previously parsed every successful response as JSON, explaining the reported `<` parse error on this reachable protected path. The native authorize POST also currently receives HTTP 401 from deployment protection, so successful live sign-in cannot be claimed until the QA app can access the Preview's native auth APIs. No protection was bypassed or disabled.

There was also a separate API-base configuration defect: `appConfig.ts` used a dynamic `globalThis.process?.env[name]` lookup, which Expo cannot inline. The inspected Metro manifest had no `extra.authBaseUrl` override. The public auth URL now uses Expo's supported literal `process.env.EXPO_PUBLIC_AUTH_BASE_URL` form so the configured Preview URL is embedded rather than silently falling back to production. No environment values were changed.

Fresh sign-in now uses `/api/auth/native/authorize` with `authkit`, a generated PKCE verifier/challenge and state, and the selected server's `/auth/native/callback` redirect. It opens only the expected WorkOS authorization origin/path. Both `overlay://auth/callback` and the selected server's HTTPS callback are accepted; other server origins are rejected. Code exchange uses `/api/auth/native/exchange` and the stored verifier. Browser-result and Linking deliveries share one completion, including a repeated delivery after exchange, so a one-use code is not redeemed twice. A new sign-in or sign-out clears that completion, and a stale exchange cannot delete another pending sign-in.

Legacy transfer callbacks remain compatible but validate JSON before deleting their verifier. Both callback screens offer a retry route instead of an indefinite error spinner.

Acceptance after the QA Preview's native APIs are reachable:

1. Clear app data; tap Continue to sign in. The first native API request must target the selected Preview's `/api/auth/native/authorize`, not `/auth/sign-in` or `/api/auth/desktop-link`.
2. Complete hosted credentials. The callback should carry `code` and `state`, not a transfer token.
3. Confirm one native exchange, local session persistence, and normal bootstrap. Repeat on a cold-start callback and with browser/Linking duplicate delivery.
4. Cancel, return an authorization error, or deny server access: the app must recover to sign-in or show Try again, never a raw JSON parser error or an indefinite Finishing sign-in state.

Metro 8085, environment values, Preview data and the unrelated untracked Android directory were not changed. Live hosted sign-in and device rendering remain unverified.
