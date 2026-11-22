# Launch plumbing

iOS uses `overlay.works` for production sign-in and universal links.
The native link parser also recognizes links from the former domains and the
`overlay` scheme. Unknown destinations return home. Automation details and
Settings subsections map to the current query-based screens.

The production Apple association on `overlay.works` lists
`562STT95YC.com.layernorm.overlay-mobile` for the native auth callback.
Check both the signed app entitlement and the served association before testing
a new build. The old hosts redirect, and the production association currently
covers the auth callback only. Android keeps `com.layernorm.overlay_mobile`.
Android link verification needs the release signing certificate fingerprints
in the web deployment's `ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS` setting.

EAS project `268cf4d6-4a66-43bc-88cd-8b308a53c2ff` is owned by `layernorm-inc`
and targets App Store Connect app `6765998182`. Production builds use the
public `EXPO_PUBLIC_AUTH_BASE_URL` and `EXPO_PUBLIC_CONVEX_URL` values from the
project's production EAS environment. Set the equivalent development and Preview
values to their own backends. Remote EAS versioning increments the iOS build
number. The marketing version is set in app.json.

The tracked iOS project retains camera/photo/microphone strings and its existing
required-reason privacy manifest; app.json now declares the same needs for
generated projects. Notification authorization uses expo-notifications' runtime
permission dialog, not a nonexistent iOS notification usage-description key.
Privacy/App Store data-collection disclosures require owner review against the
actual backend; the existing manifest's empty collected-data declaration is not
a claim that server-side chat/account data is never collected.

The standalone EAS archive omits the parent web checkout. Its pre-install hook
fetches the same pinned web SHA, installs/builds its packages, and links the
required parent directories without replacing existing paths. Configure the
read-only OVERLAY_WEB_READ_TOKEN only if the pinned repository requires
authentication. The current public pin can be fetched anonymously. Existing
nested local and CI checkouts skip this fetch. A native entitlement change
requires a new signed build.

Full legacy ESLint currently has seven errors in four unchanged files. CI runs
all source lint and allows those exact rules/counts only while each file's SHA-256
matches scripts/lint-baseline.json; changing such a file requires fixing its
errors. No rules are disabled globally. Warnings remain visible as a count.

CI checks out web as the parent directory (not a sibling to the mobile root),
builds workspace package entrypoints, then installs and checks mobile. It pins
web to the push backend SHA because main does not yet contain that native API
and portability fix. Advance this tested SHA after web changes merge. If web is
private, provision OVERLAY_WEB_READ_TOKEN with read-only repository access;
the mobile GITHUB_TOKEN cannot read another private repository. Fork PRs will
not have this secret and need an owner-run validation. No EAS credentials in CI.

Checks: npm run check; node --test scripts/*.test.cjs; targeted eslint;
Expo android/ios export --source-maps --no-bytecode; scripts/inspect-bundles.cjs.
Owner/device acceptance: install signed apps and open each linked surface on the
www host with cold/warm app, signed-out and signed-in states, and confirm resource
access-denied states. Verify Apple association and Android app-link verification
after deployment. Local exports do not prove OS-level signed app associations.

When this Mac lacks storage for Pods and DerivedData, the
`simulator-smoke` EAS profile builds an installable iOS Simulator app with
the production bundle configuration. Verify its exact commit in EAS before
installing it. It inherits the production URLs for signed-out startup smoke.
Use a current isolated backend for authenticated acceptance.

The existing development client can run the Work fixture on iOS using
`scripts/serve-native-shell-preview.cjs` with `platform=ios&screen=work-list`.
Use it to check board ordering and date editing with disposable tasks.
It does not exercise Convex writes or workspace permissions.

For simulator acceptance, use a current isolated backend and confirm sign-in,
workspace switching and Work in both themes. Verify that Board columns respect
the selected filter, that Timeline spans clip at week boundaries, and that both
views open the correct task. Test a release-configured build and cold-launch
the native auth callback. Check the read-only computer preview with a running agent computer in the
isolated backend. Verify that touch cannot control the remote desktop and that
closing, backgrounding, or stream expiry removes the preview. Do not record
desktop ticket URLs in screenshots or logs. Check that a permitted editor can
start and stop the isolated computer and that observers only see status and preview.
After acceptance, verify the signed IPA bundle ID,
embedded version and build number, signature and JavaScript bundle before
submitting the exact IPA to Apple. Confirm processing and internal TestFlight
availability in App Store Connect.
