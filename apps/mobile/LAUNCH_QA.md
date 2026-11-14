# Launch plumbing

Universal links use Expo Router's `+native-intent` for cold and warm launches.
Only getoverlay.io/www.getoverlay.io HTTPS links and the overlay scheme are
accepted. Unknown destinations return home. Automation detail and Settings
subsection paths map to the current query-based screens. Existing WorkOS callback,
invitation, share, dictate and MCP destinations remain supported.

Deploy the matching web associations on the canonical www host before installing signed
builds. iOS keeps team 562STT95YC and bundle com.layernorm.overlay-mobile;
Android keeps com.layernorm.overlay_mobile (assetlinks formerly used a hyphen).
Android assetlinks has no path list: restrictions live in autoVerify intent filters.
Configure ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS with the Play app-signing
certificate and any internal distribution certificates on the web deployment.

EAS configuration declares project 268cf4d6-4a66-43bc-88cd-8b308a53c2ff, owner layernorm-inc,
and App Store ID 6765998182. Confirm owner access and Apple's team before builds.
Set EXPO_PUBLIC_CONVEX_URL and EXPO_PUBLIC_AUTH_BASE_URL separately in EAS
development, preview and production environments; never copy production secrets
to Preview. Public URL variables should be plaintext EAS variables, available
during config evaluation. No Convex production fallback is supplied.
Remote EAS versioning increments preview/production build numbers; release
marketing version still lives in app.json. No build or submission was run.

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
read-only OVERLAY_WEB_READ_TOKEN as a secret in each EAS environment for private
web access. Existing nested local/CI checkouts skip this fetch. Remote EAS build
and Apple/Google signing are deliberately untested here; native entitlement
changes require a new signed build, not an OTA update.

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

Live inspection: www serves both association endpoints with HTTP 200; apex
getoverlay.io redirects them with HTTP 307. Only www is claimed in native
association configuration. Supporting apex links directly requires removing
that association-path redirect at hosting level before adding apex entitlements
and verified intent filters. The parser still accepts manually forwarded apex
links. Workspace query parameters activate the member's workspace through the
existing context; failures use a calm alert.
