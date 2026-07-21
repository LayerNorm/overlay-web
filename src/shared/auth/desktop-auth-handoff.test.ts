import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidDesktopCodeChallenge,
  shouldReuseExistingWebSession,
  shouldStartDesktopHandoff,
} from "./desktop-auth-handoff";

const VALID_CHALLENGE = "A".repeat(43);

test("an existing web session continues without showing sign-in again", () => {
  assert.equal(
    shouldReuseExistingWebSession({
      authLoading: false,
      isAuthenticated: true,
      forceLogin: false,
      isDirectDesktopCallback: false,
    }),
    true,
  );

  assert.equal(
    shouldReuseExistingWebSession({
      authLoading: false,
      isAuthenticated: true,
      forceLogin: true,
      isDirectDesktopCallback: false,
    }),
    false,
  );
});

test("desktop handoff starts only after the authenticated session is ready", () => {
  assert.equal(
    shouldStartDesktopHandoff({
      codeChallenge: VALID_CHALLENGE,
      isAuthenticated: true,
      userId: "user_12345",
      sessionCheckComplete: true,
    }),
    true,
  );

  assert.equal(
    shouldStartDesktopHandoff({
      codeChallenge: VALID_CHALLENGE,
      isAuthenticated: true,
      userId: "user_12345",
      sessionCheckComplete: false,
    }),
    false,
  );
});

test("desktop handoff rejects missing or malformed PKCE challenges", () => {
  assert.equal(isValidDesktopCodeChallenge(VALID_CHALLENGE), true);
  assert.equal(isValidDesktopCodeChallenge("too-short"), false);
});
