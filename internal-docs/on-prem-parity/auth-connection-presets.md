# Auth Connection Presets

## Current implementation scope

Overlay will support four Better Auth connection presets in the first release:

| Preset | Protocol | Priority reason |
| --- | --- | --- |
| `google-workspace` | OIDC | Primary JPGS requirement and a common education/customer identity system. |
| `auth0` | OIDC | Preserves the provider used for the existing Better Auth staging and regression flow. |
| `entra-id` | OIDC | Covers the most common Microsoft enterprise identity deployment. |
| `generic-oidc` | OIDC | Provides a standards-based escape hatch for compatible providers without adding vendor-specific code. |

Presets provide vendor defaults such as issuer, discovery behavior, display label,
and claim mapping. A deployment creates its own stable connection ID, for example
`primary-sso`; customer names are not shipped as product defaults.

The first release is limited to statically configured Better Auth connections.
It does not include self-service connection registration or a dynamic identity
administration console.

## Implementation plan

### Phase 1: Connection and policy contracts (implemented)

Add a canonical `auth.betterAuth.connections` array while retaining
`auth.provider="better-auth"`. Renaming `auth.provider` to `auth.backend` is
conceptually cleaner but is deferred because it would create unrelated config,
fixture, deployment, and documentation churn.

Each connection contains:

- A deployment-owned, URL-safe, immutable `id`, such as `primary-sso`.
- One of the four supported `preset` values.
- An optional customer-facing `label`.
- One or more routing `domains`.
- Provider-specific metadata such as issuer URL or Entra tenant ID.
- Client credentials supplied directly by environment overrides or referenced
  through named environment variables in deployment config.

Add a separate Better Auth access policy with:

- `requireVerifiedEmail`, defaulting to `true`.
- `allowedEmailDomains`, required for enterprise on-prem deployments.
- Explicit denial when a verified identity does not satisfy the policy.

Validate unique connection IDs, valid domain names, supported presets, required
provider fields, and credential references. Redacted config output must never
contain client secrets.

Preserve the existing `BETTER_AUTH_DEFAULT_SSO_*` and `BETTER_AUTH_OIDC_*`
variables by translating them into one legacy `generic-oidc` connection. New
single-connection environment variables should use neutral `CONNECTION` naming;
the array in `overlay.config.json` is the canonical multi-connection format.

Acceptance:

- Existing WorkOS and Better Auth configurations still parse unchanged.
- Invalid or duplicate connections fail startup configuration validation.
- Legacy Better Auth environments resolve to the same callback provider ID.
- Config diagnostics expose connection IDs and presets but redact credentials.

### Phase 2: Preset registry (implemented)

Create a small connection layer under `src/server/auth/connections/`:

- Shared OIDC connection and resolved-connection contracts.
- A preset registry with no vendor branching in the Better Auth core.
- `google-workspace`, `auth0`, `entra-id`, and `generic-oidc` resolver modules.

Preset behavior:

- `google-workspace` supplies Google's issuer and discovery endpoint and uses
  `openid email profile` scopes.
- `auth0` requires the tenant or custom-domain issuer and supplies Auth0 display
  defaults without assuming a development tenant.
- `entra-id` requires a tenant-specific identifier or issuer and rejects the
  consumer/common tenant in enterprise-restricted mode.
- `generic-oidc` requires an explicit issuer and uses standards-based discovery.

All presets produce the same resolved OIDC structure consumed by Better Auth.
Provider-specific defaults must remain overridable only where doing so is safe.

Acceptance:

- Unit tests cover defaults, required fields, discovery URLs, domains, scopes,
  labels, and trusted origins for all four presets.
- No customer name or customer domain exists in a shipped preset.
- Cognito, Okta, and Keycloak can be expressed through `generic-oidc` fixtures.

### Phase 3: Better Auth runtime wiring (implemented)

Replace the single `buildDefaultSsoProviders` path with a resolver that supplies
all configured static connections to Better Auth's SSO plugin.

- Preserve the Better Auth database, cookies, JWT issuer/audience, and JWKS
  behavior.
- Include every resolved issuer and discovery origin in trusted origins.
- Select a connection by its route/provider ID when starting SSO.
- Keep callback IDs stable because they are part of IdP configuration and stored
  account identity.
- Do not implicitly link accounts across different connection IDs. Account
  linking requires an explicit future product flow.
- Enforce the Better Auth access policy at the normalized Overlay session
  boundary and prevent new disallowed identities from being provisioned.

Acceptance:

- Multiple static connections can coexist without callback collisions.
- Unknown or disabled connection IDs fail closed.
- Unverified or disallowed-domain users cannot access Overlay.
- JWT, session refresh, sign-out, and account deletion retain current behavior.

### Phase 4: Provider-driven web UI (implemented)

Make `/api/auth/options` return connection-derived sign-in options:

- Arbitrary connection ID.
- Display label.
- Preset/icon hint.

Remove the fixed Better Auth `sso` ID from the browser contract. Keep WorkOS's
Google, Apple, and Microsoft buttons unchanged.

The SSO route validates the selected ID against the active backend's advertised
options before initiating auth. The sign-in and sign-up surfaces render only the
connections enabled for that deployment.

Acceptance:

- A Google-only deployment shows only `Continue with Google Workspace`.
- Auth0, Entra, and generic OIDC use their configured labels.
- Multiple configured connections render in deterministic config order.
- Unsupported provider IDs return a safe `400` without provider discovery.
- WorkOS UI and password behavior remain unchanged.

### Phase 5: Documentation and deployment recipes

Organize public documentation by:

1. Auth backend: WorkOS or Better Auth.
2. Protocol: OIDC now, SAML later.
3. Preset recipe: Google Workspace, Auth0, Entra ID, or generic OIDC.
4. Access policy, callbacks, secrets, logout, and troubleshooting.

Update the EC2 sanity guide to use:

- Connection ID `primary-sso`.
- Preset `google-workspace`.
- A direct Google Workspace OIDC client.
- Customer-owned credentials stored outside Git.

Document Auth0 as the regression/staging alternative, not as an architectural
requirement. Document Cognito, Okta, and Keycloak through generic OIDC and link
to this backlog for dedicated future presets.

Acceptance:

- Every command and callback URL is copyable without customer-specific values.
- The Google Workspace recipe covers Internal app configuration, exact callback
  URLs, scopes, domain policy, and Workspace administrator approval.
- Secret values appear only as placeholders.
- Documentation health and link checks pass.

### Phase 6: Verification and release gate

Run in this order:

1. Config schema, environment override, redaction, and preset unit tests.
2. Better Auth runtime and negative-security tests.
3. Auth UI and route tests for one and multiple connections.
4. Existing Auth0 local/staging regression smoke.
5. Direct Google Workspace browser smoke with a disposable OAuth client.
6. WorkOS hosted regression smoke.
7. Production build and EC2 guide static validation.
8. Disposable EC2 rehearsal from the exact remote release commit.

The EC2 rehearsal must verify Google login, session persistence, refresh, JWT,
Postgres user sync, sign-out, account deletion, domain rejection, and zero
dependency on Auth0 or WorkOS in the Better Auth profile.

Release only after every command and prerequisite discovered during rehearsal is
corrected in the public guide. Publish the immutable commit through the agreed
versioned release branch or tag after the final documentation checks pass.

## Explicit non-goals

- Renaming the public `auth.provider` field in this release.
- Dynamic/self-service SSO provider registration.
- A customer-facing identity administration console.
- SAML support.
- Dedicated Cognito, Okta, or Keycloak behavior beyond generic OIDC.
- Automatic account linking across identity connections.

## Required behavior

- Preserve WorkOS as the hosted Overlay auth backend.
- Preserve the existing Better Auth OIDC environment variables as deprecated
  compatibility aliases for one `generic-oidc` connection.
- Allow deployment-owned, URL-safe connection IDs.
- Render sign-in options from the configured connections.
- Require verified email addresses and enforce configured email domains.
- Keep client secrets in environment variables or a deployment secret manager.
- Normalize every successful connection into the same Overlay session and user
  contracts.
- Test Google Workspace directly, retain the Auth0 regression smoke, and cover
  Entra and generic OIDC configuration through contract tests.

## Deferred presets

The following presets are intentionally outside the first release:

| Preset | Future work | Interim path |
| --- | --- | --- |
| `aws-cognito` | Add Cognito defaults, federation guidance, logout behavior, and an AWS integration smoke. | Configure it through `generic-oidc`. |
| `okta` | Add organization-specific issuer defaults, logout behavior, and an Okta smoke. | Configure it through `generic-oidc`. |
| `keycloak` | Add realm discovery defaults, logout behavior, and a supported-version matrix. | Configure it through `generic-oidc`. |
| `generic-saml` | Implement and test SAML metadata, certificates, assertion validation, ACS, logout limitations, and key rotation. | No first-release fallback; use OIDC or WorkOS. |

Dedicated OIDC presets should be added only when they remove meaningful customer
configuration or introduce provider-specific security and lifecycle behavior.
`generic-saml` requires a separate implementation phase because its certificate,
metadata, assertion, and logout operations differ materially from OIDC.

## Exit criteria for adding a deferred preset

A deferred preset can move into supported scope only when it has:

1. A documented customer requirement.
2. A provider-specific configuration recipe.
3. Callback, claim, domain, logout, and account-deletion tests.
4. Local or staging browser QA against the real provider.
5. Deployment and secret-rotation guidance.
